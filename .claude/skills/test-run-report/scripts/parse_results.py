#!/usr/bin/env python3
"""Parse test-run result files into numbers ready for the report, and log each run.

Auto-detects the file type and prints a human summary plus a JSON blob. With --log, each
run is appended to the run log (docs/test-run-log.jsonl) that render_results_section.py
turns into the document's "6. Test run results" section. Python 3.9, stdlib only.

  python3 parse_results.py playwright-report.json            # Playwright JSON reporter
  python3 parse_results.py postman/results/newman-junit.xml  # newman JUnit
  python3 parse_results.py perf/results/smoke-summary.json   # k6 --summary-export
  python3 parse_results.py playwright-report.json postman/results/newman-junit.xml \\
      perf/results/smoke-summary.json --log docs/test-run-log.jsonl

One Playwright report holds every project that ran: it is split into one record per
project (ui, api), so `npm test` logs both the UI and the API run.

k6 run kinds (all parsed the same way; the kind is detected, not assumed):
  smoke  (perf:smoke)  PROFILE=smoke, 1 order/s, all phases     -> smoke-summary.json
  load   (perf:load)   PROFILE=load, all phases normal→recovery -> load-summary.json
  single phase (perf:normal|ramp|peak|recovery)                 -> <phase>-summary.json
The profile comes from the file name when it says smoke/load/<phase>, otherwise from the
achieved arrival rate (smoke never exceeds ~1 order/s). The phases come from the tagged
per-phase metrics actually present in the summary.

Targets (recorded with each run) come from the same env vars the suites use:
BASE_URL (UI), API_URL (API, k6), and the collection's baseUrl variable (newman).

Notes
- Playwright "expected" counts passing tests AND @defect tests marked test.fail() that
  failed as expected; "unexpected" is real failures. A test.fail() test that PASSES is
  reported as unexpected with note "defect test passed" (the defect may be fixed).
- k6 --summary-export records each threshold as a boolean that is True when the threshold
  was CROSSED (i.e. failed). So a threshold passed when its value is False.
"""
import argparse
import datetime
import json
import os
import re
import subprocess
import xml.etree.ElementTree as ET

DEFAULT_BASE_URL = 'https://practicesoftwaretesting.com'
DEFAULT_API_URL = 'https://api.practicesoftwaretesting.com'
DEFECT_ID = re.compile(r'\b(DEF-\d+|OBS-\d+)\b')


# ---------- helpers ----------
def local(dt):
    return dt.astimezone().strftime('%Y-%m-%d %H:%M')


def parse_iso(s):
    return datetime.datetime.fromisoformat(s.replace('Z', '+00:00'))


def git(*args):
    try:
        return subprocess.run(['git', *args], capture_output=True, text=True, check=True).stdout.strip()
    except Exception:
        return None


CODE_PATHS = ['tests', 'helpers', 'fixtures', 'pages', 'perf/checkout-load.js', 'postman/toolshop-api.postman_collection.json',
              'playwright.config.ts', 'package.json']


def code_at(when):
    """Commit checked out at `when` (latest commit not after it) and the current branch.

    For a run in the last 2 hours, '+local changes' is added when the test code has uncommitted
    edits — the run then tested more than that commit."""
    sha = git('log', '-1', f'--before={when.isoformat()}', '--format=%h') or git('rev-parse', '--short', 'HEAD')
    age = datetime.datetime.now().astimezone() - when
    if age < datetime.timedelta(hours=2) and git('status', '--porcelain', '--', *CODE_PATHS):
        sha = f'{sha} +local changes'
    return sha, git('rev-parse', '--abbrev-ref', 'HEAD')


def file_time(path):
    """When a result file was written. A tracked file with no local changes was restored by git
    (checkout/merge resets its mtime), so use the time of the commit that last changed it."""
    tracked = git('ls-files', '--error-unmatch', path) is not None
    if tracked and not git('status', '--porcelain', '--', path):
        ct = git('log', '-1', '--format=%cI', '--', path)
        if ct:
            return parse_iso(ct) - datetime.timedelta(seconds=1), 'approx. (time of the commit that saved it)'
    return datetime.datetime.fromtimestamp(os.path.getmtime(path)).astimezone(), 'file time'


