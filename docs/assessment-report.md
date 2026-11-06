# QA Assessment – Practice Software Testing (Toolshop)

**Author:** Kamal Hasan · **Date:** 6 November 2026
**Application:** <https://practicesoftwaretesting.com> (Sprint 5, UI v2.5 / Angular 20) · **API:** <https://api.practicesoftwaretesting.com> (Toolshop API v5.0.0)
**Repository:** _<GitHub link>_ · **Postman collection:** `postman/toolshop-api.postman_collection.json`

---

## 1. Test case design

### 1.1 Workflow chosen: checkout (placing an order)

Checkout is this e-commerce app's equivalent of "creating a booking". It carries the most business risk: money, stock and customer trust. It also touches the most components: catalogue, cart, authentication, address validation, payment and invoicing.

```
Product page ─► Cart (step 1) ─► Sign in (step 2) ─► Billing address (step 3) ─► Payment (step 4) ─► Confirm ─► Invoice INV-xxxx
  POST /carts      GET /carts      POST /users/login    GET /postcode-lookup        POST /payment/check   POST /invoices
  POST /carts/{id}                                                                                         DELETE /carts/{id}
```

**Rules learned from the API spec, the application source and exploration:**

| Area | Rule |
|---|---|
| Cart quantity | Integer from 1 to 99 per add or update |
| Billing address | All fields required. City and state must equal what `GET /postcode-lookup` returns for the country and postcode. The postcode must match the country's format (e.g. NL `1234AB`, AT `1234`). |
| Payment | 5 methods. Credit card: number format `xxxx-xxxx-xxxx-xxxx`, expiry `MM/YYYY` after today, CVV 3–4 digits, holder name required. Gift card: number and validation code required. |
| Order | Requires authentication (or the separate guest endpoint) and an existing cart |
| Registration (pre-condition) | Password at least 8 characters with upper case, lower case, a number and a symbol, and not found in a known data breach. Customer must be 18–75 years old. Email must be unique. |

### 1.2 Test cases

Priority: **P1** = must pass for release, **P2** = important, **P3** = nice to have. **Auto** = where the case is automated (UI = Playwright UI, API = Playwright API, PM = Postman).

| ID | Type | Title | Pre-conditions / data | Steps | Expected result | Prio | Auto |
|---|---|---|---|---|---|---|---|
| TC-01 | Positive | Registered customer completes checkout (credit card) | New customer, in-stock product | Add 2 units → cart → sign in → country NL, postcode 3511AA, house no. 1 → pay by valid card → Check payment → Confirm | "Payment was successful", then "Thanks for your order! Your invoice number is INV-…". Cart badge cleared. The invoice exists with 1 line of qty 2, total = 2 × unit price, status AWAITING_FULFILLMENT. | P1 | UI-001, API-030, PM |
| TC-02 | Positive | Cart shows correct line and total | Product price P | Add qty 2 → open cart | Line qty 2, line price 2P, cart total 2P | P1 | UI-001 |
| TC-03 | Positive | Address is completed by postcode lookup | At the address step | Select country, enter postcode and house number | Street, city and state are filled with the lookup result. Proceed is enabled. | P1 | UI-001 |
| TC-04 | Positive | Each payment method can be used | Cart with 1 item | Repeat TC-01 with bank transfer, cash on delivery, BNPL and gift card | Each gives "Payment was successful" and an invoice | P2 | API-030 (card), PM (COD) |
| TC-05 | Negative | Expired credit card | At the payment step | Card with expiry = last month | "Expiration date must be in the future." Check payment disabled. No request to `/payment/check` or `/invoices`. Cart kept. | P1 | UI-002, API-034, PM |
| TC-06 | Negative | Invalid card fields | At the payment step | Number `abc`, CVV `1`, empty holder name | A field error for each invalid field. Payment not accepted. | P1 | API-035 |
| TC-07 | Negative | Gift card without details | At the payment step | Gift card, empty number and code | Both fields reported as required | P2 | API-036 |
| TC-08 | Negative | Billing city does not match postcode | API | `POST /invoices` with the real city "Utrecht" for 3511AA | 422 "The city does not belong to the selected country". **In the UI the customer must see this error** (see DEF-001). | P1 | API-032, UI-003 |
| TC-09 | Negative | Order without authentication | API | `POST /invoices` without a token | 401, no invoice | P1 | API-031, PM |
| TC-10 | Negative | Order for an unknown cart | API | `cart_id = does-not-exist` | 404 | P2 | API-033, PM |
| TC-11 | Negative | Order for an empty cart | API | New cart, no items → `POST /invoices` | 422, no invoice (**fails – DEF-003**) | P1 | API-041, PM |
| TC-12 | Negative | Same cart checked out twice | API | `POST /invoices` twice with the same `cart_id` | Second call rejected; exactly 1 invoice (**fails – DEF-002**) | P1 | API-040, PM |
| TC-13 | Negative | Wrong password at the checkout sign-in step | At step 2 | Valid email, wrong password | 401, error shown, checkout does not continue | P2 | API-002, PM |
| TC-14 | Boundary | Cart quantity 0 / 1 / 99 / 100 | Cart exists | Add with each quantity | 0 → 422, 1 → 200, 99 → 200, 100 → 422 ("must not be greater than 99") | P1 | API-021, PM |
| TC-15 | Boundary | Cart quantity type checks | Cart exists | Quantity −1, 1.5, "abc" | 422 with a quantity error | P2 | API-021 |
| TC-16 | Boundary | Quantity limit across repeated adds | Cart exists | Add 60, then add 60 again | Rejected, or capped at 99 (**fails – OBS-1: 120**) | P2 | API-042, PM |
| TC-17 | Boundary | Card expiry this month vs last month | At the payment step | Expiry = last month; expiry = 24 months ahead | Last month rejected; future accepted | P1 | UI-002, API-034, API-030 |
| TC-18 | Edge | Customer's saved address vs lookup | Customer with a saved address | Sign in → address step, keep the pre-filled address, continue | Either the saved address is accepted, or the customer is told to fix it **before** paying. Never a silent failure (DEF-001, OBS-2). | P1 | UI-003 |
| TC-19 | Edge | Double-click on Confirm | At the confirm step | Click Confirm twice quickly | Exactly one order | P1 | (API-040 covers the API side) |
| TC-20 | Edge | Unknown payment method | API | `POST /payment/check` `{payment_method:"bitcoin"}` and `{}` | 422 (**fails – OBS-3: 200 "successful"**) | P2 | API-043, PM |
| TC-21 | Edge | Product price shown = price charged | Any product | Compare product page, cart and invoice unit price | Identical | P1 | UI-001 |
| TC-22 | Pre-condition | Registration rules | – | Password with 7 characters / no upper case / no symbol / a known breached password; DOB 17 years ago; duplicate email | 422 with a rule message each; duplicate → 409; valid 8-character password → 201 | P2 | API-004…008, PM |

