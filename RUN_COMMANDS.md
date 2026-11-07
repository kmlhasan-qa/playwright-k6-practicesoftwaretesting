# Run commands – cheat sheet

Every command is run from the project root. All suites target the public demo by default:
- **UI:** <https://practicesoftwaretesting.com>
- **API:** <https://api.practicesoftwaretesting.com>

## 0. One-time setup

```bash
npm ci                                   # install dependencies (Playwright, newman, TypeScript)
npx playwright install --with-deps chromium   # install the browser used by the UI tests
brew install k6                          # k6 for performance tests (macOS; see k6.io for other OS)
cp .env.example .env                     # optional – override URLs / credentials
```

## 1. Everything at once

```bash
npm test                    # all Playwright tests: API + UI (known-defect tests are expected to fail, so the suite still passes)
npm run typecheck           # TypeScript type check of the whole framework
```

## 2. API tests (Playwright, no browser)

```bash
npm run test:api                                        # whole API suite
npx playwright test tests/api/auth.spec.ts              # users: register, login, password policy, age rule
npx playwright test tests/api/products.spec.ts          # product list, details, search, 404
npx playwright test tests/api/cart.spec.ts              # cart + quantity boundaries (0, 1, 99, 100, ...)
npx playwright test tests/api/checkout.spec.ts          # payment check + order (invoice) creation
npx playwright test tests/api/defects.spec.ts           # known defects (expected to fail)
npx playwright test --grep TC-API-030                   # one test case by its ID
```

## 3. UI tests (Playwright, Chromium)

```bash
npm run test:ui                                         # all UI tests (headless)
npm run test:headed                                     # same, with a visible browser
npm run test:e2e                                        # TC-UI-001 – successful end-to-end checkout
npx playwright test --grep TC-UI-002                    # negative – expired credit card is rejected
npx playwright test --grep TC-UI-003                    # regression – DEF-001 silent order failure (expected to fail)
npx playwright test --project=ui --debug --grep TC-UI-001   # step through in the Playwright Inspector
npx playwright test --project=ui --ui                   # interactive UI mode (watch, time-travel)
```

## 4. Filter by tag

| Command | Runs |
|---|---|
| `npm run test:defects` | only `@defect` tests (assert the correct behaviour, marked expected-to-fail) |
| `npm run test:no-defects` | everything except known defects |
| `npx playwright test --grep @negative` | negative / validation scenarios |
| `npx playwright test --grep "@api.*@defect"` | API defects only |

## 5. Postman collection (newman)

```bash
npm run test:postman        # runs postman/toolshop-api.postman_collection.json, JUnit → postman/results/newman-junit.xml
npx newman run postman/toolshop-api.postman_collection.json --folder "4. Checkout (payment & invoice)"   # one folder
```

Or in the Postman app: **Import** → `postman/toolshop-api.postman_collection.json` → **Run collection**. Run the folders in order, top to bottom, because later requests use variables set by earlier ones.

## 6. Performance tests (k6)

```bash
npm run perf:smoke          # 1 order/s per phase, ~2 min – safe for the public demo
npm run perf:load           # full model 5/s → 20/s → peak 20/s → recovery (~18 min) – ONLY on an environment you own
k6 run -e PROFILE=load -e API_URL=https://your-test-env perf/checkout-load.js   # full load against your own environment
k6 run -e USER_POOL=20 perf/checkout-load.js                                       # larger pool of test users
```

Run one phase on its own (load-profile rates, starts at t=0, only that phase's latency thresholds):

```bash
npm run perf:normal         # normal expected traffic – 5 orders/s for 5 min
npm run perf:ramp           # gradual increase – ramps 5 → 20 orders/s over 5 min
npm run perf:peak           # peak traffic – 20 orders/s for 5 min
k6 run -e PROFILE=load -e PHASE=recovery perf/checkout-load.js                     # recovery – 5 orders/s for 3 min
k6 run -e PROFILE=load -e PHASE=peak -e API_URL=https://your-test-env perf/checkout-load.js   # one phase against your own environment
k6 run -e PHASE=peak perf/checkout-load.js                                         # quick dry run of one phase at smoke rate (1/s, 30 s)
```

Like `perf:load`, the per-phase npm scripts use load rates – run them **only against an environment you own**.

Summaries are written to `perf/results/*-summary.json`. The k6 exit code is non-zero if any threshold fails.

## 7. Reports and debugging

```bash
npm run report                                                  # open the last Playwright HTML report
npx playwright show-trace test-results/<test-folder>/trace.zip  # trace of a failed test
```

Failed tests keep a screenshot, video and trace in `test-results/`.

## 8. Useful options

```bash
HEADLESS=false npm run test:ui                  # visible browser via env variable
BASE_URL=https://with-bugs.practicesoftwaretesting.com API_URL=https://api-with-bugs.practicesoftwaretesting.com npm test   # run against the "with bugs" build
npx playwright test --repeat-each=3 --project=ui    # flakiness check
npx playwright test --workers=1                     # run tests one at a time
```
