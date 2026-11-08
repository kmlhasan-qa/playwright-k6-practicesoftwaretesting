#!/usr/bin/env python3
"""Parse test-run result files into numbers ready for the report.

Auto-detects the file type and prints a human summary plus a JSON blob the skill can
lift figures from. Python 3.9, stdlib only.

  python3 parse_results.py playwright-report.json          # Playwright JSON reporter
  python3 parse_results.py postman/results/newman-junit.xml # newman JUnit
  python3 parse_results.py perf/results/smoke-summary.json  # k6 --summary-export
  python3 parse_results.py a.json b.xml c.json              # several at once
  python3 parse_results.py perf/results/*-summary.json \
      --target https://api.practicesoftwaretesting.com \
      --history perf/results/history.jsonl                  # any k6 run kind, logged

k6 run kinds (all parsed the same way; the kind is detected, not assumed):
  smoke  (perf:smoke)  PROFILE=smoke, 1 order/s, all phases     -> smoke-summary.json
  load   (perf:load)   PROFILE=load, all phases normal→recovery -> load-summary.json
  single phase (perf:normal|ramp|peak|recovery)                 -> <phase>-summary.json
The profile comes from the file name when it says smoke/load/<phase>, otherwise from the
achieved arrival rate (smoke never exceeds ~1 order/s). The phases come from the tagged
per-phase metrics actually present in the summary.

Notes
- Playwright "expected" counts passing tests AND @defect tests marked test.fail() that
  failed as expected; "unexpected" is real failures. Report both.
- k6 --summary-export records each threshold as a boolean that is True when the threshold
  was CROSSED (i.e. failed). So a threshold passed when its value is False.
"""
import argparse
import datetime
import json
import os
import re
import sys
import xml.etree.ElementTree as ET


def parse_playwright(path):
    s = json.load(open(path)).get('stats', {})
    exp, unexp = s.get('expected', 0), s.get('unexpected', 0)
    return {
        'type': 'playwright',
        'passed_or_expected': exp,
        'failed_unexpected': unexp,
        'flaky': s.get('flaky', 0),
        'skipped': s.get('skipped', 0),
        'duration_s': round(s.get('duration', 0) / 1000, 1),
        'ok': unexp == 0,
    }


def parse_newman(path):
    root = ET.parse(path).getroot()  # <testsuites tests=requests ...>
    suites = root.findall('testsuite')
    assertions = sum(int(s.get('tests', 0)) for s in suites)
    failures = sum(int(s.get('failures', 0)) + int(s.get('errors', 0)) for s in suites)
    return {
        'type': 'newman',
        'requests': int(root.get('tests', len(suites))),
        'assertions': assertions,
        'failures': failures,
        'duration_s': round(float(root.get('time', 0)), 1),
        'ok': failures == 0,
    }


PHASE_ORDER = ['normal', 'ramp_up', 'peak', 'recovery']
SINGLE_PHASE_FILES = {'normal': 'normal', 'ramp': 'ramp_up', 'ramp_up': 'ramp_up',
                      'peak': 'peak', 'recovery': 'recovery'}


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


