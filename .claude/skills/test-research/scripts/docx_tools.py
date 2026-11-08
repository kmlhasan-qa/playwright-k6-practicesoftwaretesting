#!/usr/bin/env python3
"""In-place editing helpers for the project's test documentation (.docx).

Edits the existing document XML instead of regenerating the file, so manual edits the
user made in Word (wording, formatting) survive. Python 3.9 compatible, stdlib only.

  python3 docx_tools.py dump  DOC.docx [--grep TEXT]     # numbered blocks + table rows
  python3 docx_tools.py apply DOC.docx OPS.json          # apply edit operations

OPS.json is a list of operations, applied in order:
  {"op": "replace_text", "old": "...", "new": "..."}
      Exact text inside a single text run (<w:t>). Fails if not found.
  {"op": "replace_section", "heading": "4. Known defects", "fragment": "frag.docx"}
      Replace a Heading 1 section (up to the next Heading 1) with the body of FRAG.docx.
  {"op": "replace_subsection", "heading": "3.6 Last results", "fragment": "frag.docx"}
      Replace a Heading 2 sub-section (up to the next Heading 1 or 2) with the body of FRAG.docx.
      The heading matches by prefix, so "3.6 Last results" finds "3.6 Last results (8 Nov 2026)".
  {"op": "append_section", "fragment": "frag.docx"}
      Append the body of FRAG.docx at the end of the document.
  {"op": "insert_rows_after", "row_id": "PAY-17", "rows": [["PAY-18", "Security", ...]]}
      Clone the table row whose first cell is ROW_ID and insert new rows after it.
      Cell text may use **bold** segments. Row length must match the table.
  {"op": "append_to_cell", "row_id": "AUTH-12", "cell": -1, "text": " Fails: OBS-7.", "bold": true}
      Append text to a cell of the row whose first cell is ROW_ID.

Fragments are .docx files made with md2docx.js. Bullet / numbered lists inside a fragment
are converted to plain paragraphs (their numbering ids would not match the target).
A backup DOC.docx.bak is written before saving.
"""
import json
import re
import shutil
import sys
import zipfile
from xml.dom import minidom

W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'


def read_xml(path):
    with zipfile.ZipFile(path) as z:
        return minidom.parseString(z.read('word/document.xml'))


def write_docx(path, doc):
    shutil.copyfile(path, path + '.bak')
    xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' + doc.documentElement.toxml()
    with zipfile.ZipFile(path + '.bak') as src, zipfile.ZipFile(path, 'w', zipfile.ZIP_DEFLATED) as dst:
        for item in src.infolist():
            if item.filename.endswith('/'):
                continue  # folder entries upset some Word co-editing services
            data = xml.encode('utf-8') if item.filename == 'word/document.xml' else src.read(item.filename)
            dst.writestr(item, data)


def text(node):
    return ''.join(t.firstChild.data if t.firstChild else '' for t in node.getElementsByTagName('w:t'))


def kids(node, tag=None):
    return [c for c in node.childNodes if c.nodeType == c.ELEMENT_NODE and (tag is None or c.tagName == tag)]


def style(p):
    s = p.getElementsByTagName('w:pStyle')
    return s[0].getAttribute('w:val') if s else ''


def is_pagebreak(p):
    return p.tagName == 'w:p' and not text(p).strip() and any(
        b.getAttribute('w:type') == 'page' for b in p.getElementsByTagName('w:br'))


def body(doc):
    return doc.getElementsByTagName('w:body')[0]


def rows_by_id(doc, row_id):
    hits = []
    for tr in doc.getElementsByTagName('w:tr'):
        cells = kids(tr, 'w:tc')
        if cells and text(cells[0]).strip().strip('*') == row_id:
            hits.append(tr)
    return hits


def one_row(doc, row_id):
    hits = rows_by_id(doc, row_id)
    if len(hits) != 1:
        sys.exit(f'row "{row_id}": expected 1 match, found {len(hits)}')
    return hits[0]


