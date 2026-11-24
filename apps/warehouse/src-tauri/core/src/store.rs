//! Local SQLite database next to the app: settings, the last picking list (so it works offline),
//! what has been scanned per order, and the outbox of operations waiting to be sent.
//! Everything survives a restart: a queued shipment is not lost when the laptop is closed.

use std::collections::HashMap;
use std::path::Path;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};

use crate::api::PickingOrder;
use crate::error::Result;

pub const DEFAULT_SERVER: &str = "http://localhost:3000";

/// An operation waiting to reach the server. Its id is also the Idempotency-Key.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Operation {
    #[serde(rename_all = "camelCase")]
    Ship { order_id: i64, order_number: String },
    #[serde(rename_all = "camelCase")]
    Movement {
        product_id: i64,
        sku: String,
        movement: String,
        quantity: i64,
        reason: String,
    },
}

impl Operation {
    pub fn label(&self) -> String {
        match self {
            Operation::Ship { order_number, .. } => format!("Ship order {order_number}"),
            Operation::Movement {
                sku,
                movement,
                quantity,
                ..
            } if movement == "RECEIPT" => {
                format!("Receive {quantity} × {sku}")
            }
            Operation::Movement { sku, quantity, .. } => format!("Correct {sku} by {quantity:+}"),
        }
    }
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct OutboxItem {
    pub id: String,
    pub operation: Operation,
    pub label: String,
    /// "pending" (will be sent) or "conflict" (the server refused it; a person decides).
    pub status: String,
    pub attempts: i64,
    pub last_error: Option<String>,
    pub created_at: i64,
    pub next_attempt_at: i64,
}

pub fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

pub struct Store {
    conn: Mutex<Connection>,
}

impl Store {
    pub fn open(path: &Path) -> Result<Self> {
        Self::init(Connection::open(path)?)
    }

    #[cfg(test)]
    pub fn open_in_memory() -> Result<Self> {
        Self::init(Connection::open_in_memory()?)
    }

    fn init(conn: Connection) -> Result<Self> {
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.pragma_update(None, "foreign_keys", "ON")?;
        migrate(&conn)?;
        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    // ---- settings -----------------------------------------------------------------------------

    pub fn setting(&self, key: &str) -> Result<Option<String>> {
        let conn = self.conn.lock().unwrap();
        Ok(conn
            .query_row("SELECT value FROM settings WHERE key = ?1", [key], |r| {
                r.get(0)
            })
            .optional()?)
    }

    pub fn set_setting(&self, key: &str, value: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO settings (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![key, value],
        )?;
        Ok(())
    }

    pub fn server_url(&self) -> Result<String> {
        Ok(self
            .setting("server_url")?
            .unwrap_or_else(|| DEFAULT_SERVER.to_string()))
    }

    // ---- picking list cache -------------------------------------------------------------------

    /// Replaces the cached list. Orders already shipped here (a Ship waits in the outbox) are left out,
    /// otherwise they would come back from the server until the queue is sent.
    pub fn replace_picking(&self, orders: &[PickingOrder]) -> Result<Vec<PickingOrder>> {
        let shipped = self.queued_shipments()?;
        let keep: Vec<PickingOrder> = orders
            .iter()
            .filter(|o| !shipped.contains(&o.id))
            .cloned()
            .collect();
        let mut conn = self.conn.lock().unwrap();
        let tx = conn.transaction()?;
        tx.execute("DELETE FROM picking_cache", [])?;
        for (position, order) in keep.iter().enumerate() {
            tx.execute(
                "INSERT INTO picking_cache (order_id, data, position) VALUES (?1, ?2, ?3)",
                params![order.id, serde_json::to_string(order)?, position as i64],
            )?;
        }
        // Scans of orders that are no longer in the list (shipped elsewhere, cancelled) are dropped.
        tx.execute(
            "DELETE FROM scans WHERE order_id NOT IN (SELECT order_id FROM picking_cache)",
            [],
        )?;
        tx.commit()?;
        Ok(keep)
    }

    pub fn cached_picking(&self) -> Result<Vec<PickingOrder>> {
        let conn = self.conn.lock().unwrap();
        let mut statement = conn.prepare("SELECT data FROM picking_cache ORDER BY position")?;
        let rows = statement.query_map([], |r| r.get::<_, String>(0))?;
        let mut orders = Vec::new();
        for row in rows {
            orders.push(serde_json::from_str(&row?)?);
        }
        Ok(orders)
    }

    pub fn cached_order(&self, order_id: i64) -> Result<Option<PickingOrder>> {
        let conn = self.conn.lock().unwrap();
        let data: Option<String> = conn
            .query_row(
                "SELECT data FROM picking_cache WHERE order_id = ?1",
                [order_id],
                |r| r.get(0),
            )
            .optional()?;
        Ok(match data {
            Some(json) => Some(serde_json::from_str(&json)?),
            None => None,
        })
    }

    pub fn remove_order(&self, order_id: i64) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM picking_cache WHERE order_id = ?1", [order_id])?;
        conn.execute("DELETE FROM scans WHERE order_id = ?1", [order_id])?;
        Ok(())
    }

