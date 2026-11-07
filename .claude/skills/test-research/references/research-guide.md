# Research guide: where to look and how to rate

## Contents
1. Search plan (what to search for)
2. Turning findings into test cases
3. Verifying a candidate defect
4. Severity and priority scale
5. Conventions used in this project's document

---

## 1. Search plan

Run several searches in one turn; start with `standard` mode and switch to `extended` only when results are thin or the topic is niche. Prefer primary sources (the app's own repo and docs, standards bodies) over listicles.

| Source type | Why it is useful | Example queries (adapt the app name) |
|---|---|---|
| The app's own repository: issues, changelog, release notes | Real, reported bugs and regressions; fixed bugs are regression-test candidates | `<app> github issues checkout`, `site:github.com <org>/<repo> issues invoice`, `<app> changelog` |
| The app's documentation / "known bugs" pages | Practice apps often publish deliberate bugs or a "with bugs" build | `<app> documentation`, `<app> "with bugs" version list of bugs` |
| The API spec (OpenAPI / Swagger) | Required fields, enums, limits = boundary and negative cases | the spec URL in the repo / app footer |
| Domain checklists | Cases testers commonly forget for this kind of app | `e-commerce checkout test cases`, `shopping cart test scenarios boundary`, `payment form test cases expiry date CVV` |
| Security standards | Security cases with an authoritative "expected result" | `OWASP WSTG business logic testing`, `OWASP ASVS payment`, `PCI DSS storing CVV` |
| Accessibility / compatibility | Non-functional cases | `WCAG 2.2 form error identification`, `checkout accessibility checklist` |
| Community write-ups about the same app | Bugs other testers found | `<app> bug report`, `<app> testing exercise defects` |

Keep a list of every URL you actually used — the report cites them.

## 2. Turning findings into test cases

- Map each finding to a catalogue area (AUTH, PROD, CART, ADDR, PAY, ORD, NF or a new prefix if the app has other areas).
- **De-duplicate** against the existing catalogue first (`docx_tools.py dump --grep <keyword>`). If an existing case already covers it, at most refine that case; do not add a near-copy.
- Write each case so a tester can run it without the source: pre-requisites, concrete steps with data, one observable expected result.
- Expected results come from the spec, the app's own messages, or a cited standard. If the "right" behaviour is a judgement call, say so ("expected per common practice").
- New cases start as `Manual` in the Automated column.

## 3. Verifying a candidate defect

A finding from the web is only a **candidate** until it is reproduced on the system under test today.

1. Write the smallest probe that proves or disproves it (one request, or a short Playwright script). Put probe scripts in the scratchpad, not the repo.
2. Run it once; if it reproduces, run a second focused check that rules out test-data mistakes (e.g. confirm the product really is out of stock, confirm the stored value with a GET).
3. Record evidence: request, status, the relevant part of the response, identifiers (invoice number, timestamp).
4. Outcomes:
   - **Reproduced** → add to the defect list with evidence.
   - **Not reproduced** (fixed or never present) → do not add as a defect; the scenario may still become a regression test case.
   - **Cannot verify** (needs admin access, email, real payment, etc.) → mention in the final report as "candidate, not verified"; do not put it in the defect list.

Probe etiquette on shared/public environments: a handful of single requests, unique `@example.com` test accounts, no load, no brute force, no real exploit payloads beyond harmless markers (e.g. `<b>x</b>`, `' OR 1=1 --`), no attempts to access other people's real data.

## 4. Severity and priority scale

Severity = impact on the customer or business if it happens. Priority = how soon to fix.

| Severity | Use when |
|---|---|
| Critical | Money, orders or personal data lost, wrong or exposed at scale; no workaround |
| High | A main function is broken or misleading; wrong orders/charges possible; security weakness with realistic impact |
| Medium | Function degraded, a workaround exists, or validation gap with limited impact |
| Low | Cosmetic, rare, or a spec mismatch without user impact |

| Priority | Use when |
|---|---|
| P1 | Must be fixed before release (revenue, security, data integrity, misleading the customer) |
| P2 | Should be fixed soon; affects some customers or support load |
| P3 | Fix when convenient |

ID convention: `DEF-nnn` for High/Critical, `OBS-n` for Medium/Low. Continue numbering from the highest existing ID; never renumber existing ones (tests and other documents reference them). Sort every defect table by severity (Critical → Low), then priority (P1 → P3), then ID.

## 5. Conventions used in this project's document

- Document: `docs/test-cases-and-automation.docx` (landscape A4), shared with codebase-qa / test-run-report / test-docs-sync. If it doesn't exist, create it from `document-skeleton.md`. Section 2 = automated test list, section 3 = environment/how to run/3.6 last results, section 5 = "5. Code inspection" (written by codebase-qa: inspection log, coverage of critical flows, code health notes). Section 1 = catalogue tables per area (9 columns: ID, Type, Title, Pre-requisites, Steps, Expected result, Sev, Prio, Automated). Section 4 = "4. Known defects": intro, 4.1 sorted defect list (9 columns: ID, Severity, Priority, Area, Summary, Expected, Actual (today), Catalogue case, Automated test), one detailed report table per DEF (Field | Value rows: Severity / Priority, Component, Environment, Pre-conditions, Steps to reproduce, Expected result, Actual result, Evidence, Impact, Suggested fix), then an observations table (ID, Severity, Priority, Observation, Automated test) and a "Checked and working correctly" paragraph.
- Failing catalogue cases get a bold note in the Automated cell: `Fails today: DEF-xxx` (automated test, marked `test.fail()`), or `Fails (manual, <date>): DEF-xxx` (found manually, no test yet).
- The totals sentence at the end of section 1 starts with "Totals:" — recount after adding rows.
- README.md has a "Defects found (summary)" table that mirrors 4.1 (ID, Severity, Priority, Summary, Covered by).
