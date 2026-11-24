//! HTTP client of the MarketHub API.
//!
//! The access token (15 minutes) is kept in memory only. The refresh token is in the OS credential
//! store. On a 401 the client refreshes once and repeats the request; refresh tokens rotate, so the
//! new one is saved right away.

use std::sync::{Mutex, RwLock};
use std::time::Duration;

use reqwest::{Method, StatusCode};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::error::{AppError, Result};
use crate::vault::TokenVault;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct User {
    pub id: i64,
    pub email: String,
    pub role: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PickingItem {
    pub product_id: Option<i64>,
    pub sku: String,
    pub title: String,
    pub ean: Option<String>,
    pub location: Option<String>,
    pub quantity: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PickingOrder {
    pub id: i64,
    pub marketplace: String,
    pub external_id: String,
    pub customer_name: Option<String>,
    pub placed_at: String,
    pub items: Vec<PickingItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Stock {
    pub on_hand: i64,
    pub reserved: i64,
    pub available: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Product {
    pub id: i64,
    pub sku: String,
    pub title: String,
    pub ean: Option<String>,
    pub location: Option<String>,
    pub category: String,
    pub stock: Stock,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Tokens {
    access_token: String,
    refresh_token: String,
}

pub struct Api {
    http: reqwest::Client,
    base: RwLock<String>,
    access: Mutex<Option<String>>,
    vault: Box<dyn TokenVault>,
    // Only one refresh at a time: refresh tokens rotate, a second parallel refresh would fail.
    refreshing: tokio::sync::Mutex<()>,
}

impl Api {
    pub fn new(base_url: &str, vault: Box<dyn TokenVault>) -> Self {
        let http = reqwest::Client::builder()
            .timeout(Duration::from_secs(10))
            .connect_timeout(Duration::from_secs(5))
            .build()
            .expect("HTTP client");
        Self {
            http,
            base: RwLock::new(base_url.trim_end_matches('/').to_string()),
            access: Mutex::new(None),
            vault,
            refreshing: tokio::sync::Mutex::new(()),
        }
    }

    pub fn set_base_url(&self, url: &str) {
        *self.base.write().unwrap() = url.trim_end_matches('/').to_string();
        *self.access.lock().unwrap() = None;
    }

    pub fn has_session(&self) -> bool {
        self.vault.load().is_some()
    }

    fn url(&self, path: &str) -> String {
        format!("{}/api{}", self.base.read().unwrap(), path)
    }

    pub async fn login(&self, email: &str, password: &str) -> Result<User> {
        let response = self
            .http
            .post(self.url("/auth/login"))
            .json(&json!({ "email": email, "password": password }))
            .send()
            .await?;
        let status = response.status();
        if status == StatusCode::UNAUTHORIZED || status == StatusCode::BAD_REQUEST {
            return Err(AppError::Invalid("Wrong email or password".into()));
        }
        if status == StatusCode::TOO_MANY_REQUESTS {
            return Err(AppError::Invalid(
                "Too many attempts. Wait a minute and try again.".into(),
            ));
        }
        let body = read(response).await?;
        let tokens: Tokens = serde_json::from_value(body)?;
        self.vault.save(&tokens.refresh_token)?;
        *self.access.lock().unwrap() = Some(tokens.access_token);
        self.me().await
    }

    /// Revokes the refresh token on the server (if reachable) and forgets both tokens here.
    pub async fn logout(&self) {
        if let Some(refresh) = self.vault.load() {
            let _ = self
                .http
                .post(self.url("/auth/logout"))
                .json(&json!({ "refreshToken": refresh }))
                .send()
                .await;
        }
        self.vault.clear();
        *self.access.lock().unwrap() = None;
    }

    pub async fn me(&self) -> Result<User> {
        Ok(serde_json::from_value(
            self.send(Method::GET, "/auth/me", None, None).await?,
        )?)
    }

    pub async fn picking(&self) -> Result<Vec<PickingOrder>> {
        Ok(serde_json::from_value(
            self.send(Method::GET, "/warehouse/picking", None, None)
                .await?,
        )?)
    }

    pub async fn product_by_ean(&self, ean: &str) -> Result<Product> {
        Ok(serde_json::from_value(
            self.send(Method::GET, &format!("/products/by-ean/{ean}"), None, None)
                .await?,
        )?)
    }

    pub async fn ship(&self, order_id: i64, idempotency_key: &str) -> Result<()> {
        self.send(
            Method::POST,
            &format!("/orders/{order_id}/ship"),
            None,
            Some(idempotency_key),
        )
        .await?;
        Ok(())
    }

    pub async fn movement(
        &self,
        product_id: i64,
        kind: &str,
        quantity: i64,
        reason: &str,
        idempotency_key: &str,
    ) -> Result<Stock> {
        let body = json!({ "type": kind, "quantity": quantity, "reason": reason });
        let value = self
            .send(
                Method::POST,
                &format!("/inventory/{product_id}/movements"),
                Some(body),
                Some(idempotency_key),
            )
            .await?;
        Ok(serde_json::from_value(value)?)
    }

    async fn send(
        &self,
        method: Method,
        path: &str,
        body: Option<Value>,
        key: Option<&str>,
    ) -> Result<Value> {
        if self.access.lock().unwrap().is_none() {
            self.refresh().await?;
        }
        match self
            .send_once(method.clone(), path, body.clone(), key)
            .await
        {
            Err(AppError::Unauthorized) => {
                // Access token expired: one refresh, one retry.
                self.refresh().await?;
                self.send_once(method, path, body, key).await
            }
            other => other,
        }
    }

    async fn send_once(
        &self,
        method: Method,
        path: &str,
        body: Option<Value>,
        key: Option<&str>,
    ) -> Result<Value> {
        let token = self
            .access
            .lock()
            .unwrap()
            .clone()
            .ok_or(AppError::Unauthorized)?;
        let mut request = self.http.request(method, self.url(path)).bearer_auth(token);
        if let Some(key) = key {
            request = request.header("Idempotency-Key", key);
        }
        if let Some(body) = body {
            request = request.json(&body);
        }
        let response = request.send().await?;
        if response.status() == StatusCode::UNAUTHORIZED {
            *self.access.lock().unwrap() = None;
            return Err(AppError::Unauthorized);
        }
        read(response).await
    }

    async fn refresh(&self) -> Result<()> {
        let _guard = self.refreshing.lock().await;
        if self.access.lock().unwrap().is_some() {
            return Ok(()); // another task refreshed while we waited
        }
        let refresh = self.vault.load().ok_or(AppError::Unauthorized)?;
        let response = self
            .http
            .post(self.url("/auth/refresh"))
            .json(&json!({ "refreshToken": refresh }))
            .send()
            .await?;
        if response.status() == StatusCode::UNAUTHORIZED {
            self.vault.clear();
            return Err(AppError::Unauthorized);
        }
        let tokens: Tokens = serde_json::from_value(read(response).await?)?;
        self.vault.save(&tokens.refresh_token)?;
        *self.access.lock().unwrap() = Some(tokens.access_token);
        Ok(())
    }
}

/// 2xx -> JSON (or null), anything else -> AppError::Api with the server's message.
async fn read(response: reqwest::Response) -> Result<Value> {
    let status = response.status();
    let text = response.text().await?;
    if status.is_success() {
        return Ok(if text.is_empty() {
            Value::Null
        } else {
            serde_json::from_str(&text)?
        });
    }
    let message = serde_json::from_str::<Value>(&text)
        .ok()
        .and_then(|v| match &v["message"] {
            Value::String(s) => Some(s.clone()),
            Value::Array(items) => Some(
                items
                    .iter()
                    .filter_map(|i| i.as_str())
                    .collect::<Vec<_>>()
                    .join("; "),
            ),
            _ => None,
        })
        .unwrap_or_else(|| format!("Server answered {status}"));
    Err(AppError::Api {
        status: status.as_u16(),
        message,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::vault::MemoryVault;
    use wiremock::matchers::{body_json, header, method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    fn tokens(access: &str, refresh: &str) -> ResponseTemplate {
        ResponseTemplate::new(200).set_body_json(
            json!({ "accessToken": access, "refreshToken": refresh, "expiresIn": "15m" }),
        )
    }

    async fn signed_in(server: &MockServer) -> Api {
        let vault = MemoryVault::default();
        vault.save("refresh-1").unwrap();
        Mock::given(method("POST"))
            .and(path("/api/auth/refresh"))
            .and(body_json(json!({ "refreshToken": "refresh-1" })))
            .respond_with(tokens("access-1", "refresh-2"))
            .mount(server)
            .await;
        Api::new(&server.uri(), Box::new(vault))
    }

    #[tokio::test]
    async fn refreshes_the_access_token_and_keeps_the_rotated_refresh_token() {
        let server = MockServer::start().await;
        let api = signed_in(&server).await;
        Mock::given(method("GET"))
            .and(path("/api/auth/me"))
            .and(header("authorization", "Bearer access-1"))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_json(json!({ "id": 1, "email": "a@b.c", "role": "ADMIN" })),
            )
            .mount(&server)
            .await;

        let user = api.me().await.unwrap();
        assert_eq!(user.email, "a@b.c");
        assert_eq!(api.vault.load().as_deref(), Some("refresh-2"));
    }

    #[tokio::test]
    async fn sends_the_idempotency_key_and_reports_api_errors() {
        let server = MockServer::start().await;
        let api = signed_in(&server).await;
        Mock::given(method("POST"))
            .and(path("/api/orders/7/ship"))
            .and(header("idempotency-key", "key-123"))
            .respond_with(
                ResponseTemplate::new(409)
                    .set_body_json(json!({ "statusCode": 409, "message": "Order 7 is SHIPPED" })),
            )
            .mount(&server)
            .await;

        let error = api.ship(7, "key-123").await.unwrap_err();
        assert!(
            matches!(error, AppError::Api { status: 409, ref message } if message == "Order 7 is SHIPPED")
        );
        assert!(!error.is_transient());
    }

    #[tokio::test]
    async fn a_dead_refresh_token_signs_the_user_out() {
        let server = MockServer::start().await;
        let vault = MemoryVault::default();
        vault.save("revoked").unwrap();
        Mock::given(method("POST"))
            .and(path("/api/auth/refresh"))
            .respond_with(ResponseTemplate::new(401))
            .mount(&server)
            .await;
        let api = Api::new(&server.uri(), Box::new(vault));

        assert!(matches!(api.picking().await, Err(AppError::Unauthorized)));
        assert!(!api.has_session());
    }

    #[tokio::test]
    async fn no_server_is_offline_and_transient() {
        let api = Api::new("http://127.0.0.1:1", Box::new(MemoryVault::default()));
        let error = api.login("a@b.c", "secret-123").await.unwrap_err();
        assert!(matches!(error, AppError::Offline(_)));
        assert!(error.is_transient());
    }
}
