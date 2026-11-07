#!/usr/bin/env python3
"""Map a codebase for QA: what's in it, how it's tested, what the toolchain can run, and where risky patterns cluster.

Usage:  python3 -I inventory.py <repo_root> [--json out.json]
Stdlib only. Read-only: it never executes anything from the repo (only `which`/`--version` of system tools).
"""
import json
import os
import re
import shutil
import subprocess
import sys
from collections import Counter, defaultdict

SKIP_DIRS = {".git", "node_modules", "vendor", "dist", "build", ".next", "coverage", "__pycache__", ".venv", "venv",
             "playwright-report", "test-results", ".turbo", ".cache", "target"}
SKIP_FILE_RE = re.compile(r"(\.min\.(js|css)$|package-lock\.json$|yarn\.lock$|pnpm-lock\.yaml$)")
BINARY_EXT = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".svg", ".pdf", ".woff", ".woff2", ".ttf", ".zip",
              ".gz", ".mp4", ".mp3", ".docx", ".xlsx", ".pptx"}
LANG = {".js": "JavaScript", ".mjs": "JavaScript", ".cjs": "JavaScript", ".ts": "TypeScript", ".tsx": "TypeScript",
        ".jsx": "JavaScript", ".html": "HTML", ".css": "CSS", ".sql": "SQL", ".py": "Python", ".sh": "Shell",
        ".go": "Go", ".rb": "Ruby", ".php": "PHP", ".java": "Java", ".kt": "Kotlin", ".rs": "Rust", ".md": "Markdown",
        ".json": "JSON", ".yml": "YAML", ".yaml": "YAML", ".toml": "TOML", ".vue": "Vue", ".svelte": "Svelte"}
TEST_PATH_RE = re.compile(r"(^|/)(tests?|__tests__|spec|e2e|cypress|perf|postman)(/|$)|\.(test|spec)\.[a-z]+$|_test\.(go|py|sql|sh)$|(^|/)test_[^/]+\.py$")

# (label, regex, file-extension filter or None)
RISK_PATTERNS = [
    ("innerHTML/outerHTML/insertAdjacentHTML (XSS sink)", r"\.(inner|outer)HTML\s*[+]?=|insertAdjacentHTML\(", {".js", ".ts", ".html", ".jsx", ".tsx", ".vue"}),
    ("eval / new Function / string setTimeout", r"\beval\(|new Function\(|setTimeout\(\s*['\"]", {".js", ".ts", ".html"}),
    ("document.write", r"document\.write\(", {".js", ".html"}),
    ("target=_blank without rel", r"target=[\"']_blank[\"'](?![^>]*rel=)", {".html", ".js"}),
    ("localStorage/sessionStorage use", r"(local|session)Storage\.", {".js", ".ts", ".html"}),
    ("SECURITY DEFINER function", r"security\s+definer", {".sql"}),
    ("SECURITY DEFINER without search_path", None, {".sql"}),  # computed specially
    ("RLS enabled", r"enable\s+row\s+level\s+security", {".sql"}),
    ("policy definition", r"create\s+policy", {".sql"}),
    ("grant to anon/public", r"grant\s+[^;]*\bto\s+(anon|public)\b", {".sql"}),
    ("service_role / secret reference", r"service_role|SERVICE_ROLE|secret_key|API_KEY|PRIVATE_KEY", None),
    ("hard-coded JWT/long token", r"eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.", None),
    ("CORS wildcard", r"Access-Control-Allow-Origin['\"]?\s*[:,]\s*['\"]\*", None),
    ("parseFloat/toFixed on money-ish values", r"parseFloat\(|\.toFixed\(", {".js", ".ts"}),
    ("Date parsing/timezone-sensitive", r"new Date\([^)]+\)|getTimezoneOffset|toLocale(Date|Time)?String", {".js", ".ts"}),
    ("SQL built by string concat/template", r"(select|insert|update|delete)\b[^;\n]*(\$\{|\"\s*\+|'\s*\+)", {".js", ".ts", ".py"}),
    ("webhook / signature handling", r"webhook|signature|hmac|x-signature", {".js", ".ts", ".py"}),
    ("TODO/FIXME/HACK", r"\b(TODO|FIXME|HACK|XXX)\b", None),
    ("console.log left in", r"console\.log\(", {".js", ".ts"}),
]

