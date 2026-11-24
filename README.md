# MarketHub

Catalog, stock and order hub for a furniture seller that sells on several marketplaces at once: Amazon, eBay, OTTO and Kaufland.

- One catalog and one stock in PostgreSQL.
- Prices and stock are pushed to every marketplace through BullMQ queues: one queue per marketplace, its own rate limit, retries with exponential backoff, a pause on HTTP 429.
- Orders come back by signed webhook and by polling. Each order is stored once and reserves stock without overselling, even when two marketplaces sell the last unit at the same moment.
- A Rust service calculates the price for each marketplace (currency, VAT, commission, rounding to .99) and validates supplier price lists.
- A Next.js panel for the team: overview, products, listings, orders, price list import.

> Pet project. The marketplace APIs are replaced by local mock services that behave like the real ones: different payload formats, rate limits, random 429/500/503 answers, duplicated webhooks.

## Architecture

```mermaid
flowchart LR
  web["web<br/>Next.js panel"] -->|REST| api["api<br/>NestJS"]
  api -->|REST| pe["pricing-engine<br/>Rust, axum"]
  api -->|jobs| redis[(Redis)]
  redis --> worker["worker<br/>NestJS + BullMQ"]
  worker -->|REST| pe
  worker -->|"push listings<br/>pull orders"| mock["mock marketplaces<br/>Amazon · eBay · OTTO · Kaufland"]
  mock -->|signed webhooks| api
  api --> pg[(PostgreSQL)]
  worker --> pg
  pe --> pg
```

| Part | Technology | Path |
|---|---|---|
| REST API | NestJS 12, TypeScript, Prisma 7, class-validator, Swagger | [apps/api](apps/api) |
| Queue worker | Same codebase, second entry point, BullMQ 6 | [apps/api/src/worker](apps/api/src/worker) |
| Pricing and price-list validation | Rust: axum, tokio, sqlx, rust_decimal, csv | [services/pricing-engine](services/pricing-engine) |
| Admin panel | Next.js 16, React 19, Tailwind CSS 4, server actions | [apps/web](apps/web) |
| Marketplace stand-ins | Express 5 | [apps/mock-marketplaces](apps/mock-marketplaces) |
| Data | PostgreSQL 17, Redis 7 | [docker-compose.yml](docker-compose.yml) |
| CI | GitHub Actions: lint, unit, e2e on real PostgreSQL and Redis, clippy, Docker builds | [.github/workflows/ci.yml](.github/workflows/ci.yml) |

More: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) (flows step by step) and [docs/DECISIONS.md](docs/DECISIONS.md) (why it is built this way).

## Run everything in Docker

```bash
docker compose --profile app up --build
```

Then open http://localhost:3001 and sign in with `admin@markethub.local` / `admin12345` (demo data, local only).

| URL | What |
|---|---|
| http://localhost:3001 | admin panel |
| http://localhost:3000/docs | Swagger |
| http://localhost:3000/api/admin/queues | queue dashboard (`admin` / `change-me-please`) |
| http://localhost:3002/_admin/state | what the mock marketplaces received |

The mock marketplaces create a random order every 20 seconds, so the panel fills up on its own.

## Run for development

Requirements: Node.js 22+, pnpm 10, Docker, Rust stable.

```bash
pnpm install
docker compose up -d postgres redis              # PostgreSQL on :5433, Redis on :6379

# API (terminal 1)
cd apps/api && cp .env.example .env
pnpm prisma:generate && pnpm db:deploy && pnpm db:seed
pnpm start:dev                                   # http://localhost:3000

# Queue worker (terminal 2)
cd apps/api && pnpm start:worker

# Rust pricing-engine (terminal 3)
cd services/pricing-engine
DATABASE_URL=postgres://markethub:markethub@localhost:5433/markethub cargo run

# Mock marketplaces (terminal 4)
cd apps/mock-marketplaces && cp .env.example .env && pnpm start:dev

# Panel (terminal 5)
cd apps/web && pnpm dev                          # http://localhost:3001
```

## Tests

```bash
cd apps/api && pnpm test          # unit: connectors, error mapping, money
cd apps/api && pnpm test:e2e      # whole app against PostgreSQL and Redis (database markethub_test)
cd services/pricing-engine && cargo test
```

Things the tests prove:

- 20 parallel write-offs of 1 unit with 5 in stock: exactly 5 succeed, stock ends at 0.
- Two marketplaces order the last unit at the same moment: one order is reserved, the other is backordered.
- The same webhook delivered twice, and the same order seen by webhook and by polling: stored once, stock reserved once.
- A reused refresh token revokes every session of the user; two parallel refreshes can't both win.
- An order can't be shipped twice; cancelling returns the reservation.
- Four different marketplace order formats become the same order.
- Rust: the seller keeps at least the catalog net price after VAT and commission; prices are exact decimals.

## Main API routes

| Route | |
|---|---|
| `POST /api/auth/login`, `/refresh`, `/logout`, `GET /api/auth/me` | JWT access token + rotating refresh token |
| `GET/POST/PATCH/DELETE /api/products` | catalog; `GET /api/products/:id/prices` asks the Rust service |
| `GET/POST /api/inventory/:productId/movements` | stock receipts and corrections |
| `GET/POST /api/listings`, `POST /api/listings/:id/publish` | products on marketplaces |
| `GET /api/orders`, `POST /api/orders/:id/ship`, `/deliver`, `/cancel` | orders |
| `POST /api/webhooks/:marketplace` | signed order webhooks |
| `POST /api/feeds/import?dryRun=true` | supplier CSV price list |
| `GET /api/dashboard` | panel overview |

Full list with request and response schemas: Swagger at `/docs`.