def first_line(msg, n=240):
    """First lines of an error (up to 3 non-empty, e.g. 'expect… / Expected: 201 / Received: 500'), one line."""
    msg = re.sub(r'\x1b\[[0-9;]*m', '', msg or '').strip()
    lines = [ln.strip() for ln in msg.splitlines() if ln.strip()][:3]
    return ' / '.join(lines)[:n]


# ---------- Playwright ----------
def _walk(suite):
    for spec in suite.get('specs', []):
        yield spec
    for child in suite.get('suites', []):
        yield from _walk(child)


def parse_playwright(path):
    d = json.load(open(path))
    stats, cfg = d.get('stats', {}), d.get('config', {})
    projects = {}
    for top in d.get('suites', []):
        for spec in _walk(top):
            for t in spec.get('tests', []):
                proj = t.get('projectName') or 'default'
                results = t.get('results') or []
                last = results[-1] if results else {}
                expected_fail = t.get('expectedStatus') == 'failed'
                outcome = t.get('status')  # expected | unexpected | flaky | skipped
                ann = ' '.join(a.get('description', '') for a in t.get('annotations', []) if a.get('type') == 'fail')
                ids = sorted(set(DEFECT_ID.findall(spec['title'] + ' ' + ann)))
                if outcome == 'expected':
                    result = 'expected fail' if expected_fail else 'passed'
                elif outcome == 'flaky':
                    result = 'flaky'
                elif outcome == 'skipped':
                    result = 'skipped'
                else:
                    result = 'defect test passed' if expected_fail else 'failed'
                note = ''
                if result == 'expected fail':
                    note = ann or ', '.join(ids)
                elif result == 'failed':
                    errs = last.get('errors') or ([last['error']] if last.get('error') else [])
                    note = first_line(errs[0].get('message') if errs else '')
                elif result == 'defect test passed':
                    note = f"{', '.join(ids) or 'linked defect'} may be fixed – the test.fail() test passed"
                elif result == 'flaky':
                    note = f'passed on retry {last.get("retry", 0)}'
                rec = projects.setdefault(proj, {'tests': [], 'starts': [], 'ends': []})
                rec['tests'].append({
                    'title': spec['title'].split(' @')[0],
                    'file': spec.get('file'),
                    'result': result,
                    'duration_ms': sum(r.get('duration', 0) for r in results),
                    'defects': ids,
                    'note': note,
                })
                for r in results:
                    if r.get('startTime'):
                        st = parse_iso(r['startTime'])
                        rec['starts'].append(st)
                        rec['ends'].append(st + datetime.timedelta(milliseconds=r.get('duration', 0)))
    started = parse_iso(stats['startTime']) if stats.get('startTime') else \
        datetime.datetime.fromtimestamp(os.path.getmtime(path)).astimezone()
    both = len(projects) > 1
    out = []
    for proj, rec in sorted(projects.items(), key=lambda kv: {'ui': 0, 'api': 1}.get(kv[0], 2)):
        tests = rec['tests']
        count = lambda r: sum(1 for t in tests if t['result'] == r)  # noqa: E731
        p_start = min(rec['starts']) if rec['starts'] else started
        p_dur = (max(rec['ends']) - p_start).total_seconds() if rec['ends'] else stats.get('duration', 0) / 1000
        commit, branch = code_at(p_start)
        is_ui = proj == 'ui'
        failed = count('failed') + count('defect test passed')
        out.append({
            'type': 'playwright',
            'suite': 'ui' if is_ui else ('api' if proj == 'api' else proj),
            'suite_label': {'ui': 'UI tests (Playwright)', 'api': 'API tests (Playwright)'}.get(proj, f'Playwright – {proj}'),
            'file': path,
            'started': local(p_start),
            'duration_s': round(p_dur, 1),
            'command': 'npm test' if both else f'npm run test:{proj}',
            'commit': commit, 'branch': branch,
            'target': os.environ.get('BASE_URL', DEFAULT_BASE_URL) if is_ui else os.environ.get('API_URL', DEFAULT_API_URL),
            'runner': f"Playwright {cfg.get('version', '?')}" + (', Desktop Chrome' if is_ui else ', no browser')
                      + f", {cfg.get('metadata', {}).get('actualWorkers', '?')} workers",
            'total': len(tests),
            'passed': count('passed'),
            'expected_fail': count('expected fail'),
            'failed': failed,
            'flaky': count('flaky'),
            'skipped': count('skipped'),
            'ok': failed == 0,
            'tests': tests,
        })
    return out


