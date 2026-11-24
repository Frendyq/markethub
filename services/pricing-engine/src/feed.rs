//! Supplier price list (CSV) validation.
//!
//! Every row is checked field by field, so one upload reports all problems at once
//! instead of failing on the first one. Valid rows come back normalized and typed.

use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::str::FromStr;

pub const MAX_ROWS: usize = 50_000;

/// A row as it is in the file: everything is text until it is checked.
#[derive(Debug, Deserialize)]
struct RawRow {
    sku: String,
    title: String,
    category: String,
    cost_price: String,
    base_price: String,
    weight_kg: String,
    width_cm: String,
    height_cm: String,
    depth_cm: String,
    #[serde(default)]
    ean: String,
    #[serde(default)]
    stock: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FeedRow {
    pub line: u64,
    pub sku: String,
    pub title: String,
    pub category: String,
    pub cost_price: Decimal,
    pub base_price: Decimal,
    pub weight_kg: Decimal,
    pub width_cm: u32,
    pub height_cm: u32,
    pub depth_cm: u32,
    pub ean: Option<String>,
    pub stock: Option<u32>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RowError {
    pub line: u64,
    pub sku: Option<String>,
    pub field: String,
    pub message: String,
}

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FeedReport {
    pub total_rows: usize,
    pub valid_rows: usize,
    pub error_rows: usize,
    pub rows: Vec<FeedRow>,
    pub errors: Vec<RowError>,
}

#[derive(Debug, thiserror::Error)]
pub enum FeedError {
    #[error("the file has no header row or misses columns: {0}")]
    BadHeader(String),
    #[error("the file has more than {MAX_ROWS} rows")]
    TooManyRows,
}

const REQUIRED: [&str; 9] = [
    "sku",
    "title",
    "category",
    "cost_price",
    "base_price",
    "weight_kg",
    "width_cm",
    "height_cm",
    "depth_cm",
];

pub fn validate(csv_text: &str) -> Result<FeedReport, FeedError> {
    let mut reader = csv::ReaderBuilder::new()
        .trim(csv::Trim::All)
        .flexible(true)
        .from_reader(csv_text.as_bytes());

    let headers = reader
        .headers()
        .map_err(|e| FeedError::BadHeader(e.to_string()))?
        .clone();
    let missing: Vec<&str> = REQUIRED
        .iter()
        .copied()
        .filter(|h| !headers.iter().any(|x| x == *h))
        .collect();
    if !missing.is_empty() {
        return Err(FeedError::BadHeader(missing.join(", ")));
    }

    let mut report = FeedReport::default();
    let mut seen = HashSet::new();

    for record in reader.records() {
        report.total_rows += 1;
        if report.total_rows > MAX_ROWS {
            return Err(FeedError::TooManyRows);
        }
        let record = match record {
            Ok(record) => record,
            Err(e) => {
                let line = e.position().map(|p| p.line()).unwrap_or(0);
                report
                    .errors
                    .push(error(line, None, "row", &format!("unreadable row: {e}")));
                report.error_rows += 1;
                continue;
            }
        };
        let line = record.position().map(|p| p.line()).unwrap_or(0);
        let raw: RawRow = match record.deserialize(Some(&headers)) {
            Ok(raw) => raw,
            Err(e) => {
                report.errors.push(error(
                    line,
                    None,
                    "row",
                    &format!("wrong number of columns: {e}"),
                ));
                report.error_rows += 1;
                continue;
            }
        };

        match check_row(line, raw, &mut seen) {
            Ok(row) => report.rows.push(row),
            Err(mut errors) => {
                report.error_rows += 1;
                report.errors.append(&mut errors);
            }
        }
    }
    report.valid_rows = report.rows.len();
    Ok(report)
}

fn check_row(line: u64, raw: RawRow, seen: &mut HashSet<String>) -> Result<FeedRow, Vec<RowError>> {
    let sku = raw.sku.to_uppercase();
    let sku_ref = (!sku.is_empty()).then(|| sku.clone());
    let mut errors = Vec::new();
    let mut fail =
        |field: &str, message: &str| errors.push(error(line, sku_ref.clone(), field, message));

    if !is_valid_sku(&sku) {
        fail("sku", "3-40 characters: A-Z, 0-9 and dashes");
    } else if !seen.insert(sku.clone()) {
        fail("sku", "duplicate SKU in this file");
    }
    if raw.title.is_empty() || raw.title.chars().count() > 200 {
        fail("title", "required, at most 200 characters");
    }
    if raw.category.is_empty() || raw.category.chars().count() > 60 {
        fail("category", "required, at most 60 characters");
    }

    let cost_price = parse_money(&raw.cost_price)
        .map_err(|m| fail("cost_price", m))
        .ok();
    let base_price = parse_money(&raw.base_price)
        .map_err(|m| fail("base_price", m))
        .ok();
    if let (Some(cost), Some(base)) = (cost_price, base_price)
        && base < cost
    {
        fail(
            "base_price",
            "is lower than cost_price: the product would be sold at a loss",
        );
    }
    let weight_kg = parse_decimal(&raw.weight_kg, 3)
        .map_err(|m| fail("weight_kg", m))
        .ok();
    let width_cm = parse_dimension(&raw.width_cm)
        .map_err(|m| fail("width_cm", m))
        .ok();
    let height_cm = parse_dimension(&raw.height_cm)
        .map_err(|m| fail("height_cm", m))
        .ok();
    let depth_cm = parse_dimension(&raw.depth_cm)
        .map_err(|m| fail("depth_cm", m))
        .ok();

    let ean = if raw.ean.is_empty() {
        None
    } else if is_valid_ean13(&raw.ean) {
        Some(raw.ean.clone())
    } else {
        fail("ean", "must be 13 digits with a correct check digit");
        None
    };
    let stock = if raw.stock.is_empty() {
        None
    } else {
        raw.stock
            .parse::<u32>()
            .map_err(|_| fail("stock", "must be a whole number, 0 or more"))
            .ok()
    };

    if !errors.is_empty() {
        return Err(errors);
    }
    // Every Option is Some here: a None always came with an error above.
    Ok(FeedRow {
        line,
        sku,
        title: raw.title,
        category: raw.category.to_lowercase(),
        cost_price: crate::pricing::two_places(cost_price.unwrap()),
        base_price: crate::pricing::two_places(base_price.unwrap()),
        weight_kg: {
            let mut weight = weight_kg.unwrap();
            weight.rescale(3);
            weight
        },
        width_cm: width_cm.unwrap(),
        height_cm: height_cm.unwrap(),
        depth_cm: depth_cm.unwrap(),
        ean,
        stock,
    })
}

fn error(line: u64, sku: Option<String>, field: &str, message: &str) -> RowError {
    RowError {
        line,
        sku,
        field: field.to_string(),
        message: message.to_string(),
    }
}

fn is_valid_sku(sku: &str) -> bool {
    let len = sku.len();
    (3..=40).contains(&len)
        && sku
            .chars()
            .next()
            .is_some_and(|c| c.is_ascii_alphanumeric())
        && sku
            .chars()
            .all(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || c == '-')
}

fn parse_money(value: &str) -> Result<Decimal, &'static str> {
    parse_decimal(value, 2)
}

/// Accepts "1299.9", "1299,90" (European comma) and "1299"; rejects negatives and extra decimals.
fn parse_decimal(value: &str, max_scale: u32) -> Result<Decimal, &'static str> {
    if value.is_empty() {
        return Err("required");
    }
    let normalized = value.replace(',', ".");
    let number = Decimal::from_str(&normalized).map_err(|_| "not a number")?;
    if number.is_sign_negative() {
        return Err("must not be negative");
    }
    if number.scale() > max_scale {
        return Err(if max_scale == 2 {
            "at most 2 digits after the point"
        } else {
            "at most 3 digits after the point"
        });
    }
    Ok(number)
}

