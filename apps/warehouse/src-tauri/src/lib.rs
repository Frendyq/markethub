//! MarketHub Warehouse: desktop app for picking, shipping, receiving and stock counts.
//!
//! The interface (React, in the system WebView) never talks to the network and never sees a token:
//! it calls the commands in `commands.rs`. HTTP, the local database, the offline queue and the
//! shipping labels are in the `warehouse-core` crate, in Rust.

mod commands;

use std::sync::Arc;

use tauri::{Emitter, Manager};

use warehouse_core::api::Api;
use warehouse_core::store::Store;
use warehouse_core::sync::Syncer;
use warehouse_core::vault::KeyringVault;

use crate::commands::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&dir)?;
            let store = Arc::new(Store::open(&dir.join("warehouse.sqlite"))?);
            let api = Arc::new(Api::new(
                &store.server_url()?,
                Box::new(KeyringVault::new("MarketHub Warehouse")),
            ));
            let syncer = Syncer::new(store.clone(), api.clone());

            let handle = app.handle().clone();
            tauri::async_runtime::spawn(syncer.clone().run(move |status| {
                let _ = handle.emit("sync-status", status);
            }));

            app.manage(AppState { store, api, syncer });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::app_info,
            commands::set_server_url,
            commands::login,
            commands::logout,
            commands::picking_list,
            commands::picking_order,
            commands::scan_code,
            commands::reset_scans,
            commands::ship_order,
            commands::shipping_label,
            commands::find_product,
            commands::receive_stock,
            commands::count_stock,
            commands::sync_status,
            commands::outbox,
            commands::retry_operation,
            commands::discard_operation,
            commands::sync_now,
        ])
        .run(tauri::generate_context!())
        .expect("error while running MarketHub Warehouse");
}
