#!/usr/bin/env python3
"""Render the document's "6. Test run results" section (Markdown) from the run log.

  python3 render_results_section.py docs/test-run-log.jsonl > "$SCRATCH/results.md"
  NODE_PATH="$SCRATCH/node_modules" node .claude/skills/test-research/scripts/md2docx.js \\
      "$SCRATCH/results.md" "$SCRATCH/results.docx"
  # then docx_tools.py: replace_section "6. Test run results" (or append_section the first time)

The section is rebuilt from the log on every run, so a suite that was not run this time keeps
showing its last logged run (with its own date) — nothing is carried over by hand and nothing
is invented. Python 3.9, stdlib only.

Layout:
  6.1 Latest run summary      – one row per suite / k6 run kind: date, commit, target, result
  6.2 UI tests (Playwright)   – run details + every test with its result
  6.3 API tests (Playwright)  – run details + every test with its result
  6.4 Postman collection      – run details + failing assertions
  6.5 Performance (k6)        – per k6 run kind: run details, per-phase booking latency,
                                every threshold with its measured value
  6.6 Run history             – newest first, every logged run
"""
import argparse
import json
import sys

PERF_KINDS = [  # (profile, phase selection, label, command) in display order
    ('smoke', 'all', 'k6 smoke – all phases at 1 order/s', 'npm run perf:smoke'),
    ('load', 'all', 'k6 load – full model (normal → ramp → peak → recovery)', 'npm run perf:load'),
    ('load', 'normal', 'k6 load – normal phase only (NF-01)', 'npm run perf:normal'),
    ('load', 'ramp_up', 'k6 load – ramp-up phase only (NF-02)', 'npm run perf:ramp'),
    ('load', 'peak', 'k6 load – peak phase only (NF-03)', 'npm run perf:peak'),
    ('load', 'recovery', 'k6 load – recovery phase only (NF-04)', 'npm run perf:recovery'),
]
PHASE_LABEL = {'normal': 'normal', 'ramp_up': 'ramp-up', 'peak': 'peak', 'recovery': 'recovery'}


def perf_kinds(k6):
    """Known run kinds in display order, then any other kind found in the log (e.g. smoke – peak only)."""
    known = {(p, sel) for p, sel, _, _ in PERF_KINDS}
    extra = [(p, sel, r['label'], r['command']) for (p, sel), r in sorted(k6.items()) if (p, sel) not in known]
    return PERF_KINDS + extra


def cell(v):
    return str(v if v is not None else '–').replace('|', '\\|').replace('\n', ' ')


def table(headers, rows):
    out = ['| ' + ' | '.join(headers) + ' |', '|' + '---|' * len(headers)]
    out += ['| ' + ' | '.join(cell(c) for c in r) + ' |' for r in rows]
    return '\n'.join(out) + '\n'


def when(r):
    return r['started']


def nice_date(r):
    return r['started']  # 'YYYY-MM-DD HH:MM' local time


def dur(s):
    if s is None:
        return '–'
    s = round(s)
    return f'{s // 60} min {s % 60:02d} s' if s >= 60 else f'{s} s'


def verdict(r):
    return '**PASS**' if r['ok'] else '**FAIL**'


def result_text(r):
    t = r['type']
    if t == 'playwright':
        parts = [f"{r['passed']} passed"]
        if r['expected_fail']:
            n = r['expected_fail']
            parts.append(f"{n} known-defect test{'s' if n != 1 else ''} failed as expected")
        parts.append(f"{r['failed']} failed")
        if r['flaky']:
            parts.append(f"{r['flaky']} flaky")
        if r['skipped']:
            parts.append(f"{r['skipped']} skipped")
        return f"{r['total']} tests: " + ', '.join(parts)
    if t == 'newman':
        return (f"{r['requests']} requests, {r['assertions'] - r['failures']} / {r['assertions']} "
                f"assertions passed")
    if t == 'k6':
        th = 'all thresholds passed' if r['all_thresholds_passed'] else \
            f"{len(r['thresholds_failed'])} of {r['thresholds_total']} thresholds failed"
        ph = ', '.join(f"{PHASE_LABEL.get(k, k)} {v['p95']} ms" for k, v in r['phase_latency_p95'].items())
        return (f"{th}; {r['orders_created']} orders, {r['success_rate_pct']:g}% success, "
                f"{r['http_req_failed_pct']:g}% HTTP errors, {r['dropped_iterations']} dropped. "
                f"Booking p95: {ph}")
    return ''


