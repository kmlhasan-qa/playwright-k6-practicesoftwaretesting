---
name: test-research
description: Research possible test cases and known defects for the application under test using web search (the app's repo issues and docs, API spec, e-commerce / payment / OWASP checklists), verify each candidate defect against the live system, and add the results to the project's test documentation — new catalogue rows and a defect list sorted by severity and priority in docs/test-cases-and-automation.docx, plus the README defect table. Use this whenever the user asks to find more test cases, look for (more) bugs or defects, do exploratory or web research for testing ideas, extend the test catalogue or bug list, or refresh the test documentation with new findings — even if they don't mention web search or the docx explicitly.
---

# Test research → verified test cases and defects → documentation

The goal is a test document an assessor or team can trust: every new test case is runnable as written, and every defect in the list has been **reproduced on the system today**, with evidence. Web search supplies ideas; the live system decides what is a defect.

Read `references/research-guide.md` before starting — it has the search plan, the verification rules, the severity/priority scale and the exact layout of this project's document.

## Workflow

### 1. Know what already exists
- Find the system under test and its URLs (README, `helpers/config.ts`, `.env.example`).
- Dump the current document so you don't duplicate anything:
  `python3 .claude/skills/test-research/scripts/docx_tools.py dump docs/test-cases-and-automation.docx`
  Note the highest DEF/OBS numbers, the catalogue IDs per area, and which cases are already marked as failing.
- Skim `tests/` for what is automated.

### 2. Research (web search)
Follow the search plan in the guide. Send several searches in the same turn. Look for:
- **Reported bugs** for this app (repo issues, changelog, "with bugs" build, community write-ups).
- **Test ideas** the catalogue lacks: boundaries from the API spec, business-logic abuse (OWASP WSTG), payment/PCI rules, accessibility, compatibility.

Collect candidates in a scratch list: title, area, source URL, the expected behaviour and why.

### 3. Verify every candidate defect
Reproduce each one with a minimal probe against the live system (one request or a short script in the scratchpad), then confirm with a second focused check. Only reproduced issues go into the defect list; record the evidence (status codes, response excerpt, IDs). Respect shared environments — see "Probe etiquette" in the guide. Candidates that cannot be verified are reported to the user, not added.

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
   - `replace_section` "4. Known defects" with the fragment (or `append_section` if it doesn't exist yet)
   - `insert_rows_after` the last row of the right catalogue table for each new test case (9 cells)
   - `append_to_cell` on failing catalogue rows: `" Fails (manual, <date>): DEF-xxx."` with `"bold": true`
   - `replace_text` for the "Totals:" sentence and any counts in the intro (use `dump --grep` first to see how the text is split into runs)
   ```bash
   python3 .claude/skills/test-research/scripts/docx_tools.py apply docs/test-cases-and-automation.docx ops.json
   ```
3. **Check the result**: `dump --grep` the new IDs, and render a preview (`qlmanage -t -s 1400 -o <dir> file.docx` on macOS shows page 1; render the fragment on its own to see the section). Delete the `.bak` once it looks right.
4. **README**: update the "Defects found (summary)" table to mirror the sorted list.

### 6. Report back
Tell the user, briefly:
- new test cases added (count per area) and new defects (table: ID, severity/priority, one-line summary, how it was verified)
- candidates that could not be verified or did not reproduce, with their sources
- the sources used (URLs)
- what is not automated yet, and offer to add `@defect` regression tests for the new defects
- that nothing was committed

## Why it is done this way
- **Verification before listing**: web findings are often outdated, about a different version, or wrong. A defect list with unreproducible items destroys trust in the whole document.
- **In-place edits**: regenerating the .docx would silently drop the user's own edits.
- **Stable IDs and sorted tables**: tests, the README and conversations refer to DEF/OBS IDs; sorting by severity and priority is how readers triage.