TOOLS = ["node", "npm", "npx", "deno", "python3", "psql", "pg_ctl", "initdb", "docker", "supabase", "k6", "newman", "go", "cargo"]


def walk(root):
    for d, dirs, files in os.walk(root):
        dirs[:] = sorted(x for x in dirs if x not in SKIP_DIRS and not x.startswith(".") or x in {".github"})
        for f in sorted(files):
            p = os.path.join(d, f)
            rel = os.path.relpath(p, root)
            if SKIP_FILE_RE.search(rel):
                continue
            yield rel, p


def read(p):
    try:
        with open(p, "r", encoding="utf-8", errors="replace") as fh:
            return fh.read()
    except OSError:
        return ""


def tool_versions():
    out = {}
    for t in TOOLS:
        path = shutil.which(t)
        if not path:
            out[t] = None
            continue
        try:
            v = subprocess.run([path, "--version"], capture_output=True, text=True, timeout=10)
            out[t] = (v.stdout or v.stderr).strip().splitlines()[0][:80] if (v.stdout or v.stderr) else path
        except Exception:
            out[t] = path
    return out


def detect_test_frameworks(files_text, pkg_jsons):
    fw = set()
    for rel, txt in files_text.items():
        if not TEST_PATH_RE.search(rel):
            continue
        if "require(\"node:test\")" in txt or "from 'node:test'" in txt or 'from "node:test"' in txt or "require('node:test')" in txt:
            fw.add("node:test")
        if "@playwright/test" in txt:
            fw.add("@playwright/test")
        elif "playwright" in txt:
            fw.add("playwright (library)")
        if re.search(r"\b(describe|it)\(", txt) and ("jest" in txt or "vitest" in txt):
            fw.add("jest/vitest")
        if "import pytest" in txt or rel.endswith(".py") and "def test_" in txt:
            fw.add("pytest")
        if "k6/http" in txt:
            fw.add("k6")
        if rel.endswith(".sql"):
            fw.add("SQL test scripts")
        if "Deno.test" in txt:
            fw.add("Deno.test")
    for pj in pkg_jsons.values():
        deps = {**pj.get("dependencies", {}), **pj.get("devDependencies", {})}
        for k in ("jest", "vitest", "mocha", "@playwright/test", "playwright", "cypress", "newman", "pg"):
            if k in deps:
                fw.add(f"dep:{k}")
    return sorted(fw)


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(2)
    root = os.path.abspath(sys.argv[1])
    json_out = sys.argv[sys.argv.index("--json") + 1] if "--json" in sys.argv else None

    langs, loc = Counter(), Counter()
    files_text, big = {}, []
    tests, sources = [], []
    for rel, p in walk(root):
        ext = os.path.splitext(rel)[1].lower()
        if ext in BINARY_EXT:
            continue
        txt = read(p)
        n = txt.count("\n") + 1
        lang = LANG.get(ext, ext or "(none)")
        langs[lang] += 1
        loc[lang] += n
        files_text[rel] = txt
        (tests if TEST_PATH_RE.search(rel) else sources).append((rel, n))
        if n > 800 and ext not in {".json", ".md"}:
            big.append((rel, n))

    pkg_jsons = {}
    for rel, txt in files_text.items():
        if os.path.basename(rel) == "package.json":
            try:
                pkg_jsons[rel] = json.loads(txt)
            except ValueError:
                pass

    risks = defaultdict(lambda: Counter())
    for label, rx, exts in RISK_PATTERNS:
        if rx is None:
            continue
        r = re.compile(rx, re.I if label not in {"console.log left in"} else 0)
        for rel, txt in files_text.items():
            if TEST_PATH_RE.search(rel) and label not in {"hard-coded JWT/long token", "service_role / secret reference"}:
                continue
            if exts and os.path.splitext(rel)[1].lower() not in exts:
                continue
            c = len(r.findall(txt))
            if c:
                risks[label][rel] += c
    # SECURITY DEFINER functions lacking "set search_path" in the same statement
    for rel, txt in files_text.items():
        if not rel.endswith(".sql") or TEST_PATH_RE.search(rel):
            continue
        for m in re.finditer(r"create\s+(or\s+replace\s+)?function\s+([\w.\"]+)(.{0,1500}?)(\$\w*\$)", txt, re.I | re.S):
            header = m.group(3)
            # header region before the body + look ahead after body for attributes (language/security/set)
            tail = txt[m.end(): m.end() + 20000]
            end = tail.find(m.group(4))
            after = tail[end: end + 300] if end >= 0 else ""
            region = header + after
            if re.search(r"security\s+definer", region, re.I) and not re.search(r"set\s+search_path", region, re.I):
                risks["SECURITY DEFINER without search_path"][f"{rel} :: {m.group(2)}"] += 1

    # tables created vs RLS enabled
    tables, rls = set(), set()
    for rel, txt in files_text.items():
        if rel.endswith(".sql") and not TEST_PATH_RE.search(rel):
            tables |= {t.lower().split(".")[-1].strip('"') for t in re.findall(r"create\s+table\s+(?:if\s+not\s+exists\s+)?([\w.\"]+)", txt, re.I)}
            rls |= {t.lower().split(".")[-1].strip('"') for t in re.findall(r"alter\s+table\s+(?:only\s+)?([\w.\"]+)\s+enable\s+row\s+level\s+security", txt, re.I)}

    entry_points = [r for r, _ in sources if re.search(r"(^|/)(index|main|app|server)\.(html|js|ts|py|go)$|\.html$", r)]
    edge_functions = sorted({r.split("/")[2] for r, _ in sources if r.startswith("supabase/functions/") and r.count("/") >= 3})
    ci = [r for r in files_text if r.startswith(".github/workflows/") or r in {".gitlab-ci.yml", "Jenkinsfile", "azure-pipelines.yml"}]

    result = {
        "root": root,
        "languages": {k: {"files": langs[k], "lines": loc[k]} for k in sorted(langs, key=lambda x: -loc[x])},
        "entry_points": entry_points,
        "edge_functions": edge_functions,
        "large_files_over_800_lines": sorted(big, key=lambda x: -x[1]),
        "test_files": tests,
        "test_frameworks": detect_test_frameworks(files_text, pkg_jsons),
        "package_scripts": {k: v.get("scripts", {}) for k, v in pkg_jsons.items()},
        "ci_config": ci,
        "sql_tables_without_rls": sorted(tables - rls),
        "toolchain": tool_versions(),
        "risk_hotspots": {k: dict(v.most_common(15)) for k, v in risks.items()},
    }

    # human summary
    P = print
    P(f"# Inventory: {root}\n")
    P("## Languages (files / lines)")
    for k, v in result["languages"].items():
        P(f"- {k}: {v['files']} / {v['lines']}")
    P("\n## Entry points\n" + "\n".join(f"- {e}" for e in entry_points[:30]))
    if edge_functions:
        P("\n## Edge functions\n" + "\n".join(f"- {e}" for e in edge_functions))
    P("\n## Large files (>800 lines, review in chunks)\n" + ("\n".join(f"- {r}: {n}" for r, n in result["large_files_over_800_lines"]) or "- none"))
    P(f"\n## Tests: {len(tests)} files; frameworks: {', '.join(result['test_frameworks']) or 'none detected'}")
    for r, n in tests:
        P(f"- {r} ({n})")
    P("\n## package.json scripts")
    for k, v in result["package_scripts"].items():
        P(f"- {k}: " + (", ".join(f"{s}=`{c}`" for s, c in v.items()) or "(none)"))
    P("\n## CI\n" + ("\n".join(f"- {c}" for c in ci) or "- none (tests only run locally)"))
    P("\n## SQL tables with no RLS enable statement found\n" + ("\n".join(f"- {t}" for t in result["sql_tables_without_rls"]) or "- none"))
    P("\n## Toolchain")
    for k, v in result["toolchain"].items():
        P(f"- {k}: {v or 'MISSING'}")
    P("\n## Risk hotspots (counts per file; leads to inspect, not findings)")
    for k, v in result["risk_hotspots"].items():
        P(f"- {k}: " + ", ".join(f"{f}×{c}" for f, c in v.items()))

    if json_out:
        with open(json_out, "w") as fh:
            json.dump(result, fh, indent=2)
        P(f"\n(JSON written to {json_out})")


if __name__ == "__main__":
    main()