def details_table(rows):
    return table(['Field', 'Value'], rows)


def section_playwright(num, title, r):
    md = [f'### {num} {title}\n']
    if not r:
        md.append('Not run yet.\n')
        return '\n'.join(md)
    md.append(details_table([
        ('Result', f"{verdict(r)} – {result_text(r)}"),
        ('Run', f"{r['started']} (local time), {dur(r['duration_s'])}"),
        ('Command', f"`{r['command']}`"),
        ('Code', f"commit {r['commit']}"),
        ('Target', r['target']),
        ('Runner', r['runner']),
    ]))
    problems = [t for t in r['tests'] if t['result'] in ('failed', 'defect test passed', 'flaky')]
    if problems:
        md.append('**Needs attention:** ' + '; '.join(f"{t['title']} – {t['result']}: {t['note']}" for t in problems) + '\n')
    order = {'failed': 0, 'defect test passed': 1, 'flaky': 2, 'expected fail': 3, 'passed': 4, 'skipped': 5}
    tests = sorted(r['tests'], key=lambda t: (order.get(t['result'], 9), t['title']))
    md.append(table(['Test', 'File', 'Result', 'Time', 'Note'], [
        (t['title'], t['file'],
         f"**{t['result']}**" if t['result'] in ('failed', 'defect test passed', 'flaky') else t['result'],
         f"{t['duration_ms'] / 1000:.1f} s", t['note']) for t in tests]))
    return '\n'.join(md)


def section_newman(num, r):
    md = [f'### {num} Postman collection (newman)\n']
    if not r:
        md.append('Not run yet.\n')
        return '\n'.join(md)
    md.append(details_table([
        ('Result', f"{verdict(r)} – {result_text(r)}"),
        ('Run', f"{r['started']} (local time), {dur(r['duration_s'])}"),
        ('Command', f"`{r['command']}`"),
        ('Code', f"commit {r['commit']}"),
        ('Target', r['target']),
        ('Collection', r.get('collection')),
    ]))
    if r['failing']:
        md.append(table(['Request', 'Assertion', 'Message'],
                        [(f['request'], f['assertion'], f['message']) for f in r['failing']]))
    else:
        md.append('No failing assertions.\n')
    return '\n'.join(md)