    // ---- scans ----------------------------------------------------------------------------------

    pub fn scans(&self, order_id: i64) -> Result<HashMap<String, i64>> {
        let conn = self.conn.lock().unwrap();
        let mut statement = conn.prepare("SELECT sku, scanned FROM scans WHERE order_id = ?1")?;
        let rows = statement.query_map([order_id], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?))
        })?;
        let mut map = HashMap::new();
        for row in rows {
            let (sku, scanned) = row?;
            map.insert(sku, scanned);
        }
        Ok(map)
    }

    pub fn set_scan(&self, order_id: i64, sku: &str, scanned: i64) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO scans (order_id, sku, scanned) VALUES (?1, ?2, ?3)
             ON CONFLICT(order_id, sku) DO UPDATE SET scanned = excluded.scanned",
            params![order_id, sku, scanned],
        )?;
        Ok(())
    }

    pub fn clear_scans(&self, order_id: i64) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM scans WHERE order_id = ?1", [order_id])?;
        Ok(())
    }

    // ---- outbox ---------------------------------------------------------------------------------

    pub fn enqueue(&self, operation: Operation) -> Result<OutboxItem> {
        let id = uuid::Uuid::new_v4().to_string();
        let now = now_ms();
        let label = operation.label();
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO outbox (id, operation, label, status, attempts, created_at, next_attempt_at)
             VALUES (?1, ?2, ?3, 'pending', 0, ?4, ?4)",
            params![id, serde_json::to_string(&operation)?, label, now],
        )?;
        Ok(OutboxItem {
            id,
            operation,
            label,
            status: "pending".into(),
            attempts: 0,
            last_error: None,
            created_at: now,
            next_attempt_at: now,
        })
    }

    /// The oldest pending operation, if it is due. Strict FIFO: if the oldest one is waiting for its
    /// retry time, nothing newer overtakes it (a receipt must not be sent before an earlier correction).
    pub fn next_due(&self, now: i64) -> Result<Option<OutboxItem>> {
        let item = self
            .outbox_where("status = 'pending' ORDER BY created_at, rowid LIMIT 1")?
            .into_iter()
            .next();
        Ok(item.filter(|i| i.next_attempt_at <= now))
    }

    pub fn outbox(&self) -> Result<Vec<OutboxItem>> {
        self.outbox_where("1 = 1 ORDER BY created_at, rowid")
    }

    /// `clause` is always a constant written in this file, never user input.
    fn outbox_where(&self, clause: &'static str) -> Result<Vec<OutboxItem>> {
        let conn = self.conn.lock().unwrap();
        let sql = format!(
            "SELECT id, operation, label, status, attempts, last_error, created_at, next_attempt_at FROM outbox WHERE {clause}"
        );
        let mut statement = conn.prepare(&sql)?;
        let rows = statement.query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, String>(3)?,
                r.get::<_, i64>(4)?,
                r.get::<_, Option<String>>(5)?,
                r.get::<_, i64>(6)?,
                r.get::<_, i64>(7)?,
            ))
        })?;
        let mut items = Vec::new();
        for row in rows {
            let (id, operation, label, status, attempts, last_error, created_at, next_attempt_at) =
                row?;
            items.push(OutboxItem {
                id,
                operation: serde_json::from_str(&operation)?,
                label,
                status,
                attempts,
                last_error,
                created_at,
                next_attempt_at,
            });
        }
        Ok(items)
    }

    pub fn mark_sent(&self, id: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM outbox WHERE id = ?1", [id])?;
        Ok(())
    }

    pub fn mark_retry(&self, id: &str, error: &str, next_attempt_at: i64) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE outbox SET attempts = attempts + 1, last_error = ?2, next_attempt_at = ?3 WHERE id = ?1",
            params![id, error, next_attempt_at],
        )?;
        Ok(())
    }

    pub fn mark_conflict(&self, id: &str, error: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE outbox SET status = 'conflict', attempts = attempts + 1, last_error = ?2 WHERE id = ?1",
            params![id, error],
        )?;
        Ok(())
    }

    /// A person looked at a conflict and wants to try again (same key: never applied twice).
    pub fn retry(&self, id: &str) -> Result<bool> {
        let conn = self.conn.lock().unwrap();
        let changed = conn.execute(
            "UPDATE outbox SET status = 'pending', next_attempt_at = ?2 WHERE id = ?1",
            params![id, now_ms()],
        )?;
        Ok(changed > 0)
    }

    pub fn discard(&self, id: &str) -> Result<bool> {
        let conn = self.conn.lock().unwrap();
        Ok(conn.execute("DELETE FROM outbox WHERE id = ?1", [id])? > 0)
    }

    /// (pending, conflicts)
    pub fn outbox_counts(&self) -> Result<(i64, i64)> {
        let conn = self.conn.lock().unwrap();
        Ok(conn.query_row(
            "SELECT COUNT(*) FILTER (WHERE status = 'pending'), COUNT(*) FILTER (WHERE status = 'conflict') FROM outbox",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )?)
    }

    fn queued_shipments(&self) -> Result<Vec<i64>> {
        Ok(self
            .outbox()?
            .into_iter()
            .filter_map(|item| match item.operation {
                Operation::Ship { order_id, .. } => Some(order_id),
                Operation::Movement { .. } => None,
            })
            .collect())
    }
}