fn parse_dimension(value: &str) -> Result<u32, &'static str> {
    match value.parse::<u32>() {
        Ok(n) if (1..=1000).contains(&n) => Ok(n),
        Ok(_) => Err("must be between 1 and 1000 cm"),
        Err(_) => Err("must be a whole number of centimetres"),
    }
}

/// EAN-13: 13 digits, the last one is a checksum of the first twelve (weights 1,3,1,3...).
pub fn is_valid_ean13(ean: &str) -> bool {
    if ean.len() != 13 || !ean.bytes().all(|b| b.is_ascii_digit()) {
        return false;
    }
    let digits: Vec<u32> = ean.bytes().map(|b| u32::from(b - b'0')).collect();
    let sum: u32 = digits[..12]
        .iter()
        .enumerate()
        .map(|(i, d)| if i % 2 == 0 { *d } else { d * 3 })
        .sum();
    (10 - sum % 10) % 10 == digits[12]
}

#[cfg(test)]
mod tests {
    use super::*;

    const HEADER: &str = "sku,title,category,cost_price,base_price,weight_kg,width_cm,height_cm,depth_cm,ean,stock\n";

    #[test]
    fn accepts_a_clean_file_and_normalizes_values() {
        let csv = format!(
            "{HEADER}sof-oslo-gry,Oslo sofa,Sofas,410,899.00,54.5,210,85,95,4006381333931,4\n"
        );
        let report = validate(&csv).unwrap();
        assert_eq!(report.total_rows, 1);
        assert_eq!(report.valid_rows, 1);
        let row = &report.rows[0];
        assert_eq!(row.sku, "SOF-OSLO-GRY");
        assert_eq!(row.category, "sofas");
        assert_eq!(row.base_price, Decimal::from_str("899.00").unwrap());
        assert_eq!(row.stock, Some(4));
        assert_eq!(row.line, 2);
    }

