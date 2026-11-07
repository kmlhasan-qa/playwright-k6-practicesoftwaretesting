---
name: test-research
description: Research possible test cases and known defects for the application under test using web search (the app's repo issues and docs, API spec, e-commerce / payment / OWASP checklists), verify each candidate defect against the live system, and add the results to the project's test documentation — new catalogue rows and a defect list sorted by severity and priority in docs/test-cases-and-automation.docx, plus the README defect table. Use this whenever the user asks to find more test cases, look for (more) bugs or defects, do exploratory or web research for testing ideas, extend the test catalogue or bug list, or refresh the test documentation with new findings — even if they don't mention web search or the docx explicitly.
---

# Test research → verified test cases and defects → documentation

The goal is a test document an assessor or team can trust: every new test case is runnable as written, and every defect in the list has been **reproduced on the system today**, with evidence. Web search supplies ideas; the live system decides what is a defect.

Read `references/research-guide.md` before starting — it has the search plan, the verification rules, the severity/priority scale and the exact layout of this project's document.

**One shared document.** `docs/test-cases-and-automation.docx` is shared with the **codebase-qa**, **test-run-report** and **test-docs-sync** skills. Whichever runs first creates it from `references/document-skeleton.md`; every later run adds to it in place. This skill never overwrites or regenerates an existing document, and it builds on what the others recorded (catalogue areas, DEF/OBS numbering, defects already proved by codebase-qa tests).

## Workflow

### 1. Know what already exists
- Find the system under test and its URLs (README, setup docs, `helpers/config.ts`, `.env.example`, `js/config.js`).
- **Does `docs/test-cases-and-automation.docx` exist?**
  - **No** → create it now from `references/document-skeleton.md` (fill the title, system under test, commit, date, author and the catalogue areas from the app's real features). Your results go into it in step 5, like any later run.
  - **Yes** (created by an earlier test-research or codebase-qa run, or by hand) → never recreate it. Dump it so you don't duplicate anything:
    `python3 .claude/skills/test-research/scripts/docx_tools.py dump docs/test-cases-and-automation.docx`
    Note the highest DEF/OBS numbers, the catalogue areas and IDs, which cases are already marked as failing, and the §4 defects and §5 code-inspection log written by codebase-qa. A candidate already listed there is a duplicate: at most add new evidence to it, never a second ID.
- Skim `tests/` for what is automated.

### 2. Research (web search)
Follow the search plan in the guide. Send several searches in the same turn. Look for:
- **Reported bugs** for this app (repo issues, changelog, "with bugs" build, community write-ups).
- **Test ideas** the catalogue lacks: boundaries from the API spec, business-logic abuse (OWASP WSTG), payment/PCI rules, accessibility, compatibility.

Collect candidates in a scratch list: title, area, source URL, the expected behaviour and why.

### 3. Verify every candidate defect
If the project has a local test environment (a harness in `tests/`, a throwaway database, or one documented by codebase-qa in §3.1 of the document), verify there first: it's safe and repeatable. Only probe the live system for what the local setup can't show, within "Probe etiquette", and never create real orders, payments or accounts on a production shop.

Reproduce each one with a minimal probe against the system (one request or a short script in the scratchpad), then confirm with a second focused check. Only reproduced issues go into the defect list; record the evidence (status codes, response excerpt, IDs). Respect shared environments — see "Probe etiquette" in the guide. Candidates that cannot be verified are reported to the user, not added.

While probing, also try the catalogue cases marked `Manual` that are cheap to check over the API — this is often where new defects turn up.

### 4. Rate and number
Apply the severity/priority scale from the guide. Continue numbering (`DEF-nnn` for High/Critical, `OBS-n` for Medium/Low); never renumber existing IDs because tests and the README reference them. Sort defect tables by severity, then priority, then ID.

### 5. Update the document (in place)
The user may have edited the .docx in Word, so edit it rather than regenerate it.

1. **New/changed section content** (e.g. the whole "4. Known defects" section): write it as Markdown in the scratchpad — headings (`##`, `###`), paragraphs and tables only, no bullet lists — keeping all existing defects and adding the new ones in sorted order. Convert it to a fragment:
   ```bash
   # once per session: the converter needs the docx npm package
   (cd "$SCRATCH" && npm init -y >/dev/null && npm install docx@9.5.1 >/dev/null)
   NODE_PATH="$SCRATCH/node_modules" node .claude/skills/test-research/scripts/md2docx.js section.md section.docx
   ```
2. **Write an ops file** (JSON list) and apply it — see the docstring in `scripts/docx_tools.py` for every operation:
   - `replace_section` "4. Known defects" with the fragment (or `append_section` if it doesn't exist yet). Keep codebase-qa's defects and their "Automated test" links exactly as they are when you rebuild the section.
   - `insert_rows_after` the last row of the right catalogue table for each new test case (9 cells). If that table has only its header row (a fresh document), or the area doesn't exist yet, rebuild "1. Test case catalogue" with `replace_section` instead, and add the area to its intro table.
   - `append_to_cell` on failing catalogue rows: `" Fails (manual, <date>): DEF-xxx."` with `"bold": true`
   - `replace_text` for the "Totals:" sentence and any counts in the intro (use `dump --grep` first to see how the text is split into runs)
   ```bash
   python3 .claude/skills/test-research/scripts/docx_tools.py apply docs/test-cases-and-automation.docx ops.json
   ```
3. **Check the result**: `dump --grep` the new IDs, and render a preview (`qlmanage -t -s 1400 -o <dir> file.docx` on macOS shows page 1; render the fragment on its own to see the section). Delete the `.bak` once it looks right.
4. **README**: if the project's README has a "Defects found (summary)" table, update it to mirror the sorted list. If it has none (for example a production site repo), don't add one without asking.

### 6. Report back
Tell the user, briefly:
- whether the document was created this run or extended
- new test cases added (count per area) and new defects (table: ID, severity/priority, one-line summary, how it was verified)
- candidates that could not be verified or did not reproduce, with their sources
- the sources used (URLs)
- what is not automated yet, and offer to add `@defect` regression tests for the new defects
- that nothing was committed

## Why it is done this way
- **Verification before listing**: web findings are often outdated, about a different version, or wrong. A defect list with unreproducible items destroys trust in the whole document.
- **In-place edits**: regenerating the .docx would silently drop the user's own edits.
- **Stable IDs and sorted tables**: tests, the README and conversations refer to DEF/OBS IDs; sorting by severity and priority is how readers triage.
