use axum::Json;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use serde_json::json;

use crate::feed::FeedError;
use crate::pricing::PricingError;

/// Every error a handler can return. Turned into the same JSON shape the NestJS API uses:
/// `{ "statusCode": 400, "message": "...", "error": "Bad Request" }`.
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("{0}")]
    BadRequest(String),
    #[error("{0}")]
    NotFound(String),
    #[error("{0}")]
    Unprocessable(String),
    #[error("database error: {0}")]
    Database(#[from] sqlx::Error),
    #[error("internal error: {0}")]
    Internal(String),
}

impl From<PricingError> for AppError {
    fn from(error: PricingError) -> Self {
        AppError::Unprocessable(error.to_string())
    }
}

impl From<FeedError> for AppError {
    fn from(error: FeedError) -> Self {
        AppError::BadRequest(error.to_string())
    }
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let status = match &self {
            AppError::BadRequest(_) => StatusCode::BAD_REQUEST,
            AppError::NotFound(_) => StatusCode::NOT_FOUND,
            AppError::Unprocessable(_) => StatusCode::UNPROCESSABLE_ENTITY,
            AppError::Database(_) | AppError::Internal(_) => StatusCode::INTERNAL_SERVER_ERROR,
        };
        let message = if status.is_server_error() {
            // Details go to the log, not to the client.
            tracing::error!(error = %self, "request failed");
            "Internal server error".to_string()
        } else {
            self.to_string()
        };
        let body = json!({
            "statusCode": status.as_u16(),
            "message": message,
            "error": status.canonical_reason().unwrap_or("Error"),
        });
        (status, Json(body)).into_response()
    }
}
