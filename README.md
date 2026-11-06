# Practice Software Testing – Toolshop: UI, API & performance tests

Test automation for the public demo **[Practice Software Testing – Toolshop](https://practicesoftwaretesting.com)** (Sprint 5, [API v5](https://api.practicesoftwaretesting.com/api/documentation)). The workflow under test is **checkout**: browse → cart → sign in → billing address → payment → order (invoice).

| Deliverable | Location |
|---|---|
| UI + API automation (Playwright + TypeScript) | `tests/`, `pages/`, `fixtures/`, `helpers/` |
| Postman collection (+ last run result) | `postman/toolshop-api.postman_collection.json`, `postman/results/` |
| k6 performance script (+ smoke result) | `perf/checkout-load.js`, `perf/results/` |
| Test cases, defect reports, API & performance write-up | `docs/assessment-report.md` |
| Every run command on one page | [`RUN_COMMANDS.md`](RUN_COMMANDS.md) |

---

## 1. Setup and execution

**Prerequisites:** Node.js 20+ (22 recommended), npm, and [k6](https://k6.io/docs/get-started/installation/) for the performance tests.

```bash
git clone <this-repo-url>
cd <repo>
npm ci
npx playwright install --with-deps chromium
cp .env.example .env        # optional – every value has a default
```

| Command | What it runs |
|---|---|
| `npm test` | all Playwright tests (API + UI) |
| `npm run test:api` | API project only (no browser) |
| `npm run test:ui` / `npm run test:headed` | UI project, headless / headed |
| `npm run test:e2e` | the successful end-to-end checkout (TC-UI-001) |
| `npm run test:defects` | executable defect reports only |
| `npm run test:postman` | Postman collection via newman |
| `npm run perf:smoke` | k6 smoke profile (safe for the public demo) |
| `npm run perf:load` | full k6 load model – **only against an environment you own** |
| `npm run report` | open the last HTML report |

See [`RUN_COMMANDS.md`](RUN_COMMANDS.md) for the full list.

Environment variables (`.env` or shell): `BASE_URL`, `API_URL`, `HEADLESS`, `CUSTOMER_EMAIL`, `CUSTOMER_PASSWORD`. The k6 script takes `PROFILE`, `API_URL` and `USER_POOL`.

**CI:** `.github/workflows/playwright.yml` runs the `api` and `ui` projects plus the Postman collection on every push, every PR and nightly, and uploads the reports. The k6 smoke run is manual only (workflow_dispatch), so the public demo never gets automatic load.

**Last local run (6 Nov 2026):**
- Playwright: 40 passed (33 functional tests; the other 7 are known-defect tests that fail as expected).
- newman: 33 requests, 56/56 assertions passed.
- k6 smoke: every threshold passed; 119 orders with 0% errors.

---

## 2. Framework structure

```
├── fixtures/index.ts          # custom test: api, customer (fresh registered user), page objects
├── helpers/
│   ├── config.ts              # env-driven config, billing address, business rules (qty 1–99)
│   ├── api.client.ts          # ToolshopApi – typed wrapper over the REST API
│   └── data.factory.ts        # unique customers, card data with relative expiry dates
├── pages/
│   ├── home.page.ts           # search + product cards
│   ├── product.page.ts        # product detail, quantity, add to cart
│   └── checkout.page.ts       # 4-step checkout wizard (cart, sign in, address, payment)
├── tests/
│   ├── api/                   # project "api"
│   │   ├── auth.spec.ts       # register, login, password policy, age rule, breached passwords
│   │   ├── products.spec.ts   # list contract, detail, search, 404
│   │   ├── cart.spec.ts       # cart CRUD + quantity boundary values
│   │   ├── checkout.spec.ts   # payment check + order creation, auth, validation
│   │   └── defects.spec.ts    # executable defect reports (test.fail)
│   └── ui/
│       └── checkout.e2e.spec.ts   # TC-UI-001 E2E, TC-UI-002 negative, TC-UI-003 regression
├── postman/                   # collection + newman JUnit result
├── perf/checkout-load.js      # k6 load model (smoke | load)
├── docs/assessment-report.md  # test cases, defects, API & performance approach
└── .github/workflows/playwright.yml
```

### The two high-value automated scenarios

| ID | Type | Scenario | Why it matters |
|---|---|---|---|
| **TC-UI-001** | Successful E2E | A new customer searches for a product → adds **2 units** → checks the cart total → signs in during checkout → completes the billing address through the postcode lookup → pays by credit card → confirms. The test then checks the invoice through the API: invoice number, total = 2 × unit price, the line item, the billing address and the payment method. | Checkout is the revenue path. The test proves the order was actually **persisted correctly**, not only that a "thank you" text appeared. |
| **TC-UI-002** | Negative / validation | An expired card (last month, the boundary) shows *"Expiration date must be in the future."* and disables **Check payment**. The test also checks that **no request** reaches `/payment/check` or `/invoices`, that the customer has no order, and that the cart is kept. | Payment validation is a high-risk area. Asserting on the network traffic as well as the UI catches a regression where the button stays enabled or the order is created anyway. |
| TC-UI-003 | Regression (`@defect`) | DEF-001: when the API rejects the order (422), the UI must tell the customer. Today it fails silently and still shows "Payment was successful". | An executable defect report: it turns green when the defect is fixed. |

### Design decisions

- **Two Playwright projects, one config.** The `api` project never starts a browser, so it is fast enough to run on every commit. The `ui` project uses Desktop Chrome.
- **Page Object Model + custom fixtures.** Specs read like the business flow, and each locator is defined once. Locators use the app's own `data-test` hooks (`testIdAttribute: 'data-test'`), which are more stable than CSS or text.
- **A fresh customer for every test.** The `customer` fixture registers a unique user through the API and logs in. Order history is then isolated from other runs and from other people using the shared demo, so tests can make exact assertions such as "this customer has exactly 1 invoice".
- **The API verifies what the UI did.** The E2E test reads the invoice back through the API, which avoids brittle text checks and catches persistence bugs.
- **Nothing hard-coded that the environment can change.** The demo database is reset periodically and product IDs are regenerated (seen during development). Tests look up a purchasable product at runtime. The billing city and state come from `GET /postcode-lookup`, because the API validates against it (the demo lookup uses a deterministic fake data generator, so real city names fail).
- **Waiting on application state, not on time.** The checkout pre-fills the saved address asynchronously, and the postcode lookup can be overwritten by it (see OBS-2). The page object waits for the pre-fill, then retries the lookup until the form holds exactly the lookup values. There are no fixed sleeps in the specs.
- **Request rewriting for a deterministic negative test.** TC-UI-003 uses `page.route` to put the customer's saved city into the real `POST /invoices` request. The real server returns its real 422, and the test observes how the UI reacts. Without this, the defect only reproduces when the timing is right.
- **Executable defects.** Tests tagged `@defect` assert the *correct* behaviour and are wrapped in `test.fail()`. CI stays green while a defect is open and turns red when it is fixed, which prompts removing the annotation.
- **Boundary values and data-driven tests** for cart quantity (0/1/99/100, decimal, text), password length (7/8) and card expiry (last month).
- **Diagnostics on failure only:** screenshot, video and trace, plus HTML and JSON reporters. Failing assertions include the request and response bodies.

---

## 3. Defects found (summary)

Full structured reports: `docs/assessment-report.md`.

| ID | Severity | Summary | Covered by |
|---|---|---|---|
| DEF-001 | **High** | When `POST /invoices` is rejected, the UI shows no error and keeps showing "Payment was successful". The customer believes the order went through. | TC-UI-003 |
| DEF-002 | **High** | The same cart can be checked out repeatedly, and every call creates a new order (double-click, retry or second tab gives duplicate orders). | TC-API-040, Postman |
| DEF-003 | **High** | An order (invoice of 0.00) can be created for an **empty cart**. | TC-API-041, Postman |
| OBS-1 | Medium | The quantity limit of 99 can be bypassed by adding the same product twice (line quantity 120). | TC-API-042 |
| OBS-2 | Medium | Race on the address step: the asynchronously pre-filled saved address can overwrite the postcode-lookup values, or the other way round. | page object workaround |
| OBS-3 | Medium | `POST /payment/check` returns "Payment was successful" for an unknown method (`bitcoin`) and for an empty body. | TC-API-043 |
| OBS-4 | Medium | A malformed credit card on `POST /invoices` returns **500** instead of 422. | TC-API-044 |
| OBS-5 | Low | `billing_postal_code` is required by the API spec but can be omitted (201), which also skips the address check. | TC-API-045 |

---

## 4. Performance test (summary)

`perf/checkout-load.js` uses an **open workload model** (arrival-rate executors). One iteration is one customer order (`POST /carts` → `POST /carts/{id}` → `POST /invoices`), and the rates apply to the booking call:

| Phase | Executor | Rate | Duration (load profile) |
|---|---|---|---|
| normal | constant-arrival-rate | 5 orders/s | 5 min |
| ramp_up | ramping-arrival-rate | 5 → 20/s | 5 min |
| peak | constant-arrival-rate | 20/s | 5 min |
| recovery | constant-arrival-rate | 5/s | 3 min |

**Thresholds:**
- Order success > 99%, checks > 99%.
- Booking error rate < 1%.
- Booking p95 < 1 s at normal load and < 1.5 s at peak.
- Cart calls p95 < 800 ms; full order flow p95 < 3 s.
- Fewer than 10 dropped iterations.
- The run aborts if the overall error rate goes above 5%.

The workload model, metrics, threshold reasoning and limitations are explained in `docs/assessment-report.md` §4.

---

## 5. What I would improve with more time

- **Own environment.** Run the Toolshop locally with Docker Compose (the upstream project ships a `docker-compose.yml`) in CI. Tests would then not depend on, or pollute, the shared demo, the database could be reset per run, and the full k6 load profile could run.
- **More checkout coverage:** the other payment methods (bank transfer, gift card, buy-now-pay-later instalments), guest checkout (`/invoices/guest`), and changing the quantity or removing a line in the cart through the UI.
- **Contract tests** generated from the OpenAPI spec (e.g. `ajv` against `/docs?api-docs.json`) instead of hand-written `toMatchObject`.
- **Session reuse** with `storageState` for UI tests that don't need to exercise login.
- **Cross-browser and mobile** projects, accessibility checks (`@axe-core/playwright`) and visual snapshots of the checkout steps.
- **Performance:** a per-phase HTML report (k6 web dashboard), server-side metrics (APM, DB) correlated with the k6 run, and a soak test (normal rate for 1–2 h) to find leaks and token-refresh problems.
- **Defect workflow:** link `@defect` tests to tracker IDs and post the pass/fail summary to Slack/Teams from the JSON report.
