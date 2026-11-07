// Minimal Markdown → DOCX converter for docs/test-cases-and-automation.md
// Usage: node md2docx.js <in.md> <out.docx>
const fs = require('fs');
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, ShadingType,
  HeadingLevel, AlignmentType, PageOrientation, LevelFormat, BorderStyle, Footer, PageNumber,
  TableOfContents, PageBreak,
} = require('docx');

const [, , inPath, outPath] = process.argv;
const lines = fs.readFileSync(inPath, 'utf8').split('\n');

const FONT = 'Calibri';
const MONO = 'Consolas';
const CONTENT_W = 16838 - 2 * 900; // A4 landscape, 0.625" margins
const ACCENT = '1F4E79';

// ---------- inline: **bold**, `code`, [text](link) ----------
function runs(text, base = {}) {
  text = text.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/\\\|/g, '|');
  const out = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`|_[^_]+_(?=\W|$)|\*[^*]+\*)/g;
  let last = 0, m;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(new TextRun({ text: text.slice(last, m.index), ...base }));
    const t = m[0];
    if (t.startsWith('**')) out.push(new TextRun({ text: t.slice(2, -2), ...base, bold: true }));
    else if (t.startsWith('`')) out.push(new TextRun({ text: t.slice(1, -1), ...base, font: MONO, size: base.size ? base.size - 1 : 19, color: '7F1D1D' }));
    else out.push(new TextRun({ text: t.slice(1, -1), ...base, italics: true }));
    last = m.index + t.length;
  }
  if (last < text.length) out.push(new TextRun({ text: text.slice(last), ...base }));
  return out;
}

// ---------- tables ----------
const border = { style: BorderStyle.SINGLE, size: 4, color: 'BFBFBF' };
const borders = { top: border, bottom: border, left: border, right: border };
const splitRow = (l) => l.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map((c) => c.trim());

function table(rowsMd) {
  const header = splitRow(rowsMd[0]);
  const body = rowsMd.slice(2).map(splitRow);
  const n = header.length;
  // Width per column from content length (sqrt-damped), with a floor.
  const weight = header.map((h, i) => {
    const lens = [h, ...body.map((r) => r[i] || '')].map((s) => s.length);
    const avg = lens.reduce((a, b) => a + b, 0) / lens.length;
    const max = Math.max(...lens);
    return Math.max(Math.sqrt(avg * 0.7 + max * 0.3), 2.6);
  });
  const total = weight.reduce((a, b) => a + b, 0);
  const widths = weight.map((w) => Math.floor((w / total) * CONTENT_W));
  widths[n - 1] += CONTENT_W - widths.reduce((a, b) => a + b, 0);
  const size = n >= 7 ? 16 : 18;

  const cell = (text, i, isHeader, zebra) => new TableCell({
    width: { size: widths[i], type: WidthType.DXA },
    borders,
    shading: isHeader ? { fill: ACCENT, type: ShadingType.CLEAR, color: 'auto' }
      : zebra ? { fill: 'F2F6FA', type: ShadingType.CLEAR, color: 'auto' } : undefined,
    margins: { top: 50, bottom: 50, left: 80, right: 80 },
    children: [new Paragraph({
      spacing: { before: 0, after: 0 },
      children: runs(text || '', isHeader ? { size, bold: true, color: 'FFFFFF' } : { size }),
    })],
  });

  return new Table({
    width: { size: CONTENT_W, type: WidthType.DXA },
    columnWidths: widths,
    rows: [
      new TableRow({ tableHeader: true, cantSplit: true, children: header.map((h, i) => cell(h, i, true)) }),
      ...body.map((r, ri) => new TableRow({
        cantSplit: true,
        children: header.map((_, i) => cell(r[i], i, false, ri % 2 === 1)),
      })),
    ],
  });
}

