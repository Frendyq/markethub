//! Where the refresh token lives between app starts.
//! In the app: the operating system's credential store (Windows Credential Manager, macOS Keychain,
//! Linux keyutils), so the token is never in a plain file or in the WebView's storage.

#[cfg(test)]
use std::sync::Mutex;

use crate::error::{AppError, Result};

pub trait TokenVault: Send + Sync {
    fn load(&self) -> Option<String>;
    fn save(&self, token: &str) -> Result<()>;
    fn clear(&self);
}

pub struct KeyringVault {
    service: String,
}

impl KeyringVault {
    pub fn new(service: &str) -> Self {
        Self {
            service: service.to_string(),
        }
    }

    fn entry(&self) -> Result<keyring::Entry> {
        keyring::Entry::new(&self.service, "refresh-token")
            .map_err(|e| AppError::Vault(e.to_string()))
    }
}

impl TokenVault for KeyringVault {
    fn load(&self) -> Option<String> {
        self.entry().ok()?.get_password().ok()
    }

    fn save(&self, token: &str) -> Result<()> {
        self.entry()?
            .set_password(token)
            .map_err(|e| AppError::Vault(e.to_string()))
    }

    fn clear(&self) {
        if let Ok(entry) = self.entry() {
            let _ = entry.delete_credential();
        }
    }
}

/// For tests.
#[cfg(test)]
#[derive(Default)]
pub struct MemoryVault(Mutex<Option<String>>);

#[cfg(test)]
impl TokenVault for MemoryVault {
    fn load(&self) -> Option<String> {
        self.0.lock().unwrap().clone()
    }

    fn save(&self, token: &str) -> Result<()> {
        *self.0.lock().unwrap() = Some(token.to_string());
        Ok(())
    }

    fn clear(&self) {
        *self.0.lock().unwrap() = None;
    }
}