def section_k6(num, latest_by_kind):
    md = [f'### {num} Performance tests (k6)\n',
          'One block per k6 run kind, each showing its own latest run. A smoke run (1 order/s) is a '
          'functional baseline, not a capacity result; load runs are capacity results for the environment '
          'they targeted. Smoke runs target the public demo; load runs target the local Toolshop in Docker '
          '(http://localhost:8091, data reset and API cache cleared before each run), never the public demo. '
          'The shop and k6 then share one machine, so load results show what that machine can handle, '
          'not production capacity.\n']
    not_run = []
    for profile, sel, label, command in perf_kinds(latest_by_kind):
        r = latest_by_kind.get((profile, sel))
        if not r:
            not_run.append(f'{label} (`{command}`)')
            continue
        md.append(f'**{label}**\n')
        md.append(details_table([
            ('Result', f"{verdict(r)} – {result_text(r)}"),
            ('Run', f"{r['started']} (local time), about {dur(r['duration_s'])}"
                    + (f" – time {r['time_source']}" if r.get('time_source', 'file time') != 'file time' else '')),
            ('Command', f"`{r['command']}`"),
            ('Code', f"commit {r['commit']}"),
            ('Target', r['target']),
            ('Load delivered', f"{r['achieved_rate_per_s']} orders/s average, {r['iterations']} iterations, "
                               f"{r['http_requests']} HTTP requests, max {r['max_vus']} VUs"),
            ('Correctness', f"{r['orders_created']} orders created, {r['success_rate_pct']:g}% order success, "
                            f"checks {r['checks_passed']} passed / {r['checks_failed']} failed"),
            ('Other latency (p95)', ', '.join(
                f"{k.replace('http_req_duration{flow:cart}', 'cart calls').replace('order_flow_duration', 'whole order')}"
                f" {v} ms" for k, v in r['other_duration_p95'].items()
                if k in ('http_req_duration{flow:cart}', 'order_flow_duration'))),
        ]))
        md.append(table(['Phase', 'Booking median', 'Booking p95', 'Booking p99', 'Max', 'Limits', 'Result'], [
            (PHASE_LABEL.get(k, k), f"{v.get('med', '–')} ms", f"{v['p95']} ms", f"{v['p99']} ms",
             f"{v.get('max', '–')} ms", ', '.join(v.get('limits', [])) or '–',
             'passed' if v.get('passed', True) else '**failed**')
            for k, v in r['phase_latency_p95'].items()]))
        ths = sorted(r.get('thresholds', []), key=lambda t: (t['passed'], t['metric'], t['limit']))
        if ths:
            md.append(table(['Threshold', 'Limit', 'Measured', 'Result'], [
                (t['metric'], t['limit'], t['measured'], 'passed' if t['passed'] else '**failed**') for t in ths]))
    if not_run:
        md.append('**Not run yet:** ' + '; '.join(not_run) + '.\n')
    return '\n'.join(md)


def render(log):
    runs = sorted(log, key=when)
    latest = {}
    for r in runs:
        key = (r['profile'], r['phase_selection']) if r['type'] == 'k6' else r['suite']
        latest[key] = r
    ui, api, pm = latest.get('ui'), latest.get('api'), latest.get('postman')
    k6 = {k: v for k, v in latest.items() if isinstance(k, tuple)}

    md = ['## 6. Test run results\n',
          'The latest run of every suite, with its details, and the history of all runs. This section is '
          'rebuilt from `docs/test-run-log.jsonl` by the test-run-report skill after each run, so edit the '
          'log rather than this section. Each suite shows its own latest run: a suite that was not run '
          'with the others keeps its earlier date. Known-defect tests (marked `test.fail()`) are expected '
          'to fail and count as passing; they fail because the application has the bug.\n',
          '### 6.1 Latest run summary\n']
    summary = []
    for label, r in (('UI tests (Playwright)', ui), ('API tests (Playwright)', api), ('Postman (newman)', pm)):
        summary.append((label, r['started'] if r else 'not run', r['commit'] if r else '–',
                        r['target'] if r else '–', result_text(r) if r else '–', verdict(r) if r else '–'))
    for profile, sel, label, _ in perf_kinds(k6):
        r = k6.get((profile, sel))
        if r:
            summary.append((label, r['started'], r['commit'], r['target'], result_text(r), verdict(r)))
    md.append(table(['Suite', 'Last run', 'Commit', 'Target', 'Result', 'Verdict'], summary))
    missing = [label for profile, sel, label, _ in PERF_KINDS if (profile, sel) not in k6]
    if missing:
        md.append('Not run yet: ' + '; '.join(missing) + '. See 6.5.\n')

    md.append(section_playwright('6.2', 'UI tests (Playwright)', ui))
    md.append(section_playwright('6.3', 'API tests (Playwright)', api))
    md.append(section_newman('6.4', pm))
    md.append(section_k6('6.5', k6))

    md.append('### 6.6 Run history\n')
    md.append(table(['Started', 'Suite', 'Command', 'Commit', 'Target', 'Result', 'Verdict'], [
        (r['started'], r['suite_label'], f"`{r['command']}`", r['commit'], r['target'], result_text(r), verdict(r))
        for r in reversed(runs)]))
    return '\n'.join(md)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('log')
    args = ap.parse_args()
    log = [json.loads(line) for line in open(args.log) if line.strip()]
    if not log:
        sys.exit('run log is empty – parse a result file with --log first')
    print(render(log))


if __name__ == '__main__':
    main()
