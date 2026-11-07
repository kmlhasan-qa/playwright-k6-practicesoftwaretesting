# Creating the test document when it doesn't exist yet

`docs/test-cases-and-automation.docx` is **one shared document** written by several skills: test-research (researched cases + verified defects), codebase-qa (code inspection, tests added, defects proved by tests), test-run-report (run results) and test-docs-sync (keeps the catalogue aligned with the suites). Whichever skill runs first in a project **creates** it from this skeleton; every later run only **edits it in place** (docx_tools.py), because the user may have edited it in Word.

## Rules
- Create it only if `docs/test-cases-and-automation.docx` doesn't exist. If it exists, never regenerate it; dump it and edit in place.
- Keep the section numbers and heading texts below exactly: the skills find sections by their Heading 1 text (`replace_section "4. Known defects"`) and by text such as `Totals:` and `Last results (`.
- Fill only what you actually have. Sections with nothing yet keep their one-line "nothing yet" sentence. Never invent cases, results or defects to fill a table.
- Catalogue areas are chosen per project from its real features (e.g. AUTH, MENU, CART, PROMO, PAY, ORD, ADMIN, CASH, DB, NF). Keep the area list in §1's intro table, and add new areas as new `### 1.n` tables later.
- Adding to an existing document: use `insert_rows_after` (it clones a data row) when the table already has rows. A table that has **only its header row** can't be extended that way. Rebuild that whole Heading 1 section as Markdown (keeping everything already in it) and use `replace_section`. Remove a "nothing yet" sentence once its table has rows.
- Markdown subset for md2docx.js: `#` title (first line only), `##` = Heading 1 (starts a new page), `###` = Heading 2, paragraphs, tables, code blocks. Avoid bullet lists (they become plain paragraphs when spliced as fragments). A line starting with `**Label:**` starts its own paragraph.

## Build
```bash
SCRATCH=<scratchpad>; (cd "$SCRATCH" && [ -d node_modules/docx ] || (npm init -y >/dev/null && npm install docx@9.5.1 >/dev/null))
mkdir -p docs
DOC_AUTHOR="<git user.name>" NODE_PATH="$SCRATCH/node_modules" \
  node .claude/skills/test-research/scripts/md2docx.js "$SCRATCH/test-doc.md" docs/test-cases-and-automation.docx
python3 .claude/skills/test-research/scripts/docx_tools.py dump docs/test-cases-and-automation.docx | head -60
```
Keep the source Markdown in the scratchpad only. The .docx is the record from then on.

## Skeleton (copy, then fill the <...> parts)

```markdown
# <Project> – Test Cases & Automation Guide

**System under test:** <what it is, URLs, repo> · **Commit:** <sha> · **Created:** <date> by <author> with Claude Code

This document is the single record of testing for <project>: the test case catalogue (§1), the automated tests (§2), how to run them and the latest results (§3), known defects (§4) and the code inspection log (§5). It is updated in place after each research, inspection or test run.

## 1. Test case catalogue

| Area | Covers |
|---|---|
| <AREA> | <feature / layer> |

### 1.1 <AREA> – <area name>

| ID | Type | Title | Pre-requisites | Steps | Expected result | Sev | Prio | Automated |
|---|---|---|---|---|---|---|---|---|
| <AREA>-01 | <Functional / Negative / Security / Boundary / Permissions / UI / Performance> | <title> | <pre-reqs> | <numbered steps in one cell: 1) … 2) …> | <one observable result> | <High/Medium/Low> | <P1–P3> | <Manual, or suite + test, e.g. unit tests/unit/nota.test.js › "online order…"> |

Totals: <n> cases in <k> areas; <a> automated, <m> manual; <f> automated tests fail today (known defects), <g> manual cases fail.

## 2. Automated test cases

| Suite | Command | File | Test | Catalogue case |
|---|---|---|---|---|
| <unit/db/ui/api/k6> | `<command>` | <path> | <test name> | <AREA-nn> |

## 3. Test execution

### 3.1 Environment and setup
<tools and versions, how to build the local/throwaway environment; what must never be targeted (live DB, payment gateway)>

### 3.2 How to run
| Suite | Command | Needs |
|---|---|---|

### 3.3 Test data
<fixtures, seed data, test accounts; how each run isolates its data>

### 3.4 Performance
<k6 scenarios and their thresholds, or "No performance tests yet.">. Results so far: <none yet>.

### 3.5 Limitations
<what the automation can't cover (real payment gateway, email/WhatsApp delivery, production data) and why>

### 3.6 Last results (<date>)
| Suite | Result | Notes |
|---|---|---|
| <suite> | <n passed / n failed / n todo-or-expected-fail> | <what didn't run and why> |

## 4. Known defects

Defects are listed only when reproduced (by a failing test, a probe on a local environment, or a careful probe on the live system), with evidence. IDs: DEF-nnn for Critical/High, OBS-n for Medium/Low; never renumbered. Sorted by severity, then priority, then ID.

### 4.1 Defect list

| ID | Severity | Priority | Area | Summary | Expected | Actual (today) | Catalogue case | Automated test |
|---|---|---|---|---|---|---|---|---|

<No defects recorded yet.>

### 4.2 Observations

| ID | Severity | Priority | Observation | Automated test |
|---|---|---|---|---|

### 4.3 Checked and working correctly
<paragraph: what was checked and found fine, and by which method>

## 5. Code inspection

### 5.1 Inspection log
| Run | Date | Commit | Layers inspected | Findings (DEF/OBS) | Tests added | Not covered |
|---|---|---|---|---|---|---|

### 5.2 Coverage of critical flows
| Flow | Covered by | Gaps |
|---|---|---|

### 5.3 Code health notes
<Info-level items: missing CI, dead code, TODOs, large files, flaky tests. Not defects.>
```

Detailed defect reports (one Field | Value table per DEF, as described in research-guide.md §5) go in §4 after the 4.1 list.