---

## 2. Defect reports

Three defects were found that matter most for the checkout workflow. Each one has an executable regression test (marked `@defect` and expected to fail until it is fixed).

### DEF-001 – A rejected order fails silently after "Payment was successful"

| Field | Value |
|---|---|
| **Severity / Priority** | High / P1 |
| **Component** | Web UI – Checkout, step 4 (Payment / Confirm) |
| **Environment** | practicesoftwaretesting.com, UI v2.5 (built 2026-10-11), Chrome 158 (Playwright), macOS. Found 6 Nov 2026. |
| **Pre-conditions** | Signed-in customer with ≥1 item in the cart, and a billing address the API rejects. In normal use this happens when the customer's saved address is used, e.g. city "Utrecht" for postcode 3511AA (the lookup expects "Banholt"). It depends on timing; see OBS-2. |
| **Steps to reproduce** | 1. Add any product to the cart and proceed to checkout. 2. Sign in. 3. On *Billing address*, keep or enter a city that differs from the postcode lookup (e.g. Utrecht / Utrecht for NL 3511AA). 4. Proceed, choose *Cash on Delivery*, click **Check payment**. 5. Click **Confirm**. |
| **Expected result** | The order is either created, or the customer gets a clear message such as "The city does not belong to the selected country", ideally before payment, and can correct the address. "Payment was successful" should not stay on screen for an order that doesn't exist. |
| **Actual result** | `POST /invoices` returns **422** `{"billing_country":["The billing_country does not match the entered address. The city does not belong to the selected country."]}`. The UI shows **no error**. The green "Payment was successful" message stays, the Confirm button stays, and clicking it again repeats the 422. The customer may leave believing the order was placed. |
| **Evidence** | Playwright TC-UI-003 (trace and video kept on failure). Network: `POST /payment/check 200` → `POST /invoices 422`. Captured page state after Confirm: `alert-success: "Payment was successful"`, no error element. |
| **Impact** | Lost orders and support contacts. Customers think they have paid. This is the most damaging failure for a shop because it is invisible. |
| **Suggested fix** | Handle the error response of `POST /invoices` in the checkout component and show the field errors. Validate the address before the payment step (the API already provides the lookup). |

### DEF-002 – The same cart can be checked out repeatedly, creating duplicate orders