/// Schema versions, applied in order; `user_version` remembers which ones ran.
const MIGRATIONS: &[&str] = &[
    "CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
     CREATE TABLE picking_cache (order_id INTEGER PRIMARY KEY, data TEXT NOT NULL, position INTEGER NOT NULL);
     CREATE TABLE scans (order_id INTEGER NOT NULL, sku TEXT NOT NULL, scanned INTEGER NOT NULL CHECK (scanned >= 0),
                         PRIMARY KEY (order_id, sku));
     CREATE TABLE outbox (id TEXT PRIMARY KEY, operation TEXT NOT NULL, label TEXT NOT NULL,
                          status TEXT NOT NULL CHECK (status IN ('pending', 'conflict')),
                          attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT,
                          created_at INTEGER NOT NULL, next_attempt_at INTEGER NOT NULL);
     CREATE INDEX outbox_status_created ON outbox (status, created_at);",
];

fn migrate(conn: &Connection) -> Result<()> {
    let version: i64 = conn.pragma_query_value(None, "user_version", |r| r.get(0))?;
    for (index, sql) in MIGRATIONS.iter().enumerate().skip(version as usize) {
        conn.execute_batch(&format!(
            "BEGIN; {sql} PRAGMA user_version = {}; COMMIT;",
            index + 1
        ))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::api::PickingItem;

    fn order(id: i64) -> PickingOrder {
        PickingOrder {
            id,
            marketplace: "otto".into(),
            external_id: format!("OTTO-{id}"),
            customer_name: Some("Mia".into()),
            placed_at: "2026-11-25T10:00:00Z".into(),
            items: vec![PickingItem {
                product_id: Some(1),
                sku: "TAB-A".into(),
                title: "Table".into(),
                ean: Some("4006381333931".into()),
                location: Some("A-01-1".into()),
                quantity: 2,
            }],
        }
    }

    #[test]
    fn keeps_the_queue_across_a_restart() {
        let dir = std::env::temp_dir().join(format!("warehouse-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("db.sqlite");
        {
            let store = Store::open(&path).unwrap();
            store
                .enqueue(Operation::Ship {
                    order_id: 1,
                    order_number: "OTTO-1".into(),
                })
                .unwrap();
        }
        let reopened = Store::open(&path).unwrap();
        assert_eq!(reopened.outbox_counts().unwrap(), (1, 0));
        assert_eq!(reopened.outbox().unwrap()[0].label, "Ship order OTTO-1");
    }

    #[test]
    fn sends_in_order_and_a_waiting_item_blocks_newer_ones() {
        let store = Store::open_in_memory().unwrap();
        let first = store
            .enqueue(Operation::Ship {
                order_id: 1,
                order_number: "A".into(),
            })
            .unwrap();
        let second = store
            .enqueue(Operation::Ship {
                order_id: 2,
                order_number: "B".into(),
            })
            .unwrap();

        assert_eq!(store.next_due(now_ms()).unwrap().unwrap().id, first.id);
        store
            .mark_retry(&first.id, "offline", now_ms() + 60_000)
            .unwrap();
        assert_eq!(store.next_due(now_ms()).unwrap(), None);

        store.mark_conflict(&first.id, "already shipped").unwrap();
        assert_eq!(store.next_due(now_ms()).unwrap().unwrap().id, second.id);
        assert_eq!(store.outbox_counts().unwrap(), (1, 1));

        assert!(store.retry(&first.id).unwrap());
        assert_eq!(store.next_due(now_ms()).unwrap().unwrap().id, first.id);
    }

    #[test]
    fn a_refresh_does_not_bring_back_an_order_shipped_offline() {
        let store = Store::open_in_memory().unwrap();
        store.replace_picking(&[order(1), order(2)]).unwrap();
        store.set_scan(1, "TAB-A", 2).unwrap();
        store
            .enqueue(Operation::Ship {
                order_id: 1,
                order_number: "OTTO-1".into(),
            })
            .unwrap();
        store.remove_order(1).unwrap();

        let list = store
            .replace_picking(&[order(1), order(2), order(3)])
            .unwrap();
        assert_eq!(list.iter().map(|o| o.id).collect::<Vec<_>>(), vec![2, 3]);
        assert!(store.scans(1).unwrap().is_empty());
    }

    #[test]
    fn remembers_scans_per_order() {
        let store = Store::open_in_memory().unwrap();
        store.replace_picking(&[order(1)]).unwrap();
        store.set_scan(1, "TAB-A", 1).unwrap();
        store.set_scan(1, "TAB-A", 2).unwrap();
        assert_eq!(store.scans(1).unwrap().get("TAB-A"), Some(&2));
        store.clear_scans(1).unwrap();
        assert!(store.scans(1).unwrap().is_empty());
    }

    #[test]
    fn settings_have_a_default_server() {
        let store = Store::open_in_memory().unwrap();
        assert_eq!(store.server_url().unwrap(), DEFAULT_SERVER);
        store
            .set_setting("server_url", "https://api.example.com")
            .unwrap();
        assert_eq!(store.server_url().unwrap(), "https://api.example.com");
    }
}
