---
name: codebase-qa
description: Inspect an entire codebase and test it end to end — map every file and layer, run every existing test suite, review frontend, backend, database (SQL, RLS, functions), edge functions, payments/webhooks, config and secrets against a QA checklist, reproduce each suspected bug with a failing test, add missing regression tests in the repo's own test style, and record everything (catalogue, run results, severity-ranked defects, inspection log) in the shared test document docs/test-cases-and-automation.docx — creating it if test-research hasn't yet, extending it in place if it exists. Use this whenever the user asks to inspect, audit, QA, test or "check everything" in a repo, find bugs in the code, review test coverage, run all the tests, or do a full code/test health check — even if they only say "test this codebase" or "find what's broken". For the camilanika shop repo, also read references/camilanika.md.
---

# Codebase QA: inspect everything, test everything, prove every finding

The goal is a trustworthy picture of the codebase's quality: what was checked, what passed, what is broken, and the evidence for each claim. Three rules govern everything below:

1. **Evidence or it isn't a finding.** Each defect needs a file:line, a concrete failure scenario (input → wrong result), and ideally a test that fails because of it. Pattern-matching hits (an `innerHTML`, a `security definer`) are *leads*; read the code and confirm before reporting. Mark what you couldn't confirm as "suspected", never as confirmed.
2. **Never touch production.** Run tests only against local or throwaway environments. No requests that create orders, payments, accounts, or load against live URLs, live databases, or payment gateways unless the user explicitly authorises a specific action. Read the project's test README for how its suites isolate themselves.
3. **Report runs honestly.** Real pass/fail counts from real runs. If a suite couldn't run (missing tool, no DB), say so and why. Never describe a suite as passing if it didn't run.

## Workflow

### 1. Orient (read-only)
- `git status`, current branch, recent log. Work on a branch (`qa/<date>`) if you'll add tests; never commit to the default branch unless asked.
- Run the inventory script from a neutral directory (it only reads files):
  ```bash
  python3 -I .claude/skills/codebase-qa/scripts/inventory.py <repo_root> --json <scratchpad>/inventory.json
  ```
  It reports languages and line counts, entry points, edge functions, large files, test files and frameworks, package scripts, CI, SQL tables without RLS, the toolchain (what's installed or MISSING), and risk hotspots.
- If `docs/test-cases-and-automation.docx` exists, dump it (`python3 .claude/skills/test-research/scripts/docx_tools.py dump docs/test-cases-and-automation.docx`). Known defects, catalogue cases and earlier inspection-log rows tell you what's already established. Re-check earlier defects: still failing, or fixed?
- Read the README, setup docs, the test README, and the config files. If a project-specific reference exists in `references/` (for example `camilanika.md`), read it now.
- Write down the system's **critical flows** (money, auth, data integrity, the main user journey). They decide where to spend the most effort.

### 2. Run what already exists (baseline)
- Run each suite with its documented command, one at a time, and capture the output to a file in the scratchpad. Record the command, the pass/fail/skip counts, the duration, and any error text.
- Missing tooling (for example no PostgreSQL, no Playwright browser): tell the user exactly what's missing and the install command (`brew install postgresql@16`, `npx playwright install chromium`, `npm install` in the test folder). Ask before installing system packages. Meanwhile, run every suite that *can* run.
- A failing existing test is a finding in itself. Check whether it's the code, the test, or the environment before classifying it.

### 3. Inspect every layer
Go through `references/inspection-checklist.md` layer by layer: frontend, HTML/UX, client state, backend/edge functions, database, payments and webhooks, config/secrets/deploy, and tests/CI. Rules for reading:
- Read files fully. Use offset/limit chunks for big ones (the inventory lists them). Don't skim a 2,000-line admin page by grep alone.
- Trace each critical flow end to end across layers: UI → client call → edge function or RPC → SQL function → tables or policies → webhook → UI state. Most real bugs live at the seams: units (rupiah vs cents), timezones, rounding, nullability, status values one layer doesn't know about, and the difference between what the client validates and what the server enforces.
- For every SQL function, policy and grant, ask: who can call this (anon, authenticated, admin), and what stops them abusing it?
- For large codebases, fan the layers out to parallel subagents (one per layer or critical flow) with the checklist section and file list. Ask each for findings with file:line and failure scenario, then verify their claims yourself before reporting. Subagents overstate.

### 4. Prove it: reproduce and add tests
- For each candidate defect, write the smallest test that fails *because of* the bug, **in the repo's existing style and framework** (same runner, harness, fixtures, naming). Run it and keep the output.
  - Confirmed bug, not fixed: keep the test but mark it as a known defect in the framework's idiom (`test.todo`/`{ todo: "BUG-3 ..." }` for node:test, `test.fail` for Playwright, an `-- EXPECTED FAIL` block or a separate file for SQL scripts). The suite stays green, and the bug stays visible and executable.
  - It turns out not to be a bug: drop it, and note in the report that it was checked.
- Fill coverage gaps on critical flows with new passing regression tests (happy path, boundaries, permissions/negative cases).
- Don't fix application code unless the user asks. Report the defect, and propose the fix inline as a diff sketch.
- Re-run the full suite at the end and record the final numbers.

### 5. Record everything in the test document
The record is **`docs/test-cases-and-automation.docx`**, the same document the **test-research** skill creates and extends. Follow `references/recording.md` for the exact edits. In short:
- **The document doesn't exist** → create it from `.claude/skills/test-research/references/document-skeleton.md`, filled with this run's results.
- **The document exists** (from test-research, an earlier codebase-qa run, or by hand) → never regenerate it. Dump it, continue its IDs and areas, and edit in place with `.claude/skills/test-research/scripts/docx_tools.py`.
- What goes where: §1 catalogue rows for every test you added and every confirmed defect's case; §2 the automated tests; §3.1/3.2 environment and run commands; §6 "Test run results" the real results of the final run (logged and rendered with test-run-report's scripts — see `references/recording.md`); §4 confirmed defects (DEF/OBS, with the proving test) and suspected ones as observations marked "suspected"; §4.3 "checked and working correctly"; §5 an inspection-log row, coverage of critical flows, and code-health (Info) notes.
- Totals sentence recounted. README "Defects found (summary)" table updated only if the README already has one.
- Verify with `dump --grep` on every new ID and a rendered preview, then delete the `.bak`. Don't commit unless asked.

Finish with a short chat summary: whether the document was created or extended, the counts, the top 3–5 findings, what couldn't run, and the document path. Offer a shareable page (Artifact) if the results are meant for a team.

## Severity, priority and IDs (shared with test-research)
Use the scale in `.claude/skills/test-research/references/research-guide.md` §4 so the document reads as one list: severity Critical/High/Medium/Low, priority P1–P3, IDs `DEF-nnn` (Critical/High) and `OBS-n` (Medium/Low), continuing the document's numbering and never renumbering. How to apply it to code findings:
- **Critical**: money lost or created, auth bypass, any user reading or changing others' data, secret leaked, payment marked paid without payment.
- **High**: a core flow broken for many users, data corruption, stored XSS, privilege escalation needing a low-privilege account.
- **Medium**: a broken edge case in a core flow, wrong totals/reports, reflected XSS needing interaction, missing server-side validation the client covers.
- **Low**: UX/accessibility defects, poor error handling, minor inconsistencies.
- **Info** (not a defect, no ID): code health such as dead code, TODOs, missing CI, flaky tests. Goes in §5.3.