| Field | Value |
|---|---|
| **Severity / Priority** | High / P1 |
| **Component** | API – `POST /invoices` |
| **Environment** | api.practicesoftwaretesting.com, Toolshop API 5.0.0. Found 6 Nov 2026. |
| **Pre-conditions** | Authenticated customer, cart with 1 item, valid billing address |
| **Steps to reproduce** | 1. `POST /carts` → `cart_id`. 2. `POST /carts/{cart_id}` `{product_id, quantity:1}`. 3. `POST /invoices` with a valid address, `cash-on-delivery`, `cart_id` → 201. 4. Send exactly the same request again. |
| **Expected result** | The second request is rejected (e.g. 409/422 "cart already ordered"), or is idempotent and returns the first invoice. The customer has exactly **1** order. |
| **Actual result** | The second request also returns **201** with a new invoice number (e.g. `INV-2026000030` and then `INV-2026000031`, both total 14.15). The cart is not consumed by the server; only the web client deletes it afterwards. |
| **Evidence** | Playwright TC-API-040. Postman request "DEF-002 Checkout the same cart a second time" (newman run: 201, new id). |
| **Impact** | Double charging and duplicate shipments from double-clicks, network retries, a second browser tab or API clients. |
| **Suggested fix** | Mark the cart as ordered (or delete it) in the same transaction as invoice creation, and reject further invoices for it. Optionally support an `Idempotency-Key` header. |

### DEF-003 – An order can be placed for an empty cart

| Field | Value |
|---|---|
| **Severity / Priority** | High / P2 |
| **Component** | API – `POST /invoices` |
| **Environment** | api.practicesoftwaretesting.com, Toolshop API 5.0.0. Found 6 Nov 2026. |
| **Pre-conditions** | Authenticated customer |
| **Steps to reproduce** | 1. `POST /carts` → `cart_id` (add nothing). 2. `POST /invoices` with a valid address, `cash-on-delivery`, `cart_id`. |
| **Expected result** | 422 "Cart is empty". No invoice. |
| **Actual result** | **201**. An invoice with **total 0** and no lines is created and appears in the customer's order history and the admin's invoice list. |
| **Evidence** | Playwright TC-API-041. Postman "DEF-003 b) Order the empty cart" (201, `total: 0`). |
| **Impact** | Empty orders reach fulfilment and reporting, which distorts sales reports and could be abused to create junk invoices. |
| **Suggested fix** | Validate that the cart has at least one line before creating the invoice. |

### 2.1 Other observations (not in the top 3)

| ID | Severity | Observation |
|---|---|---|
| OBS-1 | Medium | The 99 limit applies per request only: adding 60 + 60 of the same product gives a cart line of **120**. |
| OBS-2 | Medium | Race on the address step. The saved address is pre-filled asynchronously and the postcode lookup fires twice per change. Whichever response arrives last wins, so the values sent can differ between runs, and the customer's own address is silently replaced by the lookup's (demo-generated) street and city. This is what triggers DEF-001 in practice. |
| OBS-3 | Medium | `POST /payment/check` returns 200 "Payment was successful" for `payment_method: "bitcoin"` (not in the enum) and for an empty body `{}`. `POST /invoices` does reject an unknown method (422), so the impact is limited to the payment step. |
| OBS-4 | Medium | `POST /invoices` with a malformed credit card (`{credit_card_number:"x"}`) returns **500** "Something went wrong" instead of a 422 field error. |
| OBS-5 | Low | `billing_postal_code` is listed as *required* in the OpenAPI spec, but omitting it returns 201, and the city-to-country check is skipped (e.g. city "Utrecht" with country "US" is accepted). |
| Note | – | Verified as **correct** behaviour: passwords found in public breaches are rejected; DOB under 18 is rejected; another customer's invoice returns 404 (no IDOR); quantity type checks work; card expiry is validated both client and server side. |

---

## 3. API testing

### 3.1 Approach