def parse_k6(path):
    m = json.load(open(path)).get('metrics', {})
    # thresholds: value True == crossed (failed)
    failed, passed = [], []
    for name, data in m.items():
        for expr, crossed in (data.get('thresholds') or {}).items():
            (failed if crossed else passed).append(f'{name}: {expr}')

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
                'p95': ms(data.get('p(95)')),
                'p99': ms(data.get('p(99)')),
                'max': ms(data.get('max')),
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
    checks = m.get('checks', {})
    mtime = datetime.datetime.fromtimestamp(os.path.getmtime(path))
    return {
        'type': 'k6',
        'file': path,
        'run_finished': mtime.strftime('%Y-%m-%d %H:%M'),
        'run_date': f"{mtime.day} {mtime.strftime('%b %Y')}",
        'profile': profile,
        'phase_selection': selection,
        'label': label,
        'all_thresholds_passed': not failed,
        'thresholds_total': len(failed) + len(passed),
        'thresholds_failed': failed,
        'orders_created': num('orders_created', 'count') or num('tx_created', 'count'),
        'iterations': iterations,
        'achieved_rate_per_s': round(iter_rate, 2) if iter_rate is not None else None,
        'approx_duration_s': round(iterations / iter_rate) if iterations and iter_rate else None,
        'dropped_iterations': num('dropped_iterations', 'count') or 0,
        'max_vus': num('vus_max', 'max') or num('vus_max', 'value'),
        'checks_passed': checks.get('passes'),
        'checks_failed': checks.get('fails'),
        'success_rate_pct': round((m.get('order_success', m.get('tx_success', {})).get('value', 0)) * 100, 2),
        'http_req_failed_pct': round(m.get('http_req_failed', {}).get('value', 0) * 100, 2),
        'phase_latency_p95': phase_latency,
        'other_duration_p95': other_dur,
    }


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
    if t == 'playwright':
        return (f"Playwright: {r['passed_or_expected']} passed/expected, "
                f"{r['failed_unexpected']} unexpected failures, {r['flaky']} flaky, "
                f"{r['skipped']} skipped ({r['duration_s']}s)")
    if t == 'newman':
        return (f"newman: {r['requests']} requests, "
                f"{r['assertions'] - r['failures']}/{r['assertions']} assertions passed "
                f"({r['duration_s']}s)")
    if t == 'k6':
        ph = ' · '.join(f"{k} {v['p95']}ms (p99 {v['p99']}ms)" for k, v in r['phase_latency_p95'].items())
        verdict = ('ALL thresholds passed' if r['all_thresholds_passed']
                   else f"{len(r['thresholds_failed'])}/{r['thresholds_total']} thresholds FAILED: "
                        + '; '.join(r['thresholds_failed']))
        return (f"{r['label']} ({r['file']}, finished {r['run_finished']}, ~{r['approx_duration_s']}s, "
                f"{r['achieved_rate_per_s']} orders/s avg, max {r['max_vus']} VUs)\n"
                f"     {verdict}; {r['orders_created']} orders, {r['success_rate_pct']}% success, "
                f"{r['http_req_failed_pct']}% HTTP errors, {r['dropped_iterations']} dropped.\n"
                f"     critical-call p95 by phase: {ph}\n"
                f"     other p95: " + ', '.join(f'{k}={v}ms' for k, v in r['other_duration_p95'].items()))
    return str(r)


def history_record(r, target):
    return {
        'finished': r['run_finished'], 'file': r['file'], 'target': target,
        'profile': r['profile'], 'phases': r['phase_selection'],
        'thresholds_passed': r['all_thresholds_passed'], 'thresholds_failed': r['thresholds_failed'],
        'orders': r['orders_created'], 'success_pct': r['success_rate_pct'],
        'http_failed_pct': r['http_req_failed_pct'], 'dropped': r['dropped_iterations'],
        'rate_per_s': r['achieved_rate_per_s'],
        'p95_by_phase': {k: v['p95'] for k, v in r['phase_latency_p95'].items()},
        'p99_by_phase': {k: v['p99'] for k, v in r['phase_latency_p95'].items()},
        'other_p95': r['other_duration_p95'],
    }


def append_history(path, records):
    """Append k6 runs to a JSONL log, skipping a run already logged (same file + finish time)."""
    seen = set()
    if os.path.exists(path):
        for line in open(path):
            if line.strip():
                d = json.loads(line)
                seen.add((d.get('file'), d.get('finished')))
    added = 0
    with open(path, 'a') as f:
        for rec in records:
            if (rec['file'], rec['finished']) in seen:
                continue
            f.write(json.dumps(rec) + '\n')
            added += 1
    return added


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('files', nargs='+')
    ap.add_argument('--history', help='append each k6 run to this JSONL log (e.g. perf/results/history.jsonl)')
    ap.add_argument('--target', default=os.environ.get('API_URL', 'https://api.practicesoftwaretesting.com'),
                    help='API the k6 run was pointed at (default: $API_URL or the public demo)')
    args = ap.parse_args()
    out = []
    for path in args.files:
        r = detect(path)
        if r['type'] == 'k6':
            r['target'] = args.target
        print(human(r))
        out.append(r)
    if args.history:
        k6_runs = [history_record(r, r['target']) for r in out if r['type'] == 'k6']
        n = append_history(args.history, k6_runs)
        print(f"\nhistory: {n} new k6 run(s) appended to {args.history}")
    print('\nJSON:')
    print(json.dumps(out, indent=2))


if __name__ == '__main__':
    main()