# ---------- newman ----------
def parse_newman(path):
    root = ET.parse(path).getroot()
    suites = root.findall('testsuite')
    assertions = sum(int(s.get('tests', 0)) for s in suites)
    failures, failing = 0, []
    for s in suites:
        failures += int(s.get('failures', 0)) + int(s.get('errors', 0))
        for tc in s.findall('testcase'):
            f = tc.find('failure') if tc.find('failure') is not None else tc.find('error')
            if f is not None:
                failing.append({'request': s.get('name'), 'assertion': tc.get('name'),
                                'message': first_line(f.get('message') or f.text)})
    stamps = [parse_iso(s.get('timestamp')) for s in suites if s.get('timestamp')]
    started = min(stamps) if stamps else datetime.datetime.fromtimestamp(os.path.getmtime(path)).astimezone()
    commit, branch = code_at(started)
    target = DEFAULT_API_URL
    try:
        coll = json.load(open('postman/toolshop-api.postman_collection.json'))
        target = next((v['value'] for v in coll.get('variable', []) if v.get('key') == 'baseUrl'), target)
    except Exception:
        pass
    return [{
        'type': 'newman', 'suite': 'postman', 'suite_label': 'Postman collection (newman)',
        'file': path, 'started': local(started), 'duration_s': round(float(root.get('time', 0)), 1),
        'command': 'npm run test:postman', 'commit': commit, 'branch': branch, 'target': target,
        'collection': root.get('name'),
        'requests': int(root.get('tests', len(suites))),
        'assertions': assertions, 'failures': failures, 'failing': failing,
        'ok': failures == 0,
    }]


# ---------- k6 ----------
PHASE_ORDER = ['normal', 'ramp_up', 'peak', 'recovery']
SINGLE_PHASE_FILES = {'normal': 'normal', 'ramp': 'ramp_up', 'ramp_up': 'ramp_up',
                      'peak': 'peak', 'recovery': 'recovery'}
PHASE_COMMAND = {'normal': 'perf:normal', 'ramp_up': 'perf:ramp', 'peak': 'perf:peak', 'recovery': 'perf:recovery'}


def classify_k6(path, phases, iter_rate):
    """Return (profile, phase_selection, label) for a k6 summary."""
    stem = os.path.basename(path).replace('-summary.json', '').replace('.json', '').lower()
    tokens = re.split(r'[-_.]', stem)
    if 'smoke' in tokens:
        profile = 'smoke'
    elif 'load' in tokens or any(t in SINGLE_PHASE_FILES for t in tokens):
        profile = 'load'   # perf:normal|ramp|peak|recovery all use PROFILE=load
    else:
        profile = 'smoke' if (iter_rate or 0) <= 1.2 else 'load'
    ordered = [p for p in PHASE_ORDER if p in phases] + sorted(p for p in phases if p not in PHASE_ORDER)
    selection = 'all' if len(ordered) > 1 else (ordered[0] if ordered else 'unknown')
    label = f"k6 {profile}" + ('' if selection == 'all' else f" – {selection} phase only")
    return profile, selection, label