def make_runs(doc, value, size=None, bold_all=False):
    runs = []
    for i, seg in enumerate(value.split('**')):
        if not seg:
            continue
        r = doc.createElement('w:r')
        rpr = doc.createElement('w:rPr')
        if bold_all or i % 2 == 1:
            rpr.appendChild(doc.createElement('w:b'))
            rpr.appendChild(doc.createElement('w:bCs'))
        if size:
            for tag in ('w:sz', 'w:szCs'):
                e = doc.createElement(tag)
                e.setAttribute('w:val', size)
                rpr.appendChild(e)
        r.appendChild(rpr)
        t = doc.createElement('w:t')
        t.setAttribute('xml:space', 'preserve')
        t.appendChild(doc.createTextNode(seg))
        r.appendChild(t)
        runs.append(r)
    return runs


def cell_font_size(tc):
    sz = tc.getElementsByTagName('w:sz')
    return sz[0].getAttribute('w:val') if sz else None


def fragment_blocks(doc, frag_path):
    frag = read_xml(frag_path)
    out = []
    for node in kids(body(frag)):
        if node.tagName == 'w:sectPr':
            continue
        for numpr in list(node.getElementsByTagName('w:numPr')):
            p = numpr.parentNode.parentNode
            numpr.parentNode.removeChild(numpr)
            first_t = p.getElementsByTagName('w:t')
            if first_t and first_t[0].firstChild:
                first_t[0].firstChild.data = '• ' + first_t[0].firstChild.data
        out.append(doc.importNode(node, True))
    return out


def op_replace_text(doc, op):
    n = 0
    for t in doc.getElementsByTagName('w:t'):
        if t.firstChild and op['old'] in t.firstChild.data:
            t.firstChild.data = t.firstChild.data.replace(op['old'], op['new'])
            n += 1
    if n == 0:
        sys.exit(f'replace_text: not found in a single run: {op["old"][:80]!r} (use dump --grep to see how it is split)')
    return f'replace_text x{n}'


def section_range(doc, heading):
    blocks = kids(body(doc))
    start = next((i for i, b in enumerate(blocks)
                  if b.tagName == 'w:p' and style(b) == 'Heading1' and text(b).strip() == heading), None)
    if start is None:
        sys.exit(f'replace_section: Heading 1 "{heading}" not found')
    if start > 0 and is_pagebreak(blocks[start - 1]):
        start -= 1
    end = start + 2
    while end < len(blocks) and blocks[end].tagName != 'w:sectPr' and not (
            blocks[end].tagName == 'w:p' and style(blocks[end]) == 'Heading1'):
        end += 1
    if end < len(blocks) and blocks[end].tagName != 'w:sectPr' and is_pagebreak(blocks[end - 1]):
        end -= 1
    return blocks, start, end


def op_replace_section(doc, op):
    blocks, start, end = section_range(doc, op['heading'])
    anchor = blocks[end]
    for b in blocks[start:end]:
        body(doc).removeChild(b)
    new = fragment_blocks(doc, op['fragment'])
    for b in new:
        body(doc).insertBefore(b, anchor)
    return f'replace_section "{op["heading"]}": removed {end - start} blocks, inserted {len(new)}'


def op_replace_subsection(doc, op):
    blocks = kids(body(doc))
    start = next((i for i, b in enumerate(blocks)
                  if b.tagName == 'w:p' and style(b) == 'Heading2' and text(b).strip().startswith(op['heading'])), None)
    if start is None:
        sys.exit(f'replace_subsection: Heading 2 starting "{op["heading"]}" not found')
    end = start + 1
    while end < len(blocks) and blocks[end].tagName != 'w:sectPr' and not (
            blocks[end].tagName == 'w:p' and style(blocks[end]) in ('Heading1', 'Heading2')):
        end += 1
    if blocks[end].tagName == 'w:p' and style(blocks[end]) == 'Heading1' and is_pagebreak(blocks[end - 1]):
        end -= 1
    anchor = blocks[end]
    for b in blocks[start:end]:
        body(doc).removeChild(b)
    new = fragment_blocks(doc, op['fragment'])
    for b in new:
        body(doc).insertBefore(b, anchor)
    return f'replace_subsection "{op["heading"]}": removed {end - start} blocks, inserted {len(new)}'