// ---------- block parsing ----------
const children = [];
let i = 0;
let firstH1 = true;
let firstH2 = true;
while (i < lines.length) {
  const l = lines[i];
  if (!l.trim()) { i++; continue; }

  if (l.startsWith('```')) {
    const code = [];
    i++;
    while (i < lines.length && !lines[i].startsWith('```')) code.push(lines[i++]);
    i++;
    code.forEach((c, k) => children.push(new Paragraph({
      shading: { fill: 'F3F4F6', type: ShadingType.CLEAR, color: 'auto' },
      spacing: { before: k === 0 ? 80 : 0, after: k === code.length - 1 ? 120 : 0 },
      indent: { left: 200 },
      children: [new TextRun({ text: c || ' ', font: MONO, size: 18 })],
    })));
    continue;
  }

  if (l.startsWith('|')) {
    const rows = [];
    while (i < lines.length && lines[i].startsWith('|')) rows.push(lines[i++]);
    children.push(table(rows));
    children.push(new Paragraph({ spacing: { before: 0, after: 120 }, children: [] }));
    continue;
  }

  if (/^---+$/.test(l.trim())) { i++; continue; }

  const h = l.match(/^(#{1,3}) (.*)$/);
  if (h) {
    const level = h[1].length;
    if (level === 1 && firstH1) {
      firstH1 = false;
      children.push(new Paragraph({ heading: HeadingLevel.TITLE, children: runs(h[2]) }));
    } else {
      if (level === 2) {
        if (firstH2) {
          firstH2 = false;
        }
        children.push(new Paragraph({ children: [new PageBreak()] }));
      }
      const hl = level === 2 ? HeadingLevel.HEADING_1 : HeadingLevel.HEADING_2;
      children.push(new Paragraph({ heading: hl, children: runs(h[2]) }));
    }
    i++;
    continue;
  }

  const b = l.match(/^(\s*)- (.*)$/);
  if (b) {
    children.push(new Paragraph({ numbering: { reference: 'bullets', level: b[1].length >= 2 ? 1 : 0 }, children: runs(b[2]) }));
    i++;
    continue;
  }
  const num = l.match(/^(\d+)\. (.*)$/);
  if (num) {
    children.push(new Paragraph({ numbering: { reference: 'numbers', level: 0 }, children: runs(num[2]) }));
    i++;
    continue;
  }

  // plain paragraph (join soft-wrapped lines until blank / block start)
  const para = [l];
  i++;
  // a line starting with **Label:** begins its own paragraph (header block)
  while (i < lines.length && lines[i].trim() && !/^(#|\||```|\s*- |\d+\. |\*\*)/.test(lines[i])) para.push(lines[i++]);
  children.push(new Paragraph({ children: runs(para.join(' ')) }));
}

const doc = new Document({
  creator: 'Kamal Hasan',
  title: 'Test Cases & Automation Guide – Practice Software Testing (Toolshop)',
  styles: {
    default: { document: { run: { font: FONT, size: 20 }, paragraph: { spacing: { after: 100, line: 276 } } } },
    paragraphStyles: [
      { id: 'Title', name: 'Title', basedOn: 'Normal', next: 'Normal', run: { font: FONT, size: 40, bold: true, color: ACCENT }, paragraph: { spacing: { before: 0, after: 200 }, keepNext: true } },
      { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { font: FONT, size: 32, bold: true, color: ACCENT }, paragraph: { spacing: { before: 240, after: 160 }, keepNext: true, outlineLevel: 0 } },
      { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { font: FONT, size: 26, bold: true, color: '2E75B6' }, paragraph: { spacing: { before: 240, after: 120 }, keepNext: true, outlineLevel: 1 } },
    ],
  },
  numbering: {
    config: [
      { reference: 'bullets', levels: [
        { level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 400, hanging: 260 } } } },
        { level: 1, format: LevelFormat.BULLET, text: '◦', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 800, hanging: 260 } } } },
      ] },
      { reference: 'numbers', levels: [
        { level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 400, hanging: 300 } } } },
      ] },
    ],
  },
  sections: [{
    properties: {
      page: {
        size: { width: 11906, height: 16838, orientation: PageOrientation.LANDSCAPE },
        margin: { top: 900, bottom: 900, left: 900, right: 900 },
      },
    },
    footers: {
      default: new Footer({ children: [new Paragraph({
        alignment: AlignmentType.RIGHT,
        children: [
          new TextRun({ text: 'Toolshop – Test Cases & Automation Guide   ·   Page ', size: 16, color: '808080' }),
          new TextRun({ children: [PageNumber.CURRENT], size: 16, color: '808080' }),
        ],
      })] }),
    },
    children,
  }],
});

Packer.toBuffer(doc).then((buf) => { fs.writeFileSync(outPath, buf); console.log('wrote', outPath, buf.length, 'bytes'); });
