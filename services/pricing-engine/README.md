# pricing-engine

Rust service (axum, tokio, sqlx, rust_decimal) used by the MarketHub API.

| Route | What it does |
|---|---|
| `GET /health` | the process is up |
| `GET /ready` | PostgreSQL answers |
| `POST /prices/calculate` | prices of up to 1000 products for one marketplace |
| `POST /feeds/validate` | checks a supplier CSV price list (up to 50 000 rows, 10 MB) |

## Price formula

The catalog keeps a net price in EUR. A marketplace shows a gross price in its currency, takes its
commission from that gross price, and VAT is part of it too. The listing price is chosen so that
the seller keeps the catalog net price after VAT and commission:

```
price = base_price * rate / (1 / (1 + vat) - fee)   then rounded UP to .99
```

Money is `rust_decimal::Decimal` everywhere: no floating point.

## Run

```bash
DATABASE_URL=postgres://markethub:markethub@localhost:5433/markethub cargo run
cargo test                                   # unit and HTTP tests
PRICING_TEST_DATABASE_URL=postgres://markethub:markethub@localhost:5433/markethub cargo test   # plus the database test
```

Environment: `DATABASE_URL` (required), `PORT` (8080), `MIN_MARGIN_PERCENT` (10), `RUST_LOG`.

Example:

```bash
curl -s localhost:8080/prices/calculate -H 'content-type: application/json' \
  -d '{"marketplace":"otto","items":[{"sku":"SOF-OSLO-GRY","basePrice":"899.00","costPrice":"410.00"}]}'
```
