# Playwright – Restful Booker Platform

UI and API automation for the public demo **[Restful Booker Platform](https://automationintesting.online/)** (Shady Meadows B&B), built with Playwright + TypeScript.

The performance tests for the booking API live in a separate repo: **k6-restful-booker**.

---

## 1. Setup & execution

**Prerequisites:** Node.js 20+ (22 recommended), npm.

```bash
git clone https://github.com/kmlhasan-qa/playwright-restful-booker.git
cd playwright-restful-booker
npm ci
npx playwright install --with-deps chromium
cp .env.example .env            # optional – all values have defaults
```

| Command | What it runs |
|---|---|
| `npm test` | everything (API + UI) |
| `npm run test:api` | API project only (no browser) |
| `npm run test:ui` | UI project only (Chromium) |
| `npm run test:headed` | UI, headed browser |
| `npx playwright test --grep @defect` | only the known-defect regression tests |
| `npm run report` | open the last HTML report |
| `npm run typecheck` | TypeScript type check |

Environment variables (`.env` or shell): `BASE_URL`, `ADMIN_USERNAME`, `ADMIN_PASSWORD`, `HEADLESS`.

CI: `.github/workflows/playwright.yml` runs the `api` and `ui` projects as a matrix on push, PR, manually, and nightly, and uploads the HTML report as an artifact.

A Postman collection with the same API scenarios is in `postman/restful-booker.postman_collection.json` (run it with the Collection Runner or `npx newman run postman/restful-booker.postman_collection.json`).

---

## 2. Framework structure

```
├── fixtures/
│   └── index.ts               # custom test: api, homePage, reservationPage, cleanupBookings
├── helpers/
│   ├── config.ts              # env-driven config + observed validation rules
│   ├── api.client.ts          # BookerApi – typed wrapper over the REST API
│   └── data.factory.ts        # unique test data (names, emails, far-future dates)
├── pages/
│   ├── home.page.ts           # rooms + contact form
│   └── reservation.page.ts    # /reservation/{id}
├── tests/
│   ├── api/                   # project "api"
│   │   ├── auth.spec.ts
│   │   ├── rooms.spec.ts
│   │   ├── booking.spec.ts
│   │   └── message.spec.ts
│   └── ui/                    # project "ui"
│       ├── booking.e2e.spec.ts
│       └── contact.spec.ts
├── postman/                   # exported Postman collection
├── playwright.config.ts
└── .github/workflows/playwright.yml
```

### The two high-value scenarios

| ID | Type | Scenario |
|---|---|---|
| **TC-UI-001** | Successful E2E | Guest selects the Single room → opens reservation for unique dates → enters details → sees **Booking Confirmed** → booking verified via admin API → cleaned up |
| **TC-UI-002** | Negative / validation | Reservation submitted with empty guest details shows the blank-field errors and **no booking is created** |

Supporting coverage: contact-form E2E + validation (TC-UI-003…005) and 24 API tests covering auth, rooms, booking happy path, double-booking, boundary values (3/18, 3/30, 11/21 chars) and known defects.

### Design decisions

- **Two Playwright projects, one config.** `api` never launches a browser, so it is fast and can run on every commit; `ui` uses Desktop Chrome.
- **Page Object Model + custom fixtures.** Specs read like the business flow; locators live in one place. Locators prefer user-facing roles/placeholders and the app's own `data-testid` hooks over CSS.
- **API client instead of raw `request` calls.** URLs, auth cookie handling and error-shape normalisation (`{errors:[…]}` vs bare `[…]`) are in `BookerApi`.
- **Test data isolation on a shared environment.** The demo is public and a room can be booked only once per night, so the data factory picks random dates 3–10 years ahead. Every booking a test creates is registered with the `cleanupBookings` fixture and deleted through the admin API afterwards.
- **Deep-linking to the reservation page.** The home-page date pickers ignore keyboard input (observation), so the E2E test verifies the *Book now* link and then opens `/reservation/{id}?checkin=…&checkout=…` – the same URL the app builds – with unique dates. This keeps the test deterministic without driving a calendar widget.
- **Order-independent assertions.** The API returns validation errors in random order, so errors are compared as sets.
- **Known defects are executable.** Tests tagged `@defect` assert the *correct* behaviour and are wrapped in `test.fail()`. CI stays green while a defect is open and flips red when it is fixed, prompting removal of the annotation.
- **Diagnostics on failure only:** screenshot, video and trace are retained for failed tests; HTML + JSON reporters.

---

## 3. Defects found while building the suite (6 Nov 2026)

| ID | Severity | Summary | Covered by |
|---|---|---|---|
| DEF-001 | **Critical** | `GET /api/room/{id}` returns **500 Internal Server Error** for every room, so the Reservation page shows an endless spinner and **guests cannot book through the UI**. | TC-API-011, TC-UI-001/002 |
| DEF-002 | High | `POST /api/booking` accepts **past dates** (e.g. 2020-01-10 → 2020-01-12) with 201. | TC-API-040 |
| DEF-003 | High | `POST /api/booking` accepts a **non-existent room** (`roomid: 99999`) with 201. | TC-API-041 |
| DEF-004 | Medium | Omitting `bookingdates` returns **500** instead of a 400 validation error. | TC-API-042 |
| OBS-1 | Low | Checkout-before-checkin and 0-night stays return a generic **409 "Failed to create booking"** instead of a 400 with a field message. | TC-API-038/039 |
| OBS-2 | Low | Home-page Check In / Check Out pickers ignore typed dates (keyboard accessibility). | – |

> Because of DEF-001, **TC-UI-001 and TC-UI-002 currently fail** at `waitForRoomDetails` with the message *"GET /api/room/1 must succeed for the reservation page to render"*. This is deliberate – it is the regression signal. The contact-form E2E (TC-UI-003) is the green end-to-end path in the meantime.

---

## 4. What I would improve with more time

- Drive the calendar widgets (home and reservation page) through a small date-picker component object, and add a test for the date-picker keyboard issue.
- Admin-side flows: create/edit/delete rooms, mark messages read, booking report – with `storageState` re-use for the admin session.
- JSON-schema contract tests (e.g. `ajv`) generated from the API's OpenAPI docs instead of hand-written `objectContaining`.
- Cross-browser (Firefox/WebKit) and mobile viewport projects; visual regression for the home page.
- Accessibility checks with `@axe-core/playwright`.
- Spin up the platform locally with Docker in CI so tests don't depend on (and pollute) the shared public demo.
- Slack/Teams notification with pass/fail counts from the JSON report.
