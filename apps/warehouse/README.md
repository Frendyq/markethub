# MarketHub Warehouse

Desktop app for the warehouse, built with **Tauri v2** (Rust) and **React**. It works on top of the MarketHub API: a picker scans the items of an order, prints the shipping label and ships it; the same app books deliveries and stock counts. It keeps working without a network.

| Screen | What happens |
|---|---|
| Picking | orders with reserved stock, oldest first; lines sorted by warehouse location so the picker walks the aisles once |
| Order | scan each item (USB scanner or typed); wrong item, bad barcode or one too many is refused with a sound; label and Ship unlock when everything is scanned |
| Label | 100 × 150 mm SVG with a Code 128 barcode, generated in Rust, printed with the system dialog (or saved as PDF) |
| Receiving | scan the box, enter the quantity: a stock receipt |
| Stock count | scan the shelf, enter what is there: the difference becomes a correction |
| Sync queue | operations not confirmed by the server yet; refused ones show the reason, with Try again / Discard |

## How it is built

```
React (system WebView)  ──invoke──►  src-tauri/src/commands.rs   (thin Tauri layer)
                        ◄─events───          │
                                             ▼
                                   src-tauri/core  (warehouse-core, no Tauri)
                                   ├─ api.rs     HTTP client, token refresh
                                   ├─ vault.rs   refresh token in the OS credential store
                                   ├─ store.rs   SQLite: settings, picking cache, scans, outbox
                                   ├─ sync.rs    background sender of the outbox
                                   ├─ scan.rs    EAN-13 check, scan against the order
                                   └─ label.rs   shipping label SVG with Code 128
```

- **The interface has no network access.** It only calls Rust commands; the CSP allows nothing else and the capability file grants only the core permissions. Tokens never reach JavaScript.
- **Refresh token in the OS credential store** (Windows Credential Manager, macOS Keychain, Linux keyutils); the access token only in memory.
- **Offline first.** Shipping, receiving and corrections are written to an outbox in SQLite and sent by a background task. The outbox id is sent as `Idempotency-Key`: if the connection drops after the server applied the operation, the retry is recognised and nothing happens twice.
- **Retries:** no network or 5xx: retry after 2, 4, 8 … 60 s, strictly in order. 4xx (cancelled meanwhile, not enough stock): "refused", a person decides. 401: waits for a new sign-in.
- **`warehouse-core` doesn't depend on Tauri**, so its logic is tested on its own, against a fake HTTP server (wiremock) and an in-memory SQLite.

## Run

Needs the MarketHub API (see the root README), Node.js 22, pnpm, Rust.

```bash
pnpm install
pnpm tauri dev            # opens the app; the API address is in Settings (default http://localhost:3000)
pnpm test                 # interface tests (Vitest, Tauri IPC mocked)
pnpm test:rust            # warehouse-core tests
pnpm tauri build          # Windows installers (MSI, NSIS); CI builds them on every push to main
```

Windows with the GNU (MinGW) Rust toolchain works: the library crate is built as `rlib` only, because `cdylib` (needed for mobile) overflows the MinGW export table.