    #[test]
    fn reports_every_problem_of_a_row_with_its_line() {
        let csv = format!("{HEADER}X,,beds,-5,1.234,abc,0,85,95,123,many\n");
        let report = validate(&csv).unwrap();
        assert_eq!(report.valid_rows, 0);
        assert_eq!(report.error_rows, 1);
        let fields: Vec<&str> = report.errors.iter().map(|e| e.field.as_str()).collect();
        assert_eq!(
            fields,
            [
                "sku",
                "title",
                "cost_price",
                "base_price",
                "weight_kg",
                "width_cm",
                "ean",
                "stock"
            ]
        );
        assert!(report.errors.iter().all(|e| e.line == 2));
    }

    #[test]
    fn catches_duplicate_skus_and_selling_at_a_loss() {
        let csv = format!(
            "{HEADER}TAB-A,Table A,tables,100,200,20,120,75,70,,\nTAB-A,Table A again,tables,100,200,20,120,75,70,,\nTAB-B,Table B,tables,300,250,20,120,75,70,,\n"
        );
        let report = validate(&csv).unwrap();
        assert_eq!(report.valid_rows, 1);
        assert_eq!(report.errors[0].message, "duplicate SKU in this file");
        assert_eq!(report.errors[0].line, 3);
        assert!(report.errors[1].message.contains("loss"));
    }

    #[test]
    fn accepts_a_european_decimal_comma() {
        let csv = format!(
            "{HEADER}CHA-WIRE-BLK,Wire chair,chairs,\"20,50\",\"49,99\",\"6,2\",48,85,52,,\n"
        );
        let report = validate(&csv).unwrap();
        assert_eq!(report.valid_rows, 1, "{:?}", report.errors);
        assert_eq!(
            report.rows[0].cost_price,
            Decimal::from_str("20.50").unwrap()
        );
    }

    #[test]
    fn rejects_a_file_without_required_columns() {
        let err = validate("sku,title\nA,B\n").unwrap_err();
        assert!(err.to_string().contains("category"));
    }

    #[test]
    fn checks_the_ean_check_digit() {
        assert!(is_valid_ean13("4006381333931"));
        assert!(!is_valid_ean13("4006381333932"));
        assert!(!is_valid_ean13("400638133393"));
    }
}
