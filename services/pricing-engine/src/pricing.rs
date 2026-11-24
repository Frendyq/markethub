//! Marketplace price calculation.
//!
//! The catalog keeps a net price in EUR. A marketplace shows a gross price in its own currency,
//! takes its commission from that gross price and the state takes VAT out of it. We pick the
//! listing price so that what the seller keeps after VAT and commission is the catalog net price,
//! then round up to a "charm" price ending in .99.

use rust_decimal::{Decimal, RoundingStrategy};
use serde::{Deserialize, Serialize};

const HUNDRED: Decimal = Decimal::ONE_HUNDRED;
const CENT: Decimal = Decimal::from_parts(1, 0, 0, false, 2); // 0.01

/// What a marketplace charges, plus the exchange rate of its currency.
#[derive(Debug, Clone, PartialEq)]
pub struct MarketplaceTerms {
    pub code: String,
    pub currency: String,
    pub fee_percent: Decimal,
    pub vat_percent: Decimal,
    /// Units of the marketplace currency for one EUR.
    pub per_eur: Decimal,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PriceInput {
    pub sku: String,
    /// Net catalog price in EUR.
    pub base_price: Decimal,
    /// Purchase cost in EUR.
    pub cost_price: Decimal,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PriceQuote {
    pub sku: String,
    /// Price the buyer pays, in the marketplace currency.
    pub price: Decimal,
    pub currency: String,
    pub vat_amount: Decimal,
    pub fee_amount: Decimal,
    /// What the seller keeps after VAT and commission, in the marketplace currency.
    pub proceeds: Decimal,
    pub proceeds_eur: Decimal,
    pub margin_eur: Decimal,
    /// Margin as a percent of the proceeds.
    pub margin_percent: Decimal,
    pub below_min_margin: bool,
}

#[derive(Debug, thiserror::Error, PartialEq)]
pub enum PricingError {
    #[error("{sku}: prices must not be negative")]
    NegativePrice { sku: String },
    #[error("marketplace {0}: exchange rate must be positive")]
    BadRate(String),
    #[error("marketplace {0}: VAT and commission leave nothing for the seller")]
    FeesTooHigh(String),
}

/// Validates the terms once for a whole batch.
pub fn check_terms(terms: &MarketplaceTerms) -> Result<(), PricingError> {
    if terms.per_eur <= Decimal::ZERO {
        return Err(PricingError::BadRate(terms.code.clone()));
    }
    if seller_share(terms) <= Decimal::ZERO {
        return Err(PricingError::FeesTooHigh(terms.code.clone()));
    }
    Ok(())
}

/// Share of the gross price the seller keeps: 1/(1+vat) - fee.
fn seller_share(terms: &MarketplaceTerms) -> Decimal {
    let vat = terms.vat_percent / HUNDRED;
    let fee = terms.fee_percent / HUNDRED;
    Decimal::ONE / (Decimal::ONE + vat) - fee
}

pub fn quote(
    input: &PriceInput,
    terms: &MarketplaceTerms,
    min_margin_percent: Decimal,
) -> Result<PriceQuote, PricingError> {
    if input.base_price.is_sign_negative() || input.cost_price.is_sign_negative() {
        return Err(PricingError::NegativePrice {
            sku: input.sku.clone(),
        });
    }
    check_terms(terms)?;

    let net = input.base_price * terms.per_eur;
    let exact = net / seller_share(terms);
    let price = charm_price(exact);

    let vat_amount = money(price * terms.vat_percent / (HUNDRED + terms.vat_percent));
    let fee_amount = money(price * terms.fee_percent / HUNDRED);
    let proceeds = price - vat_amount - fee_amount;
    let proceeds_eur = money(proceeds / terms.per_eur);
    let margin_eur = proceeds_eur - input.cost_price;
    let margin_percent = if proceeds_eur.is_zero() {
        Decimal::ZERO
    } else {
        money(margin_eur / proceeds_eur * HUNDRED)
    };

    Ok(PriceQuote {
        sku: input.sku.clone(),
        price: two_places(price),
        currency: terms.currency.clone(),
        vat_amount: two_places(vat_amount),
        fee_amount: two_places(fee_amount),
        proceeds: two_places(proceeds),
        proceeds_eur: two_places(proceeds_eur),
        margin_eur: two_places(margin_eur),
        margin_percent: two_places(margin_percent),
        below_min_margin: margin_percent < min_margin_percent,
    })
}

/// Always two digits after the point in the JSON ("499.10", "0.00"), like the NestJS API.
pub fn two_places(mut value: Decimal) -> Decimal {
    value.rescale(2);
    value
}

/// Rounds up to the next price that ends in .99 (123.40 -> 123.99, 123.995 -> 124.99).
/// Rounding up, never down, so the seller never gets less than the calculated net.
pub fn charm_price(value: Decimal) -> Decimal {
    let candidate = value.ceil() - CENT;
    if candidate >= value {
        candidate
    } else {
        candidate + Decimal::ONE
    }
}

fn money(value: Decimal) -> Decimal {
    value.round_dp_with_strategy(2, RoundingStrategy::MidpointAwayFromZero)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::str::FromStr;

    fn d(value: &str) -> Decimal {
        Decimal::from_str(value).unwrap()
    }

    fn otto() -> MarketplaceTerms {
        MarketplaceTerms {
            code: "otto".into(),
            currency: "EUR".into(),
            fee_percent: d("14"),
            vat_percent: d("19"),
            per_eur: d("1"),
        }
    }

    fn ebay_us() -> MarketplaceTerms {
        MarketplaceTerms {
            code: "ebay".into(),
            currency: "USD".into(),
            fee_percent: d("13.25"),
            vat_percent: d("0"),
            per_eur: d("1.08"),
        }
    }

    fn item(base: &str, cost: &str) -> PriceInput {
        PriceInput {
            sku: "SOF-OSLO-GRY".into(),
            base_price: d(base),
            cost_price: d(cost),
        }
    }

    #[test]
    fn charm_price_rounds_up_to_99() {
        assert_eq!(charm_price(d("123.40")), d("123.99"));
        assert_eq!(charm_price(d("123.99")), d("123.99"));
        assert_eq!(charm_price(d("123.995")), d("124.99"));
        assert_eq!(charm_price(d("124")), d("124.99"));
        assert_eq!(charm_price(d("0.20")), d("0.99"));
    }

    #[test]
    fn seller_keeps_at_least_the_catalog_net_price() {
        let q = quote(&item("899.00", "410.00"), &otto(), d("10")).unwrap();
        // seller share = 1/1.19 - 0.14 = 0.70034; 899 / 0.70034 = 1283.67..., charm -> 1283.99
        assert_eq!(q.price, d("1283.99"));
        assert_eq!(q.currency, "EUR");
        assert!(
            q.proceeds_eur >= d("899.00"),
            "proceeds {} below net",
            q.proceeds_eur
        );
        assert_eq!(q.vat_amount + q.fee_amount + q.proceeds, q.price);
        assert!(!q.below_min_margin);
    }

    #[test]
    fn converts_to_the_marketplace_currency() {
        let q = quote(&item("100.00", "40.00"), &ebay_us(), d("10")).unwrap();
        // 100 EUR * 1.08 = 108 USD net; / (1 - 0.1325) = 124.49... -> 124.99
        assert_eq!(q.price, d("124.99"));
        assert_eq!(q.currency, "USD");
        assert_eq!(q.vat_amount, Decimal::ZERO);
    }

    #[test]
    fn flags_a_margin_below_the_minimum() {
        let q = quote(&item("100.00", "95.00"), &otto(), d("10")).unwrap();
        assert!(q.below_min_margin);
        assert!(q.margin_percent < d("10"));
    }

    #[test]
    fn rejects_negative_prices_and_impossible_terms() {
        assert!(matches!(
            quote(&item("-1", "0"), &otto(), d("10")),
            Err(PricingError::NegativePrice { .. })
        ));

        let mut terms = otto();
        terms.fee_percent = d("90");
        assert_eq!(
            check_terms(&terms),
            Err(PricingError::FeesTooHigh("otto".into()))
        );

        let mut terms = otto();
        terms.per_eur = Decimal::ZERO;
        assert_eq!(
            check_terms(&terms),
            Err(PricingError::BadRate("otto".into()))
        );
    }

    #[test]
    fn money_is_exact_where_floats_are_not() {
        // 0.1 + 0.2 is 0.30000000000000004 with f64.
        assert_eq!(d("0.1") + d("0.2"), d("0.3"));
    }
}