def _measured(data, expr):
    """Value a threshold expression was evaluated against, e.g. 'p(95)<1000' -> data['p(95)']."""
    m = re.match(r'\s*([a-z]+(?:\(\d+(?:\.\d+)?\))?)\s*[<>=!]', expr)
    agg = m.group(1) if m else ''
    if agg in data:
        return data[agg]
    if agg == 'rate':
        return data.get('value', data.get('rate'))
    return data.get('value')


def parse_k6(path):
    m = json.load(open(path)).get('metrics', {})
    thresholds = []
    for name, data in m.items():
        for expr, crossed in (data.get('thresholds') or {}).items():
            v = _measured(data, expr)
            if v is not None and 'rate' in expr:
                shown = f'{v * 100:.2f}%'
            elif v is not None and ('duration' in name or expr.startswith('p(') or expr.startswith('avg')):
                shown = f'{round(v)} ms'
            else:
                shown = f'{v:g}' if isinstance(v, (int, float)) else '–'
            thresholds.append({'metric': name, 'limit': expr, 'measured': shown, 'passed': not crossed})
    failed = [f"{t['metric']}: {t['limit']} (measured {t['measured']})" for t in thresholds if not t['passed']]

    def num(metric, field):
        return m.get(metric, {}).get(field)

    def ms(v):
        return round(v) if v is not None else None

    phase_latency = {}
    for key, data in m.items():
        mm = re.match(r'(http_req_duration)\{.*phase:([^},]+)', key)
        if mm:
            tag = re.search(r'name:([^},]+)', key)
            phase_latency[mm.group(2)] = {
                'p95': ms(data.get('p(95)')), 'p99': ms(data.get('p(99)')),
                'med': ms(data.get('med')), 'max': ms(data.get('max')),
                'limits': list((data.get('thresholds') or {}).keys()),
                'passed': not any((data.get('thresholds') or {}).values()),
                'critical': tag.group(1) if tag else None,
            }
    phase_latency = {k: phase_latency[k] for k in
                     [p for p in PHASE_ORDER if p in phase_latency] +
                     sorted(p for p in phase_latency if p not in PHASE_ORDER)}
    other_dur = {}
    for key, data in m.items():
        if 'duration' in key and 'phase:' not in key and data.get('p(95)') is not None:
            other_dur[key] = round(data.get('p(95)'))

    iter_rate = num('iterations', 'rate')
    iterations = num('iterations', 'count')
    profile, selection, label = classify_k6(path, set(phase_latency), iter_rate)
    command = 'npm run perf:smoke' if profile == 'smoke' and selection == 'all' else \
        'npm run perf:load' if selection == 'all' else \
        (f'npm run {PHASE_COMMAND[selection]}' if profile == 'load' and selection in PHASE_COMMAND
         else f'k6 run -e PROFILE={profile} -e PHASE={selection} perf/checkout-load.js')
    checks = m.get('checks', {})
    finished, time_source = file_time(path)
    dur = round(iterations / iter_rate) if iterations and iter_rate else None
    commit, branch = code_at(finished)
    return [{
        'type': 'k6', 'suite': f'k6-{profile}-{selection}', 'suite_label': label,
        'file': path,
        'started': local(finished - datetime.timedelta(seconds=dur or 0)),
        'run_finished': local(finished),
        'run_date': f"{finished.day} {finished.strftime('%b %Y')}",
        'time_source': time_source,
        'duration_s': dur,
        'command': command, 'commit': commit, 'branch': branch,
        'target': os.environ.get('API_URL', DEFAULT_API_URL),
        'profile': profile, 'phase_selection': selection, 'label': label,
        'ok': not failed,
        'all_thresholds_passed': not failed,
        'thresholds_total': len(thresholds),
        'thresholds_failed': failed,
        'thresholds': thresholds,
        'orders_created': num('orders_created', 'count') or num('tx_created', 'count'),
        'iterations': iterations,
        'achieved_rate_per_s': round(iter_rate, 2) if iter_rate is not None else None,
        'approx_duration_s': dur,
        'dropped_iterations': num('dropped_iterations', 'count') or 0,
        'max_vus': num('vus_max', 'max') or num('vus_max', 'value'),
        'http_requests': num('http_reqs', 'count'),
        'checks_passed': checks.get('passes'),
        'checks_failed': checks.get('fails'),
        'success_rate_pct': round((m.get('order_success', m.get('tx_success', {})).get('value', 0)) * 100, 2),
        'http_req_failed_pct': round(m.get('http_req_failed', {}).get('value', 0) * 100, 2),
        'phase_latency_p95': phase_latency,
        'other_duration_p95': other_dur,
    }]


