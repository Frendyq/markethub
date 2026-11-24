//! Sends the outbox to the server in the background.
//!
//! - The operation id is the Idempotency-Key: if the connection drops after the server applied it,
//!   the retry is recognised and nothing happens twice.
//! - No network or 5xx: retry later with a growing pause (2, 4, 8 ... up to 60 s).
//! - 4xx (already shipped by someone else, not enough stock): "conflict", a person decides.
//! - 401: the session is gone; the queue waits until the user signs in again.

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use serde::Serialize;
use tokio::sync::Notify;

use crate::api::Api;
use crate::error::AppError;
use crate::store::{Operation, OutboxItem, Store, now_ms};

const IDLE_CHECK: Duration = Duration::from_secs(5);
const MAX_BACKOFF_MS: i64 = 60_000;

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SyncStatus {
    pub pending: i64,
    pub conflicts: i64,
    pub online: bool,
    pub signed_in: bool,
    pub last_error: Option<String>,
}

#[derive(Debug, PartialEq)]
pub enum Step {
    /// Nothing due right now.
    Idle,
    Sent,
    Conflict,
    /// Network or server problem: stop for now, the item waits for its retry time.
    Offline(String),
    SignInRequired,
}

/// 1 s × 2^attempts, at most a minute: 2 s, 4 s, 8 s, ... 60 s.
pub fn backoff_ms(attempts: i64) -> i64 {
    (1_000_i64 << attempts.clamp(0, 6)).min(MAX_BACKOFF_MS)
}

/// Sends the oldest due operation, if any, and records what happened.
pub async fn process_once(store: &Store, api: &Api) -> Step {
    let item = match store.next_due(now_ms()) {
        Ok(Some(item)) => item,
        Ok(None) => return Step::Idle,
        Err(error) => return Step::Offline(error.to_string()),
    };
    let result = send(api, &item).await;
    let saved = match &result {
        Ok(()) => store.mark_sent(&item.id),
        Err(AppError::Unauthorized) => {
            store.mark_retry(&item.id, "Sign in again to send", now_ms() + 30_000)
        }
        Err(error) if error.is_transient() => store.mark_retry(
            &item.id,
            &error.to_string(),
            now_ms() + backoff_ms(item.attempts + 1),
        ),
        Err(error) => store.mark_conflict(&item.id, &error.to_string()),
    };
    if let Err(error) = saved {
        log::error!("outbox update failed: {error}");
    }
    match result {
        Ok(()) => Step::Sent,
        Err(AppError::Unauthorized) => Step::SignInRequired,
        Err(error) if error.is_transient() => Step::Offline(error.to_string()),
        Err(_) => Step::Conflict,
    }
}

async fn send(api: &Api, item: &OutboxItem) -> Result<(), AppError> {
    match &item.operation {
        Operation::Ship { order_id, .. } => api.ship(*order_id, &item.id).await,
        Operation::Movement {
            product_id,
            movement,
            quantity,
            reason,
            ..
        } => api
            .movement(*product_id, movement, *quantity, reason, &item.id)
            .await
            .map(|_| ()),
    }
}

pub struct Syncer {
    wake: Notify,
    online: AtomicBool,
    store: Arc<Store>,
    api: Arc<Api>,
    last_error: std::sync::Mutex<Option<String>>,
}

impl Syncer {
    pub fn new(store: Arc<Store>, api: Arc<Api>) -> Arc<Self> {
        Arc::new(Self {
            wake: Notify::new(),
            online: AtomicBool::new(true),
            store,
            api,
            last_error: std::sync::Mutex::new(None),
        })
    }

    /// Something was queued or the user asked to sync: don't wait for the timer.
    pub fn wake(&self) {
        self.wake.notify_one();
    }

    pub fn status(&self) -> SyncStatus {
        let (pending, conflicts) = self.store.outbox_counts().unwrap_or((0, 0));
        SyncStatus {
            pending,
            conflicts,
            online: self.online.load(Ordering::Relaxed),
            signed_in: self.api.has_session(),
            last_error: self.last_error.lock().unwrap().clone(),
        }
    }

    /// Runs forever: drains the queue, reports the status, sleeps until woken or the timer fires.
    pub async fn run(self: Arc<Self>, on_status: impl Fn(SyncStatus) + Send + 'static) {
        loop {
            loop {
                match process_once(&self.store, &self.api).await {
                    Step::Sent | Step::Conflict => {
                        self.online.store(true, Ordering::Relaxed);
                        *self.last_error.lock().unwrap() = None;
                        on_status(self.status());
                    }
                    Step::Idle => break,
                    Step::Offline(error) => {
                        self.online.store(false, Ordering::Relaxed);
                        *self.last_error.lock().unwrap() = Some(error);
                        break;
                    }
                    Step::SignInRequired => {
                        *self.last_error.lock().unwrap() =
                            Some("Sign in again to send the queue".into());
                        break;
                    }
                }
            }
            on_status(self.status());
            let _ = tokio::time::timeout(IDLE_CHECK, self.wake.notified()).await;
        }
    }

