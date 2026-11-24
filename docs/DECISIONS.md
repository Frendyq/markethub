# Decisions

Why it is built this way, and what was traded for it.

## One queue per marketplace

Each marketplace has its own BullMQ queue and its own worker. The worker's limiter is set from `marketplaces.rate_limit_per_sec`, so we never send more than the marketplace allows, and a slow or failing marketplace can't hold up the others.

Concurrency is 1 per marketplace: jobs for one marketplace run in order, so an older state can't overwrite a newer one. Throughput is bounded by the marketplace limit anyway (3-5 requests per second).

Alternative: one shared queue with a global limiter. Simpler, but one marketplace's 429s would slow every marketplace.

## Jobs carry ids, not data

A `push-listing` job contains only the listing id. The worker reads the current price and stock when it runs. A job that waited for a minute, or was retried five times, still pushes the latest state.

## Deduplication: job id with a state hash, plus a "nothing changed" check

The job id is `listing-<id>-<hash of the state>`. Two identical changes queued while the first job waits are one job. A different state gets a new job.

The worker also compares the payload hash with `last_sync_hash` and skips the API call when the marketplace already shows exactly that. Extra jobs are cheap.

Completed jobs are removed at once (`removeOnComplete: true`), otherwise their ids would block the same state from being queued again later (5 -> 4 -> 5 units). Failed jobs are kept for a day for the dashboard; a manual retry adds a timestamp to the id.

## Exactly-once orders: database constraints, not checks in code

Orders are unique on `(marketplace_id, external_id)` and webhook events on `(marketplace_id, event_id)`. Both are inserted with `ON CONFLICT DO NOTHING` inside the order transaction. A check in code ("does this order exist?") followed by an insert lets two concurrent deliveries both pass.

The webhook event id is recorded in the same transaction as the order. If the transaction fails, the event is not marked as processed, so the marketplace's retry is handled normally.

## No overselling: row locks and CHECK constraints

Reservation locks the inventory rows with `SELECT ... FOR UPDATE`, in product id order so that two orders for the same products can't deadlock. Stock corrections are one `UPDATE ... WHERE on_hand + :q >= reserved`.

As a last line of defence the table has `CHECK (reserved <= on_hand)` and `CHECK (on_hand >= 0)`: even a bug in the application can't produce negative stock.

An order is reserved as a whole or not at all (BACKORDERED). Partial reservation would need partial shipping, which the marketplaces handle differently; out of scope.

## Never call the network inside a transaction

Jobs are queued after the commit. A transaction that waits for Redis or a marketplace holds row locks and a pooled connection the whole time.

Trade-off: if the process dies between the commit and the queueing, a push is lost until the next change. A transactional outbox (write the job to a table in the same transaction, a relay moves it to Redis) would close that gap; the polling of orders and "push now" in the panel cover it for now.

## A worker process separate from the API

Same codebase, second entry point (`worker.ts`, `createApplicationContext`, no HTTP). The API stays fast whatever the marketplaces do, and the two scale separately.

## Rust for pricing and price lists

The pricing-engine does the arithmetic and parsing work: exact decimal prices for every marketplace and validation of price lists up to 50 000 rows. Rust gives exact decimals (`rust_decimal`), fast CSV parsing on a blocking thread pool, and a small (122 MB) image. It only reads the marketplace terms and rates from PostgreSQL; writes stay in the NestJS API, so there is one owner of the schema (Prisma migrations).

## Money

`numeric(12,2)` in PostgreSQL, `Decimal` in Prisma and Rust, strings in JSON ("1283.99"). JavaScript numbers can't hold every decimal exactly, so money is never a `number` in the API. Prices are rounded up to .99: rounding up means the seller never gets less than calculated.

## Refresh tokens

Opaque, random, stored as SHA-256, rotated on every use. Reusing a rotated token means someone has a copy: every session of that user is revoked. A reuse within 10 seconds is treated as two parallel requests of the same browser and only refused, so the user isn't signed out by a race. Revocation uses `UPDATE ... WHERE revoked_at IS NULL` and checks the row count, so two parallel refreshes can't both succeed.

The panel keeps tokens in httpOnly cookies (no JavaScript access) and refreshes them in `proxy.ts`, because Server Components can't set cookies.

## Prisma 7 with the pg driver adapter

Type-safe queries and readable migrations. Where Prisma can't express a query (row locks, `ON CONFLICT DO NOTHING`, column-to-column comparisons) the code uses `$queryRaw` with tagged templates, which are parameterized.

## Mock marketplaces instead of sandboxes

Real sandboxes need seller accounts. The mocks keep the shape of the real APIs (different payloads per marketplace, cents for Kaufland, one position per unit for OTTO) and add what makes integration code interesting: rate limits, random 5xx, latency and duplicated webhooks.

## What is not there yet

- Transactional outbox for queueing after commit.
- Partial reservation and partial shipping.
- Metrics (Prometheus) and tracing.
- Automation rules ("stock below 3: pause on OTTO").
- Desktop warehouse app (Tauri), planned as a separate project on top of this API.