def detect(path):
    if path.endswith('.xml'):
        return parse_newman(path)
    d = json.load(open(path))
    if 'metrics' in d and 'root_group' in d:
        return parse_k6(path)
    if 'stats' in d and 'suites' in d:
        return parse_playwright(path)
    raise SystemExit(f'Unrecognised result file: {path}')


def human(r):
    t = r['type']
    head = f"[{r['started']} · {r['commit']} · {r['target']}]"
    if t == 'playwright':
        s = (f"{r['suite_label']} {head}: {r['passed']} passed, {r['expected_fail']} expected-fail (known defects), "
             f"{r['failed']} FAILED, {r['flaky']} flaky, {r['skipped']} skipped of {r['total']} ({r['duration_s']}s)")
        for x in r['tests']:
            if x['result'] in ('failed', 'defect test passed', 'flaky'):
                s += f"\n     {x['result'].upper()}: {x['title']} – {x['note']}"
        return s
    if t == 'newman':
        s = (f"newman {head}: {r['requests']} requests, "
             f"{r['assertions'] - r['failures']}/{r['assertions']} assertions passed ({r['duration_s']}s)")
        for f in r['failing']:
            s += f"\n     FAILED: {f['request']} › {f['assertion']} – {f['message']}"
        return s
    if t == 'k6':
        ph = ' · '.join(f"{k} {v['p95']}ms (p99 {v['p99']}ms)" for k, v in r['phase_latency_p95'].items())
        verdict = ('ALL thresholds passed' if r['all_thresholds_passed']
                   else f"{len(r['thresholds_failed'])}/{r['thresholds_total']} thresholds FAILED: "
                        + '; '.join(r['thresholds_failed']))
        return (f"{r['label']} {head} ({r['file']}, finished {r['run_finished']}, ~{r['approx_duration_s']}s, "
                f"{r['achieved_rate_per_s']} orders/s avg, max {r['max_vus']} VUs)\n"
                f"     {verdict}; {r['orders_created']} orders, {r['success_rate_pct']}% success, "
                f"{r['http_req_failed_pct']}% HTTP errors, {r['dropped_iterations']} dropped.\n"
                f"     critical-call p95 by phase: {ph}\n"
                f"     other p95: " + ', '.join(f'{k}={v}ms' for k, v in r['other_duration_p95'].items()))
    return str(r)


def append_log(path, records):
    """Append runs to the JSONL run log, skipping a run already logged (same suite + start time)."""
    seen = set()
    if os.path.exists(path):
        for line in open(path):
            if line.strip():
                d = json.loads(line)
                seen.add((d.get('suite'), d.get('started')))
    added = 0
    os.makedirs(os.path.dirname(path) or '.', exist_ok=True)
    with open(path, 'a') as f:
        for rec in records:
            if (rec['suite'], rec['started']) in seen:
                continue
            f.write(json.dumps(rec, ensure_ascii=False) + '\n')
            added += 1
    return added


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('files', nargs='+')
    ap.add_argument('--log', help='append every run to this JSONL run log (docs/test-run-log.jsonl)')
    args = ap.parse_args()
    out = []
    for path in args.files:
        for r in detect(path):
            print(human(r))
            out.append(r)
    if args.log:
        n = append_log(args.log, out)
        print(f"\nlog: {n} new run(s) appended to {args.log} ({len(out) - n} already logged)")
    print('\nJSON:')
    print(json.dumps(out, indent=2, ensure_ascii=False))


if __name__ == '__main__':
    main()
