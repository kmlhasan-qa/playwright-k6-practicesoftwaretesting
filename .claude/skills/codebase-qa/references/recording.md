# Recording codebase-qa results in the shared test document

Target: `docs/test-cases-and-automation.docx` in the repo under test. The layout, ID and severity conventions belong to test-research: `.claude/skills/test-research/references/research-guide.md` §4–§5 and `document-skeleton.md`. Read both; this file only says what codebase-qa puts where.

Tools (repo-relative paths, since the skills live in `.claude/skills`):
```bash
T=.claude/skills/test-research/scripts
python3 $T/docx_tools.py dump DOC [--grep TEXT]       # inspect
python3 $T/docx_tools.py apply DOC ops.json           # edit in place (writes DOC.bak first)
NODE_PATH=$SCRATCH/node_modules node $T/md2docx.js in.md out.docx   # Markdown -> docx (whole doc or fragment)
```
Once per session: `(cd "$SCRATCH" && npm init -y >/dev/null && npm install docx@9.5.1 >/dev/null)`.
Before editing, check for a `docs/~$test-cases-and-automation.docx` lock file. If there is one, the document is open in Word: ask the user to close it first.

## Mode A: the document doesn't exist yet → create it
1. Copy the skeleton from `document-skeleton.md` into `$SCRATCH/test-doc.md` and fill it with this run's material:
   - Title `<Project> – Test Cases & Automation Guide`; system under test, commit SHA, date, author (`git config user.name`).
   - §1: an area table (choose areas from the app's real features; see the project note, e.g. `camilanika.md`), then one `### 1.n` table per area with at least one row. Rows: a catalogue case for each test you added (Automated = suite + file › test name), each existing automated test worth cataloguing, and the case behind each confirmed defect. Leave out areas you have no cases for; test-research will add them later. Recount the Totals sentence.
   - §2: every automated test that exists now (existing suites and the ones you added), mapped to catalogue IDs.
   - §3.1–3.5: environment, commands, test data, performance (or "none yet"), limitations. §3.6 holds the real final-run counts per suite, with a note for each suite that didn't run.
   - §4: defects and observations (see "Defects" below). Replace the "No defects recorded yet." line, or keep it if there were none. §4.3 lists what you checked and found fine.
   - §5.1 is one log row for this run, with ID `INSP-1`. §5.2 covers critical flows; §5.3 holds the Info items.
2. Build it with md2docx.js to `docs/test-cases-and-automation.docx`, then dump it and render a preview.

## Mode B: the document exists → extend in place (never regenerate)
1. `dump` it. Note the areas and the last ID in each catalogue table, the highest DEF/OBS, §2 rows, the §3.6 heading text, §4 contents, and any §5 rows.
2. **No "5. Code inspection" section** (made by test-research or an older layout): write it as a fragment from the skeleton's §5 and add it with `append_section`.
3. Catalogue rows: use `insert_rows_after` (the last row of the area table, 9 cells), continuing that area's numbering. New area, or a table with only its header: rebuild "1. Test case catalogue" from the dump plus your additions, then `replace_section`. Cases that were `Manual` and now have your test get `replace_text`/`append_to_cell` on the Automated cell. Then recount and `replace_text` the "Totals:" sentence.
4. §2: `insert_rows_after` the last test row, or rebuild "2. Automated test cases" if empty.
5. §3.6: `replace_text` the heading date and each suite's result cell. If the suites differ from the table (e.g. it lists Playwright/newman but this repo uses node:test unit/db/ui), rebuild "3. Test execution" keeping the user's other text.
6. §4: rebuild "4. Known defects" as a fragment containing **all existing rows unchanged** plus yours, sorted by severity → priority → ID, and `replace_section`. Defects test-research found that your tests now prove: fill in their "Automated test" cell instead of creating a new ID. Defects your re-check shows fixed: keep the ID and set Actual (today) to "Fixed in <sha>, <date>; regression test <name> passes".
7. §5.1: `insert_rows_after` the highest `INSP-n` row with a new `INSP-(n+1)` row (if the table is empty, rebuild §5). Rows are keyed by that ID, so never start a log row with the date. Update §5.2 and §5.3 by rebuilding "5. Code inspection".
8. `dump --grep` each new ID, render a preview, delete `.bak`.

## Defects: what codebase-qa writes
- **Confirmed** (a failing test or a reproduced local probe) → 4.1 row with ID DEF-nnn (Critical/High) or OBS-n (Medium/Low). Summary; Expected; Actual (today) = what the test observed; Catalogue case; Automated test = `<suite> <file> › <test name> (todo/expected-fail)`. Each DEF also gets a detailed Field | Value table: Severity / Priority, Component (`file:line`, layer), Environment (local build: commit, tools), Pre-conditions, Steps to reproduce (= what the test does, so a human can repeat it), Expected result, Actual result, Evidence (test output excerpt and code quote), Impact, Suggested fix.
- **Suspected** (read in the code, couldn't prove it) → a 4.2 observation row whose text starts with "Suspected:", with an OBS ID, Automated test "—", and why it couldn't be proved. Never a DEF.
- The test's known-defect marker uses the document ID (`{ todo: "DEF-004: …" }`, `test.fail(…, "OBS-7 …")`), so the test and the document point at each other.
- The catalogue case behind a confirmed defect gets the bold note `Fails today: DEF-xxx` (automated) in its Automated cell.

## Hand-offs
- Later test-only runs → the **test-run-report** skill updates §3.6.
- Tests added or renamed later → the **test-docs-sync** skill reconciles §1/§2.
- Web research for more cases and defects → the **test-research** skill, which extends this same document.