def op_append_section(doc, op):
    sect = kids(body(doc), 'w:sectPr')[-1]
    new = fragment_blocks(doc, op['fragment'])
    for b in new:
        body(doc).insertBefore(b, sect)
    return f'append_section: inserted {len(new)} blocks'


def op_insert_rows_after(doc, op):
    src = one_row(doc, op['row_id'])
    anchor = src.nextSibling
    n_cells = len(kids(src, 'w:tc'))
    for values in op['rows']:
        if len(values) != n_cells:
            sys.exit(f'insert_rows_after {op["row_id"]}: row has {len(values)} cells, table has {n_cells}')
        tr = src.cloneNode(True)
        for tc, value in zip(kids(tr, 'w:tc'), values):
            size = cell_font_size(tc)
            paras = kids(tc, 'w:p')
            for extra in paras[1:]:
                tc.removeChild(extra)
            p = paras[0]
            for child in kids(p):
                if child.tagName != 'w:pPr':
                    p.removeChild(child)
            for r in make_runs(doc, value, size):
                p.appendChild(r)
        src.parentNode.insertBefore(tr, anchor)
    return f'insert_rows_after {op["row_id"]}: {len(op["rows"])} rows'


def op_append_to_cell(doc, op):
    tr = one_row(doc, op['row_id'])
    tc = kids(tr, 'w:tc')[op.get('cell', -1)]
    p = kids(tc, 'w:p')[-1]
    for r in make_runs(doc, op['text'], cell_font_size(tc), op.get('bold', False)):
        p.appendChild(r)
    return f'append_to_cell {op["row_id"]}'


OPS = {
    'replace_text': op_replace_text,
    'replace_section': op_replace_section,
    'replace_subsection': op_replace_subsection,
    'append_section': op_append_section,
    'insert_rows_after': op_insert_rows_after,
    'append_to_cell': op_append_to_cell,
}


def dump(path, grep=None):
    doc = read_xml(path)
    for i, b in enumerate(kids(body(doc))):
        if b.tagName == 'w:p':
            line = f'{i:4} P {style(b) or "-":10} {text(b)}'
            if not grep or grep.lower() in line.lower():
                print(line[:400])
        elif b.tagName == 'w:tbl':
            for j, tr in enumerate(kids(b, 'w:tr')):
                line = f'{i:4} T{j:<3}         ' + ' | '.join(text(tc) for tc in kids(tr, 'w:tc'))
                if not grep or grep.lower() in line.lower():
                    print(line[:400])
        if grep and b.tagName == 'w:p' and grep.lower() in text(b).lower():
            runs = [text(r) for r in b.getElementsByTagName('w:r')]
            print('        runs:', runs)


def main():
    if len(sys.argv) < 3 or sys.argv[1] not in ('dump', 'apply'):
        sys.exit(__doc__)
    cmd, path = sys.argv[1], sys.argv[2]
    if cmd == 'dump':
        grep = sys.argv[sys.argv.index('--grep') + 1] if '--grep' in sys.argv else None
        dump(path, grep)
        return
    with open(sys.argv[3], encoding='utf-8') as f:
        ops = json.load(f)
    doc = read_xml(path)
    for op in ops:
        print(OPS[op['op']](doc, op))
    minidom.parseString(doc.documentElement.toxml().encode('utf-8'))  # sanity check
    write_docx(path, doc)
    print('saved', path, '(backup:', path + '.bak)')


if __name__ == '__main__':
    main()
