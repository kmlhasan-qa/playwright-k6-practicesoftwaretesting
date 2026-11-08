---
name: test-run-report
description: Run the automated test suites (Playwright UI/API, Postman/newman, k6) and log the results into the test report — the "Last results" table and the k6 "Results so far" numbers in docs/test-cases-and-automation.docx (every k6 run kind — smoke, full load, or a single normal/ramp/peak/recovery phase — with a run history in perf/results/history.jsonl), and the "Last local run" block in the README. Use this whenever the user wants to run the automation and record the outcome, refresh the report with the latest run, log or update test results in the docs, or asks "run the tests and update the report". It parses the result files, writes the real numbers (dates, pass/fail counts, per-phase k6 p95) into the document, and reports failures honestly without fabricating a run.
---

# Run the suites and log the results into the report

After a test run, the report's "last results" must reflect **what actually happened in that run** — real counts, the real date, real latency numbers — or it misleads whoever reads it. This skill runs the suites (or ingests results you already produced), parses them with a bundled parser, and writes the numbers into `docs/test-cases-and-automation.docx` and the README.

Shares tooling and conventions with **test-research**: edit the .docx in place with `.claude/skills/test-research/scripts/docx_tools.py`; the document layout is in `.claude/skills/test-research/references/research-guide.md` §5. Result parsing uses this skill's own `scripts/parse_results.py`.

## Golden rule: never fabricate a run
Only write numbers that came from a result file produced in this session (or one the user points you to and confirms is current). If a suite was not run, leave its row unchanged and say so. If a suite **failed**, record the failure with its counts — do not round it up to "passed". A report that claims green when the run was red is worse than no report.

## Workflow

### 1. Run the suites (or locate existing results)
Decide from the user's intent and the environment. Default commands:
```bash
npm test                 # all Playwright (UI+API) -> playwright-report.json
npm run test:postman     # newman -> postman/results/newman-junit.xml
npm run perf:smoke       # k6 smoke -> perf/results/smoke-summary.json
```

**k6 run kinds** — log whichever were actually run; each writes its own summary file:

| Kind | Command | Load | Summary file | Where allowed |
|---|---|---|---|---|
| smoke (all phases) | `npm run perf:smoke` | 1 order/s, ~2 min | `perf/results/smoke-summary.json` | anywhere, incl. the public demo |
| full load (all phases) | `API_URL=<owned> npm run perf:load` | 5→20→5 orders/s, 18 min (~9,000 orders) | `perf/results/load-summary.json` | owned environment only |
| normal (NF-01) | `API_URL=<owned> npm run perf:normal` | 5/s, 5 min | `perf/results/normal-summary.json` | owned only |
| ramp_up (NF-02) | `API_URL=<owned> npm run perf:ramp` | 5→20/s, 5 min | `perf/results/ramp-summary.json` | owned only |
| peak (NF-03) | `API_URL=<owned> npm run perf:peak` | 20/s, 5 min | `perf/results/peak-summary.json` | owned only |
| recovery (NF-04) | `API_URL=<owned> npm run perf:recovery` | 5/s, 3 min | `perf/results/recovery-summary.json` | owned only |

k6 exits non-zero when a threshold fails — that is a result, not a crash: still parse and log the summary.
For a UI/API breakdown, run `npm run test:ui` and `npm run test:api` separately and read the "N passed" line from each (note: each run overwrites `playwright-report.json`, so capture the stdout count per run).

**Safety:** against a shared/public environment run **only the k6 smoke profile**. Never run `perf:load` or a per-phase load run (`perf:normal|ramp|peak|recovery`) there — that is real load on a system others use. Before any load-profile run, confirm `API_URL` is set and points at an environment the user owns (not `api.practicesoftwaretesting.com`); if it isn't, run smoke instead and say why. A load summary file the user produced elsewhere can always be parsed and logged.

If the user already ran the suites, skip running and just parse the existing result files.

