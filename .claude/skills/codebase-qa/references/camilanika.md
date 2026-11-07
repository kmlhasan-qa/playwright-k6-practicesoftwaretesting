# Project notes: CamilaNika shop (github.com/camilanika/camilanika.github.io)

Read this when the repo has `index.html` + `admin.html` + `js/shop.js` + `supabase/` (local clone: `~/camilanika-qa`). Re-verify these facts against the current code; they were true when this note was written (Nov 2026).

## What it is
- Static site on GitHub Pages (no server). `index.html` + `js/shop.js` is the customer shop (menu, cart, promo codes, login, iPaymu checkout, order history). `admin.html` is the admin dashboard (orders, stock, menus, products/variants, promos, cashflow via `js/cashflow.js` + `js/cashflow-core.js`, printable bill via `js/nota.js`). `docs.html` is the admin-only API docs.
- Supabase backend: `supabase/schema.sql` → `seed.sql` → `migrations/0NN_*.sql` in order (002–016; there's no 001). All logic lives in SQL functions (`quote_cart`, `create_order`, `mark_order_paid`, `release_order`, `release_expired_orders`, `get_order_status`, `admin_*`, and later voucher/loyalty/cashflow functions), mostly `security definer set search_path = public`, guarded by `is_admin()`/`auth.uid()`.
- Edge functions (Deno/TS) in `supabase/functions/`: `create-payment` (creates the order and gets an iPaymu payment URL), `ipaymu-webhook` (Verify JWT OFF; must re-check the transaction via iPaymu's API, never trusting the body), `phone-signup`, `admin-users`, `midtrans-webhook` (legacy, unused).
- `js/config.js` holds the public anon key (expected, fine) and `ONLINE_PAYMENT: "test"`, which enables payment only with `?test=1`.
- Business timezone: WIB (UTC+7). Currency: Rupiah, integers, formatted `id-ID` ("Rp70.000").

## Test suites (`tests/`, see `tests/README.md`)
| Suite | Command (from `tests/`) | Notes |
|---|---|---|
| unit | `npm run test:unit` | `node:test`; loads `js/cashflow-core.js`, `js/nota.js` directly (UMD-style). No DB needed. |
| db | `npm run test:db` | `db/build.sh` builds a DB from stub + schema + seed + all migrations; `db/cashflow_test.sql` records checks via `t.ok(cond, name)` into `t.results` and raises at the end if any failed. `db/backfill_test.sh` tests migration 014 on existing data. |
| ui | `npm run test:ui` | `node:test` + Playwright **library** (not @playwright/test) + Chromium. `ui/harness.js` builds DB `cn_ui`, serves the site with `ui/fake-supabase.js` replacing the Supabase client (it proxies RPC/select calls to local PG as anon/authenticated via `request.jwt.claim.sub`), and fakes the iPaymu page. Tables reachable in UI tests are allow-listed in `harness.js` (`TABLES`); extend it if a new test needs another table. |

Environment needs: Node 20+, PostgreSQL 16+ (`psql`, `initdb`, `pg_ctl` on PATH), and Playwright's Chromium (`npx playwright install chromium`, run in `tests/` after `npm install`). As of Nov 2026, this Mac had node and k6 but **no PostgreSQL**. Ask the user, then `brew install postgresql@16` and add `$(brew --prefix postgresql@16)/bin` to PATH.

Throwaway DB (keep it in the scratchpad, not /tmp, unless the user says otherwise):
```bash
PG=<scratchpad>/pg; initdb -D $PG/data -A trust -U postgres && pg_ctl -D $PG/data -o "-k $PG -p 5433" -l $PG/log start
cd tests && npm install && PGHOST=$PG PGPORT=5433 npm test
pg_ctl -D $PG/data stop   # when done
```
Note `initdb -U postgres`: the scripts connect as user `postgres`. The suites create/drop `cn_test`, `cn_backfill`, `cn_ui`. **Never** point them at the live Supabase project (`qynznqapyfxvjjeaoman`).

## Writing new tests here (match the existing style)
- Unit: `tests/unit/<module>.test.js`, `const test = require("node:test"); const assert = require("node:assert/strict");`, then require the module from `../../js/`. Known defect: `test("DEF-001 …", { todo: "DEF-001: <one line>" }, () => {...})` (use the document's DEF/OBS ID).
- DB: either add checks to a new `tests/db/<area>_test.sql` copying the `t` schema/`t.ok` pattern from `cashflow_test.sql` (and wire it into `db/run.sh`), or use `t.ok(...)` with calls under `set local role authenticated` + `set_config('request.jwt.claim.sub', <uuid>, true)` to test RLS and permissions. Put known-defect checks in a separate file so `test:db` stays green, and document them.
- UI: `tests/ui/<area>.ui.test.js` using `start()` from `./harness`; `H.open(hash, { uid, viewport, file })`, fixtures in `ui/fixtures.sql`. Admin UID `…000a`, customer UID `…000c`.
- Edge functions have no tests and Deno isn't installed. Review them by reading; if testing them is worth it, propose `deno test` with mocked `fetch` and ask first.

## Highest-value areas to inspect
1. **Money path:** `quote_cart` → `create_order` → `create-payment` → iPaymu → `ipaymu-webhook` → `mark_order_paid`. Is the total recomputed server-side? Is the amount checked against the gateway? Idempotent when a webhook arrives twice? Paid-after-expired handling? Stock held/released exactly once?
2. **Vouchers/referrals/loyalty/shipping vouchers** (migrations 011–013): single use, stacking, self-referral, min-spend, negative totals, points on cancelled orders.
3. **RLS/permissions:** can a customer read other people's orders, change their own `profiles.role`, call `admin_*` functions, or read `expenses`/`offline_orders`? Can anon call anything beyond the menu/quote/order-status? `get_order_status` needs the access token.
4. **XSS:** `shop.js` uses an `esc()` helper; verify every interpolation in `admin.html` (~76 `innerHTML` sinks) and `js/cashflow.js` escapes customer-controlled fields (names, notes, addresses, promo codes), especially in the admin panel (stored XSS → admin session).
5. **Time and dates:** WIB boundaries in cashflow presets and shop hours (007), `release_expired_orders` timing.
6. **Delivery/map** (008, Leaflet in admin): fee calculation, z-index/mobile modal bugs (there are branches `map-zindex`, `modal-mobile`, `cashflow-render-race`, which hint at past problem areas).
7. **No CI:** tests only run locally (Info).

Test document: as of Nov 2026 this repo had no `docs/test-cases-and-automation.docx`, so the first codebase-qa or test-research run creates it (see SKILL.md step 5). Suggested catalogue areas: MENU (menu/products), CART (cart/quote), PROMO (promos/vouchers/referrals/loyalty), PAY (checkout/iPaymu/webhook), ORD (orders/status/history/nota), AUTH (login/phone signup/accounts), ADMIN (admin dashboard/stock/users), CASH (cashflow), DLV (delivery/shop hours), DB (RLS/permissions/migrations), NF (non-functional: mobile, a11y, perf). The repo has no root README, so there's no README defect table to update. Don't add one to the live site repo without asking.