1. **Discovery.** Downloaded the OpenAPI document (`/docs?api-docs.json`, 80+ operations) and recorded the browser's network traffic during a manual checkout, to find which endpoints the workflow really uses and in what order.
2. **Risk-based scope.** Concentrated on the endpoints in the checkout chain (users, products, carts, postcode lookup, payment check, invoices). Admin CRUD (brands, categories, reports) was out of scope.
3. **Techniques.**
   - Positive flows with state chaining (token → cart → invoice).
   - Equivalence partitioning and boundary values (quantity 0/1/99/100, password length 7/8, card expiry ±).
   - Authentication and authorisation (no token, other user's invoice).
   - Negative and robustness cases (unknown IDs, wrong types, missing required fields, unknown enum values).
   - Business-rule checks (totals = price × qty; one order per cart).
4. **Two complementary tools.**
   - **Postman/newman:** a portable, reviewer-friendly collection. It registers a fresh customer on each run, so it can be re-run any number of times.
   - **Playwright API tests:** the same scenarios plus data-driven boundaries, run in CI next to the UI tests and sharing the same API client and test data.
5. **Test isolation.** Unique customers per run, products looked up at runtime (the demo DB resets and IDs change), billing address taken from the lookup.

### 3.2 API test scenarios

| Area | Scenarios | Postman | Playwright |
|---|---|---|---|
| Users & auth | Register (201, no password echoed); duplicate email 409; weak password 422 (3 rules); breached password 422; 8-character boundary 201; age < 18 422; login 200 + bearer token; wrong password 401; `/users/me` with and without token | 7 requests | TC-API-001…008 |
| Products | Paginated list contract; detail matches the list; unknown id 404; search returns only matches | 4 | TC-API-010…013 |
| Cart | Create 201; add item; quantity 0/−1/1/99/100/1.5/"abc"; unknown product 422; update quantity; read back | 6 | TC-API-020…023 |
| Checkout | Postcode lookup; payment check valid card; expired card; invalid card fields; gift card required fields; order without token 401; city mismatch 422; unknown cart 404; **create order 201 with total = price × qty**; read the invoice back (lines, status) | 8 | TC-API-030…036 |
| Defects | Duplicate checkout (DEF-002); empty cart (DEF-003); quantity limit bypass (OBS-1); unknown payment method (OBS-3); 500 on malformed card (OBS-4); postcode not required (OBS-5) | 8 | TC-API-040…045 |

### 3.3 Results and evidence (6 Nov 2026)

| Run | Result |
|---|---|
| newman (`npm run test:postman`) | **33 requests, 56 assertions, 0 failures**. Average response time 702 ms (min 562 ms, max 1.6 s). JUnit report: `postman/results/newman-junit.xml`. |
| Playwright API project (`npm run test:api`) | **37 passed**: 31 functional tests and 6 defect tests that fail as expected. HTML report: `playwright-report/`. |
| Full suite (`npm test`) | **40 passed** (API + UI), about 46 s with 4 workers |

In the Postman defect folder, assertions describe the **current** (wrong) behaviour, e.g. *"DEF-002 reproduced – duplicate order accepted (expected 4xx, got 201)"*. The run therefore works as reproduction evidence and stays green. In Playwright the same defects assert the **correct** behaviour under `test.fail()`, so the suite shows when a defect is fixed.

During development the public demo database was reset mid-run (all product IDs changed). This confirmed the decision not to hard-code test data.

---

## 4. Performance-testing approach

**Script:** `perf/checkout-load.js` (k6). In this application the "booking API" is the **order placement** call, `POST /invoices`.

### 4.1 Workload model

- **Open model (arrival rate).** Customers arrive whether or not the shop is slow. With a closed model (a fixed number of VUs looping), the arrival rate drops automatically when the system slows down, which hides the problem. `constant-arrival-rate` and `ramping-arrival-rate` keep the rate fixed, so degradation shows up as latency, errors or `dropped_iterations`.
- **Transaction = one realistic order:** `POST /carts` → `POST /carts/{id}` (1 item) → `POST /invoices` (authenticated, cash on delivery). The stated rates (5/s normal, 20/s peak) apply to `POST /invoices`. Total HTTP load is about 3× that (≈15 and ≈60 req/s), plus a login per VU every 4 minutes, because tokens expire after 300 s.
- **Users:** a pool of 10 customers is registered in `setup()`. VUs share them round-robin, so invoices don't all hit one user's records, which would be unrealistic.

| Scenario | Executor | Rate | Duration (`PROFILE=load`) | Purpose |
|---|---|---|---|---|
| `normal` | constant-arrival-rate | 5/s | 5 min | Baseline at expected traffic |
| `ramp_up` | ramping-arrival-rate | 5 → 20/s | 5 min | Find the point where latency starts to bend |
| `peak` | constant-arrival-rate | 20/s | 5 min | Sustained peak (≈6,000 orders) |
| `recovery` | constant-arrival-rate | 5/s | 3 min | Does it return to baseline after the peak (queues drained, no leaks)? |

VUs are sized with Little's law: VUs ≈ rate × iteration time ≈ 20/s × ~2 s = 40 pre-allocated, with up to 120 allowed. `PROFILE=smoke` runs the same four phases at 1/s for 30 s each, to validate the script and take a baseline.

### 4.2 Metrics monitored

**Client side (k6):**
- `http_req_duration` p95/p99 per endpoint **and per phase**. Each scenario is tagged `phase`, so normal, ramp, peak and recovery are measured separately rather than blended into one average.
- `http_req_failed` (overall and for the booking call), `checks` (business correctness: 201, invoice number issued, total = price), and the custom `order_success` rate.
- `order_flow_duration`, the end-to-end time a customer waits for the three calls.
- `orders_created` (throughput actually achieved), `dropped_iterations` (the load generator could not keep up, which makes the result invalid), and `vus` and `iteration_duration` (saturation).

**Server side (would monitor with APM or infrastructure dashboards):**
- CPU, memory and PHP-FPM worker saturation.
- DB connections, slow queries and lock waits on the invoice and cart tables.
- Response codes at the web server (Apache) and error-log rate.
- Queue depth for PDF invoice generation (the API generates invoice PDFs asynchronously).

### 4.3 How the thresholds were chosen

| Threshold | Value | Reasoning |
|---|---|---|
| `order_success`, `checks` | > 99% | Correctness matters more than speed: a fast wrong answer is a failure. |
| `http_req_failed{POST /invoices}` | < 1% | Common SLO for transactional endpoints. |
| `http_req_failed` (all) | < 5%, **abortOnFail** after 30 s | Safety valve: stop hammering a broken (and shared) system. |
| Booking p95 normal / recovery | < 1000 ms | Baseline smoke p95 ≈ 0.5 s, so about 2× headroom. Also a common UX budget for a "submit order" click. |
| Booking p95 ramp / peak | < 1500 ms; p99 peak < 3000 ms | Some degradation under 4× load is acceptable, but no more than +50% over the normal budget. |
| Cart calls p95 | < 800 ms | Simpler writes; baseline p95 ≈ 0.47 s. |
| `order_flow_duration` p95 | < 3000 ms | Three sequential calls, as the customer experiences them. |
| `dropped_iterations` | < 10 | Proves the test applied the load it claims. |

Without a product SLO, the thresholds are derived from the **measured baseline** plus UX budgets. With real numbers (SLAs, production percentiles) I would replace them.

### 4.4 Smoke-run results (public demo, 6 Nov 2026, `npm run perf:smoke`)

| Metric | Result |
|---|---|
| Orders created | 119 of 119 (100% success, 0% HTTP errors, 601 of 601 checks passed) |
| `POST /invoices` p95 | normal 516 ms · ramp 470 ms · peak 809 ms · recovery 512 ms |
| Cart calls p95 | 473 ms |
| Order flow p95 / median | 1.56 s / 0.91 s |
| Dropped iterations | 2 (threshold < 10) |
| Thresholds | **All passed** |

These numbers are a functional baseline at 1/s, **not** a capacity result. The full 5→20/s profile was intentionally **not** run against the public demo (see 4.5).

### 4.5 Limitations and risks

- **Shared public environment.** Running 20 orders/s for 5 minutes against someone else's demo would be abusive. It would create about 9,000 junk invoices and disturb other users, and results would be skewed by their traffic, by an unknown rate limiter or WAF, and by the periodic DB reset (seen during testing). The load profile should run against a dedicated environment (e.g. the project's Docker Compose stack) sized like production.
- **Network distance.** The generator ran on a laptop over the internet, so latency includes WAN time. Run the generator close to the system under test, or as distributed or cloud k6.
- **Test data growth.** Every iteration creates a real invoice that the API cannot delete. Long runs grow the tables and can slow later runs. Reset the DB between runs.
- **Simplified behaviour mix.** Only the order transaction is modelled. Real traffic is mostly browsing (product list, search, detail) with a small conversion ratio. A fuller model would weight scenarios (e.g. 80% browse, 15% cart, 5% checkout) from analytics.
- **Payment and lookup are not representative.** Payment is a stub and the postcode lookup uses a local generator. In production these are external calls with their own latency, and they would need to be stubbed or budgeted separately.
- **Fixed product and quantity.** Every order uses the same product, which can produce hot rows (stock) or flattering cache hits. Vary products and quantities from a data file.
- **Thresholds are assumptions.** They come from a 1/s baseline and UX budgets, not from agreed SLOs.

---

## 5. Automation summary

- **Framework:** Playwright + TypeScript, Page Object Model, custom fixtures, typed API client.
- **Scenarios:**
  - TC-UI-001 (successful E2E checkout, verified through the API)
  - TC-UI-002 (expired card blocks payment, verified by network capture and API)
  - TC-UI-003 (regression for DEF-001)
  - 37 API tests
- See the repository `README.md` for setup, structure, design decisions and future improvements, and `RUN_COMMANDS.md` for every command.