    pub fn set_online(&self, online: bool) {
        self.online.store(online, Ordering::Relaxed);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::vault::{MemoryVault, TokenVault};
    use serde_json::json;
    use wiremock::matchers::{header, method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    async fn setup() -> (MockServer, Store, Api) {
        let server = MockServer::start().await;
        let vault = MemoryVault::default();
        vault.save("refresh").unwrap();
        Mock::given(method("POST"))
            .and(path("/api/auth/refresh"))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_json(json!({ "accessToken": "a", "refreshToken": "refresh" })),
            )
            .mount(&server)
            .await;
        let api = Api::new(&server.uri(), Box::new(vault));
        (server, Store::open_in_memory().unwrap(), api)
    }

    fn ship(order_id: i64) -> Operation {
        Operation::Ship {
            order_id,
            order_number: format!("A-{order_id}"),
        }
    }

    #[test]
    fn backs_off_up_to_a_minute() {
        assert_eq!(backoff_ms(1), 2_000);
        assert_eq!(backoff_ms(2), 4_000);
        assert_eq!(backoff_ms(10), 60_000);
    }

    #[tokio::test]
    async fn sends_with_the_operation_id_as_idempotency_key() {
        let (server, store, api) = setup().await;
        let item = store.enqueue(ship(5)).unwrap();
        Mock::given(method("POST"))
            .and(path("/api/orders/5/ship"))
            .and(header("idempotency-key", item.id.as_str()))
            .respond_with(
                ResponseTemplate::new(200).set_body_json(json!({ "id": 5, "status": "SHIPPED" })),
            )
            .expect(1)
            .mount(&server)
            .await;

        assert_eq!(process_once(&store, &api).await, Step::Sent);
        assert_eq!(process_once(&store, &api).await, Step::Idle);
        assert_eq!(store.outbox_counts().unwrap(), (0, 0));
    }

    #[tokio::test]
    async fn keeps_the_operation_when_the_server_fails_and_sends_it_later() {
        let (server, store, api) = setup().await;
        let item = store.enqueue(ship(6)).unwrap();
        Mock::given(method("POST"))
            .and(path("/api/orders/6/ship"))
            .respond_with(ResponseTemplate::new(503))
            .up_to_n_times(1)
            .mount(&server)
            .await;

        assert!(matches!(process_once(&store, &api).await, Step::Offline(_)));
        let waiting = &store.outbox().unwrap()[0];
        assert_eq!(waiting.attempts, 1);
        assert!(waiting.next_attempt_at > now_ms());

        // The retry time comes; the server is fine again; the same key goes out.
        store.retry(&item.id).unwrap();
        Mock::given(method("POST"))
            .and(path("/api/orders/6/ship"))
            .and(header("idempotency-key", item.id.as_str()))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({ "id": 6 })))
            .mount(&server)
            .await;
        assert_eq!(process_once(&store, &api).await, Step::Sent);
    }

    #[tokio::test]
    async fn marks_a_refused_operation_as_a_conflict_and_moves_on() {
        let (server, store, api) = setup().await;
        store.enqueue(ship(7)).unwrap();
        store
            .enqueue(Operation::Movement {
                product_id: 3,
                sku: "TAB-A".into(),
                movement: "RECEIPT".into(),
                quantity: 4,
                reason: "delivery".into(),
            })
            .unwrap();
        Mock::given(method("POST"))
            .and(path("/api/orders/7/ship"))
            .respond_with(
                ResponseTemplate::new(409)
                    .set_body_json(json!({ "message": "Order 7 is SHIPPED, expected RESERVED" })),
            )
            .mount(&server)
            .await;
        Mock::given(method("POST"))
            .and(path("/api/inventory/3/movements"))
            .respond_with(
                ResponseTemplate::new(201)
                    .set_body_json(json!({ "onHand": 9, "reserved": 0, "available": 9 })),
            )
            .mount(&server)
            .await;

        assert_eq!(process_once(&store, &api).await, Step::Conflict);
        assert_eq!(process_once(&store, &api).await, Step::Sent);
        let left = store.outbox().unwrap();
        assert_eq!(left.len(), 1);
        assert_eq!(left[0].status, "conflict");
        assert_eq!(
            left[0].last_error.as_deref(),
            Some("Order 7 is SHIPPED, expected RESERVED")
        );
    }

    #[tokio::test]
    async fn without_network_nothing_is_lost() {
        let store = Store::open_in_memory().unwrap();
        let vault = MemoryVault::default();
        vault.save("refresh").unwrap();
        let api = Api::new("http://127.0.0.1:1", Box::new(vault));
        store.enqueue(ship(8)).unwrap();

        assert!(matches!(process_once(&store, &api).await, Step::Offline(_)));
        assert_eq!(store.outbox_counts().unwrap(), (1, 0));
    }
}
