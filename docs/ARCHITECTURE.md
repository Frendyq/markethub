# Architecture

## Processes

| Process | Code | Talks to |
|---|---|---|
| `api` | `apps/api/src/main.ts` | PostgreSQL, Redis (adds jobs), pricing-engine |
| `worker` | `apps/api/src/worker.ts` | PostgreSQL, Redis (runs jobs), pricing-engine, marketplaces |
| `pricing-engine` | `services/pricing-engine` | PostgreSQL (reads marketplace terms and exchange rates) |
| `web` | `apps/web` | api (server side only, the browser never calls the API directly) |
| `mock-marketplaces` | `apps/mock-marketplaces` | api (webhooks) |

`api` and `worker` are one NestJS codebase with two entry points. The API never waits for a marketplace: it writes to the database, puts a job in Redis and answers. Slow or failing marketplace calls happen in the worker.

## Data model

```
users ── refresh_tokens
products ── inventory (1:1: on_hand, reserved)
         ├─ stock_movements (every change, with the order or user that caused it)
         ├─ listings ── marketplaces (product on a marketplace: status, last pushed price and quantity)
         └─ order_items ── orders ── marketplaces
processed_webhooks (webhook event ids already handled)
sync_runs (outcome of every finished queue job)
exchange_rates, audit_logs
```

`available = on_hand - reserved`. CHECK constraints keep `0 <= reserved <= on_hand` in the database itself.

## Flow 1: a price or stock change reaches every marketplace

1. A manager changes stock in the panel. `POST /api/inventory/:id/movements` runs one atomic `UPDATE inventory SET on_hand = on_hand + :q WHERE product_id = :id AND on_hand + :q >= reserved` and writes a stock movement, in one transaction.
2. After the commit, `ListingSyncScheduler.scheduleProducts` adds a `push-listing` job to the queue of every marketplace where the product is published. The job id contains a hash of the state, so the same change added twice while it waits is one job.
3. The worker of that marketplace takes the job (one at a time, no faster than the marketplace limit), reads the current product and stock, asks the pricing-engine for the price, and builds the payload.
4. If the payload is the same as the last one pushed (hash in `listings.last_sync_hash`), no API call is made.
5. Otherwise the connector sends it in that marketplace's format. Results:
   - 2xx: listing `ACTIVE` (or `PAUSED` with 0 units), price, quantity, external id saved.
   - 429: the queue pauses for `Retry-After`, the job goes back without using an attempt.
   - 5xx or timeout: retried after 2, 4, 8, 16, 32 seconds.
   - other 4xx: no retries, listing `ERROR` with the message; the panel has a Retry button.
6. Every finished job writes a row to `sync_runs`.

## Flow 2: an order arrives

1. The marketplace sends `POST /api/webhooks/otto` with `x-event-id` and an HMAC-SHA256 signature of the raw body. A wrong signature is a 401.
2. The OTTO connector turns the OTTO payload into the common `ExternalOrder`.
3. `OrdersService.ingest`, in one transaction:
   - `INSERT INTO processed_webhooks ... ON CONFLICT DO NOTHING`: a redelivered event stops here.
   - `INSERT INTO orders ... ON CONFLICT (marketplace_id, external_id) DO NOTHING`: an order already seen by polling stops here.
   - `SELECT ... FROM inventory WHERE product_id IN (...) ORDER BY product_id FOR UPDATE`: lock the stock rows. Concurrent orders for the same product wait here; the fixed order prevents deadlocks.
   - If every line is covered: `reserved += qty`, RESERVE movements, order `RESERVED`. Otherwise nothing is reserved and the order is `BACKORDERED`.
4. After the commit, the products whose stock changed get `push-listing` jobs (Flow 1), so the other marketplaces stop selling units that are gone.
5. Safety net: every marketplace queue also has a repeating `pull-orders` job. It asks for orders since the last pull minus 5 minutes and feeds them to the same `ingest`, so a lost webhook is picked up and duplicates do nothing.

## Flow 3: shipping and cancelling

- Ship: `SELECT status ... FOR UPDATE`, must be `RESERVED`, then `on_hand -= qty` and `reserved -= qty`. A second click gets 409.
- Cancel: allowed from `RESERVED` or `BACKORDERED`; a reservation goes back (`reserved -= qty`) and the listings are pushed again.

## Flow 4: supplier price list

1. The panel sends the CSV to `POST /api/feeds/import?dryRun=true|false`.
2. The API forwards it to the Rust pricing-engine, which checks every row (SKU format, decimals, sizes, EAN check digit, duplicates, price below cost) and returns typed rows plus every error with its line number. Parsing runs on Tokio's blocking pool.
3. Without `dryRun`, valid rows are upserted by SKU in batches of 200 (one transaction per batch); a `stock` column is booked as a RECEIPT. Changed products are queued for Flow 1.

## Flow 5: sign-in in the panel

1. The login server action calls `POST /api/auth/login` and stores the access token (15 min) and the refresh token (7 days) in httpOnly cookies.
2. `apps/web/src/proxy.ts` runs before every page: when the access token expires within a minute, it calls `/api/auth/refresh` and sets the new cookies on both the request (for the page being rendered) and the response (for the browser).
3. Server Components call the API on the server with the token from the cookie; the browser never sees a token.

## Prices

Catalog prices are net, in EUR. For a marketplace with VAT `v` and commission `f` (both share of the gross price) and exchange rate `r`:

```
price = base_price * r / (1 / (1 + v) - f)      rounded up to .99
```

The seller keeps at least `base_price` after VAT and commission. All money is `numeric` in PostgreSQL, `Decimal` in Rust and a string in JSON.
