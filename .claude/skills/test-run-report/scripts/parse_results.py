#!/usr/bin/env python3
"""Parse test-run result files into numbers ready for the report.

Auto-detects the file type and prints a human summary plus a JSON blob the skill can
lift figures from. Python 3.9, stdlib only.

  python3 parse_results.py playwright-report.json          # Playwright JSON reporter
  python3 parse_results.py postman/results/newman-junit.xml # newman JUnit
  python3 parse_results.py perf/results/smoke-summary.json  # k6 --summary-export
  python3 parse_results.py a.json b.xml c.json              # several at once

Notes
- Playwright "expected" counts passing tests AND @defect tests marked test.fail() that
  failed as expected; "unexpected" is real failures. Report both.
- k6 --summary-export records each threshold as a boolean that is True when the threshold
  was CROSSED (i.e. failed). So a threshold passed when its value is False.
"""
import json
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


def parse_k6(path):
    m = json.load(open(path)).get('metrics', {})
    # thresholds: value True == crossed (failed)
    failed, total = [], 0
    for name, data in m.items():
        for expr, crossed in (data.get('thresholds') or {}).items():
            total += 1
            if crossed:
                failed.append(f'{name}: {expr}')

    def num(metric, field):
        return m.get(metric, {}).get(field)

    phase_latency = {}
    base_name = None
    for key, data in m.items():
        mm = re.match(r'(http_req_duration)\{.*phase:([^},]+)', key)
        if mm:
            base_name = key.split('{')[0]
            tag = re.search(r'name:([^},]+)', key)
            phase_latency[mm.group(2)] = {
                'p95': round(data.get('p(95)', 0)),
                'p99': round(data.get('p(99)', 0)) if data.get('p(99)') is not None else None,
                'critical': tag.group(1) if tag else None,
            }
    other_dur = {}
    for key, data in m.items():
        if 'duration' in key and 'phase:' not in key and data.get('p(95)') is not None:
            other_dur[key] = round(data.get('p(95)'))

    checks = m.get('checks', {})
    return {
        'type': 'k6',
        'all_thresholds_passed': not failed,
        'thresholds_total': total,
        'thresholds_failed': failed,
        'orders_created': num('orders_created', 'count') or num('tx_created', 'count'),
        'iterations': num('iterations', 'count'),
        'dropped_iterations': num('dropped_iterations', 'count'),
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
        ph = ' · '.join(f"{k} {v['p95']}ms" for k, v in r['phase_latency_p95'].items())
        verdict = 'ALL thresholds passed' if r['all_thresholds_passed'] else f"{len(r['thresholds_failed'])} thresholds FAILED"
        return (f"k6: {verdict}; {r['orders_created']} orders, {r['success_rate_pct']}% success, "
                f"{r['http_req_failed_pct']}% HTTP errors, {r['dropped_iterations']} dropped.\n"
                f"     critical-call p95 by phase: {ph}\n"
                f"     other p95: " + ', '.join(f'{k.split(chr(123))[0]}={v}ms' if '{' in k else f'{k}={v}ms' for k, v in r['other_duration_p95'].items()))
    return str(r)


def main():
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    out = []
    for path in sys.argv[1:]:
        r = detect(path)
        print(human(r))
        out.append(r)
    print('\nJSON:')
    print(json.dumps(out, indent=2))


if __name__ == '__main__':
    main()
