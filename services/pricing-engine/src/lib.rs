//! MarketHub pricing-engine: marketplace prices and supplier price-list validation.

pub mod config;
pub mod error;
pub mod feed;
pub mod pricing;
pub mod routes;

use std::time::Duration;

use axum::Router;
use axum::extract::DefaultBodyLimit;
use tower_http::timeout::TimeoutLayer;
use tower_http::trace::TraceLayer;

pub use routes::AppState;

/// 10 MB is enough for a price list of 50 000 rows.
pub const MAX_BODY_BYTES: usize = 10 * 1024 * 1024;

pub fn app(state: AppState) -> Router {
    routes::router(state)
        .layer(DefaultBodyLimit::max(MAX_BODY_BYTES))
        .layer(TimeoutLayer::with_status_code(
            axum::http::StatusCode::REQUEST_TIMEOUT,
            Duration::from_secs(30),
        ))
        .layer(TraceLayer::new_for_http())
}