### 2. Parse the results
```bash
python3 .claude/skills/test-run-report/scripts/parse_results.py \
  playwright-report.json postman/results/newman-junit.xml perf/results/<kind>-summary.json \
  --target "$API_URL" --history perf/results/history.jsonl
```
Pass only the k6 summary files **produced by this run** (check their modification time — `run_finished` in the output — so a stale `load-summary.json` from weeks ago is not reported as new). `--history` appends one line per k6 run to `perf/results/history.jsonl` (target, profile, phases, thresholds, orders, error %, per-phase p95/p99) and skips runs already logged; `--target` defaults to `$API_URL` or the public demo.
It prints a human summary and a JSON blob. Key fields:
- **Playwright**: `passed_or_expected` (passing tests + `@defect` tests that failed as expected), `failed_unexpected` (real failures), `flaky`, `skipped`. A clean run has `failed_unexpected: 0`.
- **newman**: `requests`, `assertions`, `failures`.
- **k6**: `label` / `profile` / `phase_selection` (detected run kind, e.g. "k6 load – peak phase only"), `run_date`, `all_thresholds_passed` + `thresholds_failed` (names the failing ones), `orders_created`, `success_rate_pct`, `http_req_failed_pct`, `dropped_iterations`, `achieved_rate_per_s`, `max_vus`, and `phase_latency_p95` (the booking call's p95/p99 per phase) — the numbers the report wants.

### 3. Write the numbers into the document
Find the current text with `dump --grep`, then `replace_text` (exact, single-run) via docx_tools:
- **§3.6 "Last results (<date>)"**: update the heading date and each row — Playwright (e.g. "40 passed (UI 3, API 37); 7 known-defect tests fail as expected"), newman ("33 requests, 56/56 assertions passed"), k6 ("all thresholds passed, 121/121 orders, 0% errors, 0 dropped"). **One row per k6 run kind**: the existing row is `k6 smoke (npm run perf:smoke)`; for a load or single-phase run, update its row if present, otherwise add one after the smoke row with `insert_rows_after` (`row_id` = the smoke row's first cell), first cell like `k6 load (npm run perf:load)` or `k6 peak phase (npm run perf:peak)`, and include the date and target in the text since it may differ from the heading date.
- **§3.4 "Results so far"**: keep the smoke sentence (date + per-phase p95). For a load or single-phase run, add a sentence after it: date, target environment, achieved rate, pass/fail per threshold (name the failing ones with the measured value), booking p95/p99 for each phase run, error % and dropped iterations. If a full load run was done, replace the "intentionally not run" remark for that run kind. Compare against the previous run of the same kind from `history.jsonl` when one exists ("up from 356 ms on 8 Nov").
- **§1 NF-01…NF-04 rows**: when a load phase was run, append the outcome to that row's last cell (`append_to_cell`, e.g. " Run 9 Nov 2026: passed, p95 812 ms.").
- **README "Last local run (<date>)"**: mirror the same, keeping the UI/API split and one bullet per k6 run kind with its per-phase p95.
Example edit:
```bash
cat > ops.json <<'JSON'
[{"op":"replace_text","old":"3.6 Last results (7 Nov 2026)","new":"3.6 Last results (<new date>)"}]
JSON
python3 .claude/skills/test-research/scripts/docx_tools.py apply docs/test-cases-and-automation.docx ops.json
```
Keep interpretation faithful: `@defect`/`test.fail()` tests showing as ✘ but counted as passed are "expected to fail", not failures. Name the k6 run kind exactly as detected: a **smoke** run is a functional baseline, not a capacity result; a load or single-phase result is a capacity result **for the environment it targeted** — say which.

### 4. Verify and report
- `dump --grep` the new date/numbers to confirm the edits landed; render a preview if a layout change is possible. Delete the `.bak`.
- Note that `perf/results/*.json`, `perf/results/history.jsonl` (and `playwright-report.json`, if tracked) were regenerated/appended by the run — they will show as modified in git.
- Report the run outcome and exactly what you changed in the docs. Don't commit unless asked; if asked and on the default branch, branch first.

## Why this skill
Logging run results by hand is error-prone: the k6 summary JSON encodes thresholds inversely (a threshold is marked crossed=`true` when it **failed**), per-phase p95 lives under tagged metric keys, and Playwright's "expected" blends passes with expected-to-fail defect tests. The bundled parser handles these so the report gets the right numbers, and the golden rule keeps the report honest.
