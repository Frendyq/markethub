//! Shipping label: an SVG of 100 × 150 mm (4 px per mm) with a Code 128 barcode of the order number.
//! The interface shows it and prints it with the system print dialog (which can also save a PDF).

use barcoders::generators::svg::SVG;
use barcoders::sym::code128::Code128;

use crate::api::PickingOrder;
use crate::error::{AppError, Result};

const WIDTH: u32 = 400;
const HEIGHT: u32 = 600;

pub fn shipping_label(order: &PickingOrder) -> Result<String> {
    let barcode = barcode_svg(&order.external_id)?;
    let marketplace = match order.marketplace.as_str() {
        "amazon" => "Amazon",
        "ebay" => "eBay",
        "otto" => "OTTO",
        "kaufland" => "Kaufland",
        other => other,
    };
    let units: i64 = order.items.iter().map(|i| i.quantity).sum();

    let mut lines = String::new();
    for (index, item) in order.items.iter().take(8).enumerate() {
        let y = 300 + index as u32 * 26;
        lines.push_str(&format!(
            r##"<text x="24" y="{y}" font-size="16">{qty} × {sku}</text><text x="376" y="{y}" font-size="14" text-anchor="end" fill="#555">{loc}</text>"##,
            qty = item.quantity,
            sku = escape(&item.sku),
            loc = escape(item.location.as_deref().unwrap_or("")),
        ));
    }
    if order.items.len() > 8 {
        lines.push_str(&format!(
            r##"<text x="24" y="{}" font-size="14" fill="#555">+ {} more lines</text>"##,
            300 + 8 * 26,
            order.items.len() - 8
        ));
    }

    Ok(format!(
        r##"<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="150mm" viewBox="0 0 {WIDTH} {HEIGHT}" font-family="Arial, Helvetica, sans-serif">
<rect width="{WIDTH}" height="{HEIGHT}" fill="#fff"/>
<rect x="8" y="8" width="384" height="584" fill="none" stroke="#000" stroke-width="2"/>
<text x="24" y="48" font-size="22" font-weight="bold">MarketHub</text>
<text x="376" y="48" font-size="22" font-weight="bold" text-anchor="end">{marketplace}</text>
<line x1="8" y1="66" x2="392" y2="66" stroke="#000" stroke-width="2"/>
<text x="24" y="102" font-size="14" fill="#555">ORDER</text>
<text x="24" y="130" font-size="22" font-weight="bold">{order_number}</text>
<text x="24" y="166" font-size="14" fill="#555">CUSTOMER</text>
<text x="24" y="190" font-size="18">{customer}</text>
<text x="24" y="226" font-size="14" fill="#555">PLACED</text>
<text x="24" y="250" font-size="16">{placed}</text>
<text x="376" y="250" font-size="16" text-anchor="end">{units} pcs</text>
<line x1="8" y1="268" x2="392" y2="268" stroke="#000" stroke-width="1"/>
{lines}
<svg x="24" y="470" width="352" height="90" viewBox="0 0 {barcode_width} 80" preserveAspectRatio="none">{barcode}</svg>
<text x="200" y="580" font-size="14" text-anchor="middle">{order_number}</text>
</svg>"##,
        order_number = escape(&order.external_id),
        customer = escape(order.customer_name.as_deref().unwrap_or("—")),
        placed = escape(
            order
                .placed_at
                .get(..16)
                .unwrap_or(&order.placed_at)
                .replace('T', " ")
                .as_str()
        ),
        barcode_width = barcode.1,
        barcode = barcode.0,
    ))
}

/// Code 128 set B covers the order numbers we get (letters, digits, dashes).
/// Returns the inner SVG elements and the barcode width in modules.
fn barcode_svg(data: &str) -> Result<(String, usize)> {
    let code = Code128::new(format!("Ɓ{data}"))
        .map_err(|e| AppError::Invalid(format!("Cannot encode {data}: {e}")))?;
    let encoded = code.encode();
    let svg = SVG::new(80)
        .generate(&encoded)
        .map_err(|e| AppError::Invalid(e.to_string()))?;
    // Keep only the bars: strip the generator's own <svg> wrapper, it is nested into the label.
    let start = svg.find('>').map(|i| i + 1).unwrap_or(0);
    let end = svg.rfind("</svg>").unwrap_or(svg.len());
    Ok((svg[start..end].to_string(), encoded.len()))
}

fn escape(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::api::PickingItem;

    fn order() -> PickingOrder {
        PickingOrder {
            id: 1,
            marketplace: "kaufland".into(),
            external_id: "KAUFLAND-1795-42".into(),
            customer_name: Some("Anna <Schmidt> & Co".into()),
            placed_at: "2026-11-25T10:15:00.000Z".into(),
            items: vec![PickingItem {
                product_id: Some(1),
                sku: "TAB-A".into(),
                title: "Table".into(),
                ean: None,
                location: Some("A-01-1".into()),
                quantity: 2,
            }],
        }
    }

    #[test]
    fn has_the_order_number_marketplace_and_a_barcode() {
        let svg = shipping_label(&order()).unwrap();
        assert!(svg.starts_with("<svg"));
        assert!(svg.contains("KAUFLAND-1795-42"));
        assert!(svg.contains(">Kaufland<"));
        assert!(svg.contains("2 × TAB-A"));
        assert!(svg.contains("<rect"), "barcode bars are rectangles");
        assert!(
            svg.matches("<svg").count() == 2,
            "the barcode is nested once"
        );
    }

    #[test]
    fn escapes_text_from_the_marketplace() {
        let svg = shipping_label(&order()).unwrap();
        assert!(svg.contains("Anna &lt;Schmidt&gt; &amp; Co"));
        assert!(!svg.contains("<Schmidt>"));
    }
}
