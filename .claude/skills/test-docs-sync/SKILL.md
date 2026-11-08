---
name: test-docs-sync
description: Keep the test documentation (docs/test-cases-and-automation.docx and the README defect/summary tables) in sync with the actual test suite whenever test cases are created or changed. Use this right after writing, adding, renaming or deleting any automated test — a Playwright UI or API spec in tests/, a k6 scenario in perf/, or a Postman request — and whenever the user says they added test cases, asks to update/refresh/sync the report or catalogue, or asks to reflect new tests in the docs. It reconciles the catalogue rows, the "automated test cases" section, the automation status of each case, the defect list, and the totals, reusing the test-research scripts and document conventions.
---

# Keep the test docs in sync with the test suite

When test cases change, the document must change with them, or it quietly becomes fiction — a catalogue that claims a case is "Manual" when a test now covers it, a totals line that no longer adds up, a defect with no linked test. This skill reconciles `docs/test-cases-and-automation.docx` (and the README tables) with what is actually in `tests/`, `perf/` and `postman/`.

This is the counterpart to the **test-research** skill: test-research *adds* researched-and-verified cases and defects; this skill *reconciles* the document with the test suite after cases are written. Both edit the same document and share the same tooling and conventions.

## Tools and conventions (shared with test-research)
- Edit the .docx **in place** with `.claude/skills/test-research/scripts/docx_tools.py` (`dump` to inspect; `insert_rows_after`, `append_to_cell`, `replace_text`, `replace_section` to edit). See its docstring for every operation.
- Build any new section/table content as Markdown then convert with `.claude/skills/test-research/scripts/md2docx.js` (needs the `docx` npm package in a scratch dir).
- The **document layout, ID conventions and severity/priority scale** are in `.claude/skills/test-research/references/research-guide.md` §5 — read it; do not restate or re-derive it.
- Never regenerate the whole .docx: the user edits it in Word, and those edits must survive. A `~$...` file next to it means it is open in Word — warn the user to close/reopen.

## Workflow

### 1. Inventory the test suite
List what exists now and pull out case IDs and tags:
```bash
grep -rhoE "TC-(UI|API)-[0-9]+" tests | sort -u                 # automated case ids
grep -rhoE "@(e2e|api|ui|negative|defect)" tests | sort | uniq -c
grep -rlE "test\.fail\(" tests                                   # executable defect tests
ls perf/*.js ; grep -o '"perf:[a-z]*"' package.json             # k6 scenarios/scripts
```
Map a test to its catalogue area by location/name: `tests/api/auth` → AUTH, `cart` → CART, `checkout`/invoice → PAY/ORD, `products` → PROD, UI flows → the area they exercise, `perf/` → NF (performance). Note each test's tags, especially `@defect` + `test.fail()` (an executable bug report) and the defect/observation ID in its `test.fail()` message.

### 2. Inventory the document
```bash
python3 .claude/skills/test-research/scripts/docx_tools.py dump docs/test-cases-and-automation.docx
```
Capture: the catalogue rows per area with their **Automated** cell; the "automated test cases" section (§2) lists; the defect list and reports (§4); and the "Totals:" sentence.

### 3. Diff and decide the edits
For each difference, pick the smallest edit:
- **New automated test, no catalogue row** → add a catalogue row in the right area table (`insert_rows_after` the last row): fill ID (continue the area's numbering), Type, Title, Pre-requisites, Steps, Expected result, Severity, Priority, and set **Automated** to the test id (e.g. `API TC-API-050`). Also add it to the matching list in §2. If you can't infer Type/Severity/Priority from the test, ask the user rather than guess.
- **Case was `Manual`, now has a test** → `append_to_cell`/`replace_text` the Automated cell: `Manual` → `API TC-API-xxx` (or `UI`/`PM`/`k6`). If it carried a `Fails (manual, <date>): DEF-xxx` note and the new test is an executable `@defect` test, change the note to `Fails today: DEF-xxx` (automated, `test.fail()`).
- **New `@defect` test** → make sure the linked DEF/OBS exists in §4 and its "Automated test" column names the test; if the defect isn't documented yet, that's test-research's job — flag it.
- **Test renamed / deleted** → update or remove the stale id in the catalogue and §2; never leave a reference to a test that no longer exists.
- **New k6 scenario / perf script, or any new runnable command** → update the NF performance rows and the §3.4 performance description, the npm-script list, **and the matching command list in `RUN_COMMANDS.md`** (§6 for k6) so a reader can actually run it.

### 4. Recount and reconcile totals
Recompute the "Totals:" sentence (total cases, automated coverage count, how many automated tests fail today, how many manual cases fail). Count straight from the catalogue rows:
```bash
# dump prints a catalogue row as "<n> T<j>   AREA-nn | Type | ...", no leading pipe
python3 .claude/skills/test-research/scripts/docx_tools.py dump docs/test-cases-and-automation.docx \
  | grep -cE "T[0-9]+ +(AUTH|PROD|CART|ADDR|PAY|ORD|NF)-[0-9]+ \|"
```
Keep §1 (catalogue) and §2 (automated list) consistent with each other and with §4 (defects). Don't edit "6. Test run results": it shows what actually ran and is rebuilt by test-run-report from the run log. If tests were added or renamed since the last run, say that §6 reflects the previous suite until the next run (offer to run test-run-report).

### 5. Update the README and RUN_COMMANDS.md
Mirror any defect-table or automation changes in `README.md` (the "Defects found (summary)" table, the automated-scenarios table, ; leave the "Last local run" block to test-run-report, which mirrors §6). If a new **runnable command** was added (a new npm script, a new k6 scenario/phase), also add it to `RUN_COMMANDS.md` so the canonical command list stays complete.

### 6. Verify and report
- `dump --grep <new id>` to confirm each edit landed; render a preview (`qlmanage -t -s 1400 -o <dir> file.docx` on macOS shows page 1; render a fragment alone to check a whole new section). Delete the `.bak` once it looks right.
- Report: rows added/updated per area, totals before→after, anything you had to ask or guess, and anything that belongs to test-research (an undocumented defect). Don't commit unless asked; if asked and on the default branch, branch first.

## Principles
- **Stable IDs.** Continue numbering; never renumber existing cases — tests, the README and conversations reference them.
- **No duplicates.** Before adding a case, `dump --grep` a keyword; if an existing case covers it, update that case instead of adding a near-copy.
- **In-place edits only**, to preserve the user's Word edits.
- **The suite is the source of truth for automation status**; the catalogue's "Automated" column must match what is actually runnable.
