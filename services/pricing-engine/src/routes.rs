use axum::extract::State;
use axum::http::StatusCode;
use axum::{Json, Router, routing::get, routing::post};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sqlx::PgPool;

use crate::error::AppError;
use crate::feed::{self, FeedReport};
use crate::pricing::{self, MarketplaceTerms, PriceInput, PriceQuote};

pub const MAX_ITEMS: usize = 1_000;

#[derive(Clone)]
pub struct AppState {
    pub pool: PgPool,
    pub min_margin_percent: Decimal,
}

pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/health", get(health))
        .route("/ready", get(ready))
        .route("/prices/calculate", post(calculate_prices))
        .route("/feeds/validate", post(validate_feed))
        .with_state(state)
}

async fn health() -> Json<Value> {
    Json(json!({ "status": "ok" }))
}

async fn ready(State(state): State<AppState>) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    match sqlx::query("SELECT 1").execute(&state.pool).await {
        Ok(_) => Ok(Json(json!({ "status": "ok", "database": "up" }))),
        Err(_) => Err((
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({ "status": "error", "database": "down" })),
        )),
    }
}

#[derive(Debug, Deserialize)]
pub struct CalculateRequest {
    pub marketplace: String,
    pub items: Vec<PriceInput>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CalculateResponse {
    pub marketplace: String,
    pub currency: String,
    pub min_margin_percent: Decimal,
    pub items: Vec<PriceQuote>,
}

/// Prices for a batch of products on one marketplace.
async fn calculate_prices(
    State(state): State<AppState>,
    Json(request): Json<CalculateRequest>,
) -> Result<Json<CalculateResponse>, AppError> {
    if request.items.is_empty() || request.items.len() > MAX_ITEMS {
        return Err(AppError::BadRequest(format!(
            "items: between 1 and {MAX_ITEMS} products"
        )));
    }

    let terms = load_terms(&state.pool, &request.marketplace).await?;
    pricing::check_terms(&terms)?;

    let items = request
        .items
        .iter()
        .map(|item| pricing::quote(item, &terms, state.min_margin_percent))
        .collect::<Result<Vec<_>, _>>()?;

    Ok(Json(CalculateResponse {
        marketplace: terms.code,
        currency: terms.currency,
        min_margin_percent: state.min_margin_percent,
        items,
    }))
}

#[derive(sqlx::FromRow)]
struct TermsRow {
    code: String,
    currency: String,
    fee_percent: Decimal,
    vat_percent: Decimal,
    per_eur: Decimal,
}

/// The same tables the NestJS API writes. Read-only from here.
async fn load_terms(pool: &PgPool, code: &str) -> Result<MarketplaceTerms, AppError> {
    let row = sqlx::query_as::<_, TermsRow>(
        r#"SELECT m.code, m.currency, m.fee_percent, m.vat_percent, r.per_eur
             FROM marketplaces m
             JOIN exchange_rates r ON r.currency = m.currency
            WHERE m.code = $1"#,
    )
    .bind(code)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| {
        AppError::NotFound(format!(
            "marketplace '{code}' or its exchange rate not found"
        ))
    })?;

    Ok(MarketplaceTerms {
        code: row.code,
        currency: row.currency,
        fee_percent: row.fee_percent,
        vat_percent: row.vat_percent,
        per_eur: row.per_eur,
    })
}

/// Validates a CSV price list sent as the request body.
/// Parsing is CPU work, so it runs on the blocking thread pool and doesn't stall other requests.
async fn validate_feed(body: String) -> Result<Json<FeedReport>, AppError> {
    if body.trim().is_empty() {
        return Err(AppError::BadRequest("empty file".into()));
    }
    let report = tokio::task::spawn_blocking(move || feed::validate(&body))
        .await
        .map_err(|e| AppError::Internal(e.to_string()))??;
    Ok(Json(report))
}
