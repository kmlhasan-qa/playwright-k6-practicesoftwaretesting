# Inspection checklist (per layer)

Treat each item as a question to answer with evidence, not a box to tick. Skip items that don't apply, and note any that couldn't be checked.

## 1. Frontend logic (JS/TS)
- Money: integer arithmetic? Floating-point (`parseFloat`, `toFixed`, `* 1.1`)? Rounding consistent with the server? Locale parsing ("1.000" in id-ID is one thousand)? Negative or zero quantities?
- Dates and timezones: are "today/this month" computed in the business timezone (for example WIB, UTC+7) or the browser's? Month boundaries, DST, ISO strings vs `new Date(y, m, d)`.
- State: cart/localStorage stale after a price or stock change; double-submit (button not disabled during a request); race between parallel fetches (an older response overwriting a newer one); state after logout.
- Error handling: unhandled promise rejections, a failed fetch shown as success, a spinner that never stops, partial writes.
- Input validation exists client-side **and** is enforced server-side (client checks are UX, not security).

## 2. HTML / XSS / UX
- Every `innerHTML`/template insertion of data from the DB, URL or user: escaped? Attribute contexts (`href`, `src`, `on*`, `style`) need more than HTML escaping: block `javascript:` URLs.
- Data an admin sees that customers wrote (names, notes, addresses): stored XSS into the admin panel is High.
- `target="_blank"` without `rel="noopener"`. Inline event handlers built from data.
- Forms: labels, required fields, numeric inputs, mobile layout (≤375px), keyboard and focus, modals that trap or lose focus, the back button and hash routing.
- Admin pages: is access enforced by the server (RLS/role checks), not just by hiding the UI?

## 3. Backend / edge functions / API
- Auth: is the JWT verified? Is the user ID taken from the token, not the body? Are role checks done server-side?
- Is input trusted from the client for price, total, discount, stock, user ID or status? The server must recompute prices from the DB.
- CORS: origin allow-list vs `*`; preflight handling.
- Secrets read from env, never returned in responses or logs. Is the service-role client used only where needed, and with no user-controlled filters?
- Idempotency: retries, double clicks, and a webhook delivered twice must not double-charge, double-credit or double-decrement stock.
- Error paths: does a failure leave a half-created order or held stock? Is it rolled back or released?

## 4. Database (SQL, RLS, functions)
- Every table has RLS enabled. Each policy's `using` and `with check` is correct for select, insert, update and delete. Can a user update their own row's `role`, `balance` or `status` columns?
- `security definer` functions: `set search_path`; check the caller's identity or role inside; validate arguments; no dynamic SQL from arguments. Who has `execute` (default PUBLIC!)? `revoke ... from public` where needed.
- Grants to `anon`: is each one intended?
- Constraints: NOT NULL, CHECK (quantity > 0, price ≥ 0), FK, unique (order number, voucher code per user). Stock can't go negative under concurrency (`update ... where stock >= n`, or row locks).
- Migrations: apply cleanly in order on a fresh DB **and** on an existing DB with data; re-runnable where claimed (`if not exists`); backfills correct.
- Triggers: recursion, missed cases (update vs insert), behaviour on delete.
- Time: `now()` vs business-timezone dates in reports.

## 5. Payments, vouchers, loyalty, webhooks
- Amount charged = the server-computed total, and the webhook verifies the amount and order against the gateway, not the notification body.
- Signature or callback verification; unknown order; amount mismatch; replayed or duplicate notifications; out-of-order status (paid after expired).
- Status machine: every transition is valid; terminal states stay terminal; stock released on expiry/cancel exactly once.
- Vouchers/promos/referrals/points: single use per user enforced in the DB; stacking rules; minimum spend after discounts; self-referral; negative totals; shipping discount > shipping fee; points earned on cancelled orders.
- Test vs live mode switches can't be flipped by a customer (URL params, localStorage).

## 6. Config, secrets, deploy
- Only public keys in client config (an anon key is fine; service role/API keys are not). Search git history for leaked secrets if relevant (`git log -p -S`).
- Hosting specifics (GitHub Pages: no server, everything is public; `.nojekyll`).
- Third-party scripts pinned and loaded from trusted origins (or vendored).

## 7. Tests and CI
- Does every documented suite run? Are any tests flaky (run twice), skipped, or asserting nothing?
- Coverage of critical flows: map each flow to the tests that exercise it. Note untested ones.
- Is there CI? If not, recommend it (Info).
