# MarketHub

Catalog, stock and order hub for a furniture seller that sells on several marketplaces at once (Amazon, eBay, OTTO, Kaufland).

One catalog and one stock in PostgreSQL. Prices and stock are pushed to every marketplace through BullMQ queues with retries and rate limits, orders come back by webhook or polling and reserve stock without overselling, and a Rust service calculates marketplace prices and validates supplier price lists.

> Pet project. The marketplace APIs are replaced by local mock services that behave like the real ones (rate limits, 429 and 500 answers, webhooks).

Work in progress, see [the plan](#status).

## Stack

| Part | Technology |
|---|---|
| API and queue worker | NestJS 12, TypeScript, Prisma 7, class-validator, Swagger |
| Pricing and price-list validation | Rust: axum, tokio, sqlx, rust_decimal |
| Database | PostgreSQL 17 |
| Queues, cache, rate limits | Redis 7, BullMQ |
| Admin panel | Next.js, React |
| Infrastructure | Docker Compose, GitHub Actions |

## Run locally

Requirements: Node.js 22+, pnpm 10, Docker, Rust (stable).

```bash
pnpm install
pnpm infra:up                          # PostgreSQL on :5433, Redis on :6379

cd apps/api
cp .env.example .env
pnpm prisma:generate
pnpm db:deploy                         # apply migrations
pnpm db:seed                           # demo catalog, marketplaces, users
pnpm start:dev                         # http://localhost:3000/api, Swagger on /docs
```

Demo users (local only): `admin@markethub.local` / `admin12345`, `manager@markethub.local` / `manager12345`.

## Status

- [x] Monorepo, Docker Compose with PostgreSQL and Redis
- [x] NestJS core: products, stock, marketplaces, listings, validation, Swagger
- [x] Auth: JWT access tokens, rotating refresh tokens with reuse detection, roles, audit log
- [ ] Rust pricing-engine
- [ ] Mock marketplaces
- [ ] BullMQ sync: listings push, orders pull, retries, rate limits
- [ ] Orders and stock reservation
- [ ] Redis cache
- [ ] Automation rules
- [ ] Next.js admin panel
- [ ] CI
