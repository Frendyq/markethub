//! Tauri commands: the only things the interface can ask the Rust side to do.
//! Each one returns `Result<T, AppError>`; the interface gets the value or `{ kind, message }`.

use std::sync::Arc;

use serde::Serialize;
use tauri::State;

use warehouse_core::api::{Api, PickingItem, PickingOrder, Product, User};
use warehouse_core::error::{AppError, Result};
use warehouse_core::label;
use warehouse_core::scan::{self, ScanOutcome};
use warehouse_core::store::{Operation, OutboxItem, Store};
use warehouse_core::sync::{SyncStatus, Syncer};

pub struct AppState {
    pub store: Arc<Store>,
    pub api: Arc<Api>,
    pub syncer: Arc<Syncer>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    pub server_url: String,
    pub signed_in: bool,
    pub email: Option<String>,
    pub version: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LineView {
    #[serde(flatten)]
    pub item: PickingItem,
    pub scanned: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OrderView {
    pub id: i64,
    pub marketplace: String,
    pub external_id: String,
    pub customer_name: Option<String>,
    pub placed_at: String,
    pub lines: Vec<LineView>,
    pub units: i64,
    pub scanned_units: i64,
    pub complete: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PickingView {
    pub orders: Vec<OrderView>,
    /// True when the server was not reachable and this is the last saved list.
    pub offline: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanView {
    pub outcome: ScanOutcome,
    pub order: OrderView,
}

fn view(store: &Store, order: PickingOrder) -> Result<OrderView> {
    let scans = store.scans(order.id)?;
    let complete = scan::is_complete(&order, &scans);
    let lines: Vec<LineView> = order
        .items
        .into_iter()
        .map(|item| {
            let scanned = scans
                .get(&item.sku)
                .copied()
                .unwrap_or(0)
                .min(item.quantity);
            LineView { item, scanned }
        })
        .collect();
    Ok(OrderView {
        id: order.id,
        marketplace: order.marketplace,
        external_id: order.external_id,
        customer_name: order.customer_name,
        placed_at: order.placed_at,
        units: lines.iter().map(|l| l.item.quantity).sum(),
        scanned_units: lines.iter().map(|l| l.scanned).sum(),
        lines,
        complete,
    })
}

fn cached(store: &Store, order_id: i64) -> Result<PickingOrder> {
    store.cached_order(order_id)?.ok_or_else(|| {
        AppError::NotFound(format!(
            "Order {order_id} is not in the picking list any more"
        ))
    })
}

// ---- session ------------------------------------------------------------------------------------

#[tauri::command]
pub fn app_info(state: State<'_, AppState>) -> Result<AppInfo> {
    Ok(AppInfo {
        server_url: state.store.server_url()?,
        signed_in: state.api.has_session(),
        email: state.store.setting("email")?,
        version: env!("CARGO_PKG_VERSION").to_string(),
    })
}

#[tauri::command]
pub fn set_server_url(state: State<'_, AppState>, url: String) -> Result<()> {
    let url = url.trim().trim_end_matches('/').to_string();
    if !(url.starts_with("http://") || url.starts_with("https://")) || url.len() > 200 {
        return Err(AppError::Invalid(
            "The server address must start with http:// or https://".into(),
        ));
    }
    state.store.set_setting("server_url", &url)?;
    state.api.set_base_url(&url);
    Ok(())
}

#[tauri::command]
pub async fn login(state: State<'_, AppState>, email: String, password: String) -> Result<User> {
    let user = state.api.login(email.trim(), &password).await?;
    state.store.set_setting("email", &user.email)?;
    state.syncer.set_online(true);
    state.syncer.wake(); // operations queued before the session expired can go now
    Ok(user)
}

#[tauri::command]
pub async fn logout(state: State<'_, AppState>) -> Result<()> {
    state.api.logout().await;
    Ok(())
}

// ---- picking ------------------------------------------------------------------------------------

/// The list from the server, or the last saved one when the server can't be reached.
#[tauri::command]
pub async fn picking_list(state: State<'_, AppState>) -> Result<PickingView> {
    let (orders, offline) = match state.api.picking().await {
        Ok(orders) => {
            state.syncer.set_online(true);
            (state.store.replace_picking(&orders)?, false)
        }
        Err(error) if error.is_transient() => {
            state.syncer.set_online(false);
            (state.store.cached_picking()?, true)
        }
        Err(error) => return Err(error),
    };
    let orders = orders
        .into_iter()
        .map(|o| view(&state.store, o))
        .collect::<Result<Vec<_>>>()?;
    Ok(PickingView { orders, offline })
}

#[tauri::command]
pub fn picking_order(state: State<'_, AppState>, order_id: i64) -> Result<OrderView> {
    view(&state.store, cached(&state.store, order_id)?)
}

#[tauri::command]
pub fn scan_code(state: State<'_, AppState>, order_id: i64, code: String) -> Result<ScanView> {
    let order = cached(&state.store, order_id)?;
    let scans = state.store.scans(order_id)?;
    let outcome = scan::apply_scan(&order, &scans, &code);
    if let ScanOutcome::Matched { sku, scanned, .. } = &outcome {
        state.store.set_scan(order_id, sku, *scanned)?;
    }
    Ok(ScanView {
        outcome,
        order: view(&state.store, order)?,
    })
}

#[tauri::command]
pub fn reset_scans(state: State<'_, AppState>, order_id: i64) -> Result<OrderView> {
    state.store.clear_scans(order_id)?;
    view(&state.store, cached(&state.store, order_id)?)
}

/// Queues the shipment and takes the order off the list at once; the server gets it now or later.
#[tauri::command]
pub fn ship_order(state: State<'_, AppState>, order_id: i64) -> Result<OutboxItem> {
    let order = cached(&state.store, order_id)?;
    if !scan::is_complete(&order, &state.store.scans(order_id)?) {
        return Err(AppError::Invalid("Scan every item before shipping".into()));
    }
    let item = state.store.enqueue(Operation::Ship {
        order_id,
        order_number: order.external_id,
    })?;
    state.store.remove_order(order_id)?;
    state.syncer.wake();
    Ok(item)
}

#[tauri::command]
pub fn shipping_label(state: State<'_, AppState>, order_id: i64) -> Result<String> {
    label::shipping_label(&cached(&state.store, order_id)?)
}

// ---- receiving and stock counts -----------------------------------------------------------------

/// Looks a product up by the barcode on the box. Needs the server: stock has to be current.
#[tauri::command]
pub async fn find_product(state: State<'_, AppState>, code: String) -> Result<Product> {
    let code = code.trim().to_string();
    if !(8..=14).contains(&code.len()) || !code.bytes().all(|b| b.is_ascii_digit()) {
        return Err(AppError::Invalid("Scan the barcode (8-14 digits)".into()));
    }
    if code.len() == 13 && !scan::valid_ean13(&code) {
        return Err(AppError::Invalid(
            "The barcode check digit is wrong, scan again".into(),
        ));
    }
    match state.api.product_by_ean(&code).await {
        Err(AppError::Api { status: 404, .. }) => Err(AppError::NotFound(format!(
            "No product with barcode {code}"
        ))),
        other => other,
    }
}

#[tauri::command]
pub fn receive_stock(
    state: State<'_, AppState>,
    product_id: i64,
    sku: String,
    quantity: i64,
    note: String,
) -> Result<OutboxItem> {
    if !(1..=10_000).contains(&quantity) {
        return Err(AppError::Invalid(
            "Quantity must be between 1 and 10 000".into(),
        ));
    }
    let reason = if note.trim().is_empty() {
        "Warehouse receiving".to_string()
    } else {
        note.trim().chars().take(200).collect()
    };
    let item = state.store.enqueue(Operation::Movement {
        product_id,
        sku,
        movement: "RECEIPT".into(),
        quantity,
        reason,
    })?;
    state.syncer.wake();
    Ok(item)
}

/// Stock count: the difference between what is on the shelf and what the system had becomes a correction.
#[tauri::command]
pub fn count_stock(
    state: State<'_, AppState>,
    product_id: i64,
    sku: String,
    counted: i64,
    on_hand: i64,
) -> Result<Option<OutboxItem>> {
    if !(0..=100_000).contains(&counted) {
        return Err(AppError::Invalid(
            "Counted quantity must be between 0 and 100 000".into(),
        ));
    }
    let difference = counted - on_hand;
    if difference == 0 {
        return Ok(None);
    }
    let reason = format!("Stock count: {counted} on the shelf, {on_hand} in the system");
    let item = state.store.enqueue(Operation::Movement {
        product_id,
        sku,
        movement: "ADJUSTMENT".into(),
        quantity: difference,
        reason,
    })?;
    state.syncer.wake();
    Ok(Some(item))
}

// ---- queue --------------------------------------------------------------------------------------

#[tauri::command]
pub fn sync_status(state: State<'_, AppState>) -> SyncStatus {
    state.syncer.status()
}

#[tauri::command]
pub fn outbox(state: State<'_, AppState>) -> Result<Vec<OutboxItem>> {
    state.store.outbox()
}

#[tauri::command]
pub fn retry_operation(state: State<'_, AppState>, id: String) -> Result<bool> {
    let changed = state.store.retry(&id)?;
    state.syncer.wake();
    Ok(changed)
}

#[tauri::command]
pub fn discard_operation(state: State<'_, AppState>, id: String) -> Result<bool> {
    state.store.discard(&id)
}

#[tauri::command]
pub fn sync_now(state: State<'_, AppState>) {
    state.syncer.wake();
}
