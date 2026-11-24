use serde::Serialize;
use serde::ser::SerializeStruct;

/// Every error a command can return. The interface gets `{ kind, message }` and decides
/// what to show: "offline" means the operation was queued or the cache was used.
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("{message}")]
    Api { status: u16, message: String },
    #[error("No connection to the server")]
    Offline(String),
    #[error("Please sign in again")]
    Unauthorized,
    #[error("Local database error: {0}")]
    Storage(#[from] rusqlite::Error),
    #[error("Secure storage error: {0}")]
    Vault(String),
    #[error("{0}")]
    Invalid(String),
    #[error("{0}")]
    NotFound(String),
}

impl AppError {
    pub fn kind(&self) -> &'static str {
        match self {
            AppError::Api { .. } => "api",
            AppError::Offline(_) => "offline",
            AppError::Unauthorized => "unauthorized",
            AppError::Storage(_) => "storage",
            AppError::Vault(_) => "vault",
            AppError::Invalid(_) => "invalid",
            AppError::NotFound(_) => "not_found",
        }
    }

    /// Worth retrying later: no network, or the server had a problem (5xx).
    pub fn is_transient(&self) -> bool {
        matches!(self, AppError::Offline(_))
            || matches!(self, AppError::Api { status, .. } if *status >= 500)
    }
}

impl From<reqwest::Error> for AppError {
    fn from(error: reqwest::Error) -> Self {
        AppError::Offline(error.to_string())
    }
}

impl From<serde_json::Error> for AppError {
    fn from(error: serde_json::Error) -> Self {
        AppError::Invalid(format!("Unexpected data: {error}"))
    }
}

impl Serialize for AppError {
    fn serialize<S: serde::Serializer>(
        &self,
        serializer: S,
    ) -> std::result::Result<S::Ok, S::Error> {
        let mut state = serializer.serialize_struct("AppError", 2)?;
        state.serialize_field("kind", self.kind())?;
        state.serialize_field("message", &self.to_string())?;
        state.end()
    }
}

pub type Result<T> = std::result::Result<T, AppError>;
