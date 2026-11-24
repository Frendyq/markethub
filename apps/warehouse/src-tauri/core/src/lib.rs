//! Everything MarketHub Warehouse does, without the window: the API client, the local database,
//! the offline queue, barcode checks and shipping labels.
//!
//! It doesn't depend on Tauri, so it is tested on its own (`cargo test -p warehouse-core`)
//! and the app crate only turns these functions into commands for the interface.

pub mod api;
pub mod error;
pub mod label;
pub mod scan;
pub mod store;
pub mod sync;
pub mod vault;
