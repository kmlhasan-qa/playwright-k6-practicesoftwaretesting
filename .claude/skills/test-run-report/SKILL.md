---
name: test-run-report
description: Run the automated test suites (Playwright UI/API, Postman/newman, k6 — smoke, full load, or a single normal/ramp/peak/recovery phase) and log the results into the test report's dedicated "6. Test run results" section in docs/test-cases-and-automation.docx — latest-run summary, per-suite run details (date, commit, target, duration, every test or k6 threshold with its result) and the run history, rebuilt from the run log docs/test-run-log.jsonl — plus the "Last local run" block in the README. Use this whenever the user wants to run the automation and record the outcome, refresh the report with the latest run, log or update test results in the docs, or asks "run the tests and update the report". It parses the result files, writes the real numbers (dates, pass/fail counts, per-phase k6 p95) into the document, and reports failures honestly without fabricating a run.
---

# Run the suites and log the results into the report

After a test run, the report's results must reflect **what actually happened in that run** — real counts, the real date, real latency numbers — or it misleads whoever reads it. This skill runs the suites (or ingests results you already produced), appends each run to the run log `docs/test-run-log.jsonl`, rebuilds the document's **"6. Test run results"** section from that log, and mirrors the summary in the README.

Section 6 is owned by this skill and is regenerated, never hand-edited:
- **6.1 Latest run summary** — one row per suite (UI, API, Postman) and per k6 run kind: last run date, commit, target, result, verdict; k6 kinds never run are listed as "not run yet".
- **6.2 UI tests / 6.3 API tests (Playwright)** — run details (result, date/duration, command, commit, target, runner) and every test with its result, time and note (defect ID for expected fails, the error for real failures).
- **6.4 Postman (newman)** — run details and any failing assertions.
- **6.5 Performance (k6)** — per run kind (smoke, full load, normal/ramp/peak/recovery): run details, load delivered, correctness, per-phase booking median/p95/p99/max against its limits, and every threshold with its measured value.
- **6.6 Run history** — every logged run, newest first.
Each suite shows its **own** latest run, so running only the API tests updates 6.3 and leaves 6.2 with its earlier date — honest by construction.

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

**Owned environment for load runs:** if the user has none, offer a local Toolshop in Docker (steps in `RUN_COMMANDS.md`, "Local Toolshop for load runs"): start only `laravel-api web mariadb`, and before **every** load run reset the data (`php artisan migrate:fresh --seed --force`) **and** clear the API cache (`php artisan cache:clear`). Without the cache clear, the cached product list hands out IDs deleted by the reset and every "add to cart" fails — the run aborts in ~30 s with 0% order success, which is a setup fault, not a result: discard those summary files, never log them. Run the parser with `API_URL=http://localhost:8091` so the target is recorded, and describe the result as the capacity of that machine, not of production.

If the user already ran the suites, skip running and just parse the existing result files.

### 2. Parse and log the results
```bash
python3 .claude/skills/test-run-report/scripts/parse_results.py \
  playwright-report.json postman/results/newman-junit.xml perf/results/<kind>-summary.json \
  --log docs/test-run-log.jsonl
```
Pass only the result files **produced by this run**: check the start time each line prints, so a stale `load-summary.json` from weeks ago is not logged as new. One Playwright report holds every project that ran and is split into a UI and an API record. Each record carries the run's start time (Playwright and newman read it from the report; k6 from the file time, or from git when the file was restored by a checkout), the commit checked out at that time (`+local changes` when the test code had uncommitted edits), and the target from the same env vars the suites use (`BASE_URL`, `API_URL`; newman's collection `baseUrl`) — so run the parser in the same shell/env as the suites. `--log` skips runs already logged, so re-running it is safe.

