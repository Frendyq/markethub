//! Checks a scanned code against the order being picked.

use std::collections::HashMap;

use serde::Serialize;

use crate::api::{PickingItem, PickingOrder};

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(tag = "result", rename_all = "camelCase")]
pub enum ScanOutcome {
    /// One more unit of this line is picked.
    #[serde(rename_all = "camelCase")]
    Matched {
        sku: String,
        title: String,
        scanned: i64,
        needed: i64,
    },
    /// The line already has all its units: the picker took one too many.
    #[serde(rename_all = "camelCase")]
    AlreadyComplete { sku: String, title: String },
    /// A valid code, but not in this order: wrong item taken from the shelf.
    NotInOrder,
    /// Not a barcode we can read (bad EAN check digit, junk from the scanner).
    InvalidCode,
}

/// EAN-13: the 13th digit is a checksum of the first twelve (weights 1, 3, 1, 3, ...).
pub fn valid_ean13(code: &str) -> bool {
    if code.len() != 13 || !code.bytes().all(|b| b.is_ascii_digit()) {
        return false;
    }
    let digits: Vec<u32> = code.bytes().map(|b| u32::from(b - b'0')).collect();
    let sum: u32 = digits[..12]
        .iter()
        .enumerate()
        .map(|(i, d)| if i % 2 == 0 { *d } else { d * 3 })
        .sum();
    (10 - sum % 10) % 10 == digits[12]
}

/// A scanner sends the EAN; without a scanner the picker can type the SKU.
pub fn apply_scan(order: &PickingOrder, scans: &HashMap<String, i64>, code: &str) -> ScanOutcome {
    let code = code.trim();
    let is_number = !code.is_empty() && code.bytes().all(|b| b.is_ascii_digit());
    if code.is_empty() || (is_number && code.len() == 13 && !valid_ean13(code)) {
        return ScanOutcome::InvalidCode;
    }

    let upper = code.to_uppercase();
    let line: Option<&PickingItem> = order
        .items
        .iter()
        .find(|item| item.ean.as_deref() == Some(code) || (!is_number && item.sku == upper));
    let Some(line) = line else {
        return ScanOutcome::NotInOrder;
    };

    let scanned = scans.get(&line.sku).copied().unwrap_or(0);
    if scanned >= line.quantity {
        return ScanOutcome::AlreadyComplete {
            sku: line.sku.clone(),
            title: line.title.clone(),
        };
    }
    ScanOutcome::Matched {
        sku: line.sku.clone(),
        title: line.title.clone(),
        scanned: scanned + 1,
        needed: line.quantity,
    }
}

pub fn is_complete(order: &PickingOrder, scans: &HashMap<String, i64>) -> bool {
    order
        .items
        .iter()
        .all(|item| scans.get(&item.sku).copied().unwrap_or(0) >= item.quantity)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn order() -> PickingOrder {
        PickingOrder {
            id: 1,
            marketplace: "amazon".into(),
            external_id: "AMAZON-1".into(),
            customer_name: None,
            placed_at: "2026-11-25T10:00:00Z".into(),
            items: vec![
                PickingItem {
                    product_id: Some(1),
                    sku: "TAB-A".into(),
                    title: "Table".into(),
                    ean: Some("4006381333931".into()),
                    location: Some("A-01-1".into()),
                    quantity: 2,
                },
                PickingItem {
                    product_id: Some(2),
                    sku: "CHA-B".into(),
                    title: "Chair".into(),
                    ean: None,
                    location: None,
                    quantity: 1,
                },
            ],
        }
    }

    #[test]
    fn checks_the_ean_check_digit() {
        assert!(valid_ean13("4006381333931"));
        assert!(!valid_ean13("4006381333932"));
        assert!(!valid_ean13("400638133393"));
    }

    #[test]
    fn counts_units_until_the_line_is_complete() {
        let order = order();
        let mut scans = HashMap::new();
        assert_eq!(
            apply_scan(&order, &scans, "4006381333931"),
            ScanOutcome::Matched {
                sku: "TAB-A".into(),
                title: "Table".into(),
                scanned: 1,
                needed: 2
            }
        );
        scans.insert("TAB-A".to_string(), 2);
        assert_eq!(
            apply_scan(&order, &scans, "4006381333931"),
            ScanOutcome::AlreadyComplete {
                sku: "TAB-A".into(),
                title: "Table".into()
            }
        );
    }

    #[test]
    fn tells_a_wrong_item_from_a_bad_barcode() {
        let order = order();
        let scans = HashMap::new();
        assert_eq!(
            apply_scan(&order, &scans, "4000000000006"),
            ScanOutcome::NotInOrder
        );
        assert_eq!(
            apply_scan(&order, &scans, "4006381333932"),
            ScanOutcome::InvalidCode
        );
        assert_eq!(apply_scan(&order, &scans, "  "), ScanOutcome::InvalidCode);
    }

    #[test]
    fn accepts_a_typed_sku_for_items_without_a_barcode() {
        let order = order();
        let mut scans = HashMap::new();
        assert!(matches!(
            apply_scan(&order, &scans, " cha-b "),
            ScanOutcome::Matched { scanned: 1, .. }
        ));
        assert!(!is_complete(&order, &scans));
        scans.insert("TAB-A".to_string(), 2);
        scans.insert("CHA-B".to_string(), 1);
        assert!(is_complete(&order, &scans));
    }
}