It prints a human summary per run (failures named with their error) and a JSON blob:
- **Playwright** (per project): `passed`, `expected_fail` (`test.fail()` defect tests that failed as expected — count as passing), `failed` (real failures, plus defect tests that unexpectedly **passed** — the defect may be fixed: say so), `flaky`, `skipped`, `tests[]`.
- **newman**: `requests`, `assertions`, `failures`, `failing[]`.
- **k6**: `label` / `profile` / `phase_selection` (detected run kind, e.g. "k6 load – peak phase only"), `all_thresholds_passed`, `thresholds[]` (limit, measured, passed), `orders_created`, `success_rate_pct`, `http_req_failed_pct`, `dropped_iterations`, `achieved_rate_per_s`, `max_vus`, `phase_latency_p95` (booking median/p95/p99/max per phase).

### 3. Rebuild "6. Test run results" in the document
```bash
SCRATCH=<scratchpad>; (cd "$SCRATCH" && [ -d node_modules/docx ] || (npm init -y >/dev/null && npm install docx@9.5.1 >/dev/null))
python3 .claude/skills/test-run-report/scripts/render_results_section.py docs/test-run-log.jsonl > "$SCRATCH/results.md"
NODE_PATH="$SCRATCH/node_modules" node .claude/skills/test-research/scripts/md2docx.js "$SCRATCH/results.md" "$SCRATCH/results.docx"
echo '[{"op":"replace_section","heading":"6. Test run results","fragment":"'"$SCRATCH"'/results.docx"}]' > "$SCRATCH/ops.json"
python3 .claude/skills/test-research/scripts/docx_tools.py apply docs/test-cases-and-automation.docx "$SCRATCH/ops.json"
```
- **No section 6 yet** (older layout): use `append_section` instead, then turn the old §3.6 "Last results" table into a pointer with `replace_subsection` (heading `3.6 Last results`, fragment = `### 3.6 Test results` + one sentence pointing to section 6), and add a sentence about section 6 to the document intro.
- **§3.4 "Results so far"** keeps only a pointer to 6.5 plus the standing remark on where load runs may run; don't copy numbers there. If a full load run on an owned environment was done, replace the "intentionally not run" remark for that run kind.
- **§1 NF-01…NF-04 rows**: when a load phase was run, append the outcome to that row's last cell (`append_to_cell`, e.g. " Run 9 Nov 2026: passed, p95 812 ms – see 6.5.").
- **README "Last local run (<date>)"**: mirror 6.1 — one bullet each for Playwright UI, Playwright API, newman, and every k6 run kind that has a result (with per-phase booking p95), then one line naming the k6 kinds not run yet. End with "Details: docs/test-cases-and-automation.docx §6."

Keep interpretation faithful: `test.fail()` defect tests showing as ✘ but counted as passed are "expected to fail", not failures. Name the k6 run kind exactly as detected: a **smoke** run is a functional baseline, not a capacity result; a load or single-phase result is a capacity result **for the environment it targeted** — say which.

### 4. Verify and report
- `dump --grep "6.1 Latest run summary"` and the new date to confirm the section landed; render a preview of `results.docx` (`qlmanage -t -s 1400 -o <dir> file.docx`). Delete the `.bak`.
- If Word has the document open (a `docs/~$…docx` lock file exists), tell the user to close it without saving, or their Word copy will overwrite the update.
- Note that `perf/results/*.json`, `postman/results/*.xml` and `docs/test-run-log.jsonl` change with every run — they will show as modified in git.
- Report the run outcome and exactly what you changed in the docs. Don't commit unless asked; if asked and on the default branch, branch first.

## Why this skill
Logging run results by hand is error-prone: the k6 summary JSON encodes thresholds inversely (a threshold is marked crossed=`true` when it **failed**), per-phase p95 lives under tagged metric keys, and Playwright's "expected" blends passes with expected-to-fail defect tests. The bundled parser handles these so the report gets the right numbers; the run log plus a regenerated section 6 keeps every suite's latest run, its details and the history consistent; and the golden rule keeps the report honest.
