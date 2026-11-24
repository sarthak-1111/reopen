// Generates Reopen's self-made sample files (all content fictional) into samples/.
// Usage: node tools/make-samples.mjs
// Every file is created by this script: no real documents, no real people.
import { createRequire } from 'node:module';
import { mkdirSync, rmSync, writeFileSync, copyFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as XLSX from 'xlsx';
import { zipSync } from 'fflate';

const require = createRequire(import.meta.url);
const CFB = require('cfb');
const Encoding = require('encoding-japanese');
const cptable = require('codepage');

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'samples');
const manifest = [];

function write(rel, bytes, expect) {
  const path = join(out, rel);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, bytes);
  manifest.push({ path: rel.replace(/\\/g, '/'), bytes: bytes.length, ...expect });
}

const u16 = (n) => [n & 0xff, (n >> 8) & 0xff];
const u32 = (n) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff];
const latin1 = (s) => Uint8Array.from(cptable.utils.encode(1252, s));

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

// ---------------------------------------------------------------------------
// 1. Text in legacy encodings
// ---------------------------------------------------------------------------
const sjisText = '社内連絡\r\n1994年3月2日\r\n\r\n倉庫の在庫確認が終わりました。\r\n集計表は添付のとおりです。\r\n第一四半期の書類として保管してください。\r\n\r\n総務課\r\n';
write('text/memo-shift_jis.txt', Uint8Array.from(Encoding.convert(Encoding.stringToCode(sjisText), { to: 'SJIS', from: 'UNICODE' })), {
  format: 'text', encoding: 'shift_jis', includes: ['倉庫の在庫確認が終わりました', '総務課'],
});

const eucText = 'お知らせ\n平成七年度 夏季休業のご案内\n\n八月十三日から十六日まで休業いたします。\n緊急の連絡は守衛室までお願いします。\n';
write('text/notice-euc-jp.txt', Uint8Array.from(Encoding.convert(Encoding.stringToCode(eucText), { to: 'EUCJP', from: 'UNICODE' })), {
  format: 'text', encoding: 'euc-jp', includes: ['夏季休業のご案内', '守衛室'],
});

const cp1252Text =
  'Lettre de confirmation\r\nParis, le 12 mai 1996\r\n\r\nMadame, Monsieur,\r\n\r\n' +
  'Nous avons bien reçu votre commande du 3 mai. Les pièces détachées seront expédiées la semaine prochaine.\r\n' +
  'Montant total : 1 250 € (frais de port compris).\r\n\r\n' +
  '« Le service des ventes » vous prie d’agréer ses salutations distinguées.\r\n';
write('text/letter-cp1252.txt', latin1(cp1252Text), {
  format: 'text', encoding: 'windows-1252', includes: ['Nous avons bien reçu votre commande', '1 250 €'],
});

const ebcdicText =
  'MONTHLY LEDGER REPORT\nPeriod ending 30 November 1988\n\n' +
  'Account 4471  Office supplies      1,250.00\nAccount 4472  Printer ribbons        310.50\n' +
  'Account 4480  Postage                 96.20\n\nTotal for the period: 1,656.70\nPrepared by the accounts office.\n';
write('text/ledger-ebcdic-cp037.txt', Uint8Array.from(cptable.utils.encode(37, ebcdicText.replace(/\n/g, '\u0085'))), {
  format: 'ebcdic-text', encoding: 'ebcdic-37', includes: ['MONTHLY LEDGER REPORT', 'Printer ribbons'],
});

// ---------------------------------------------------------------------------
// 2. Spreadsheets (written by SheetJS in every legacy format it can write)
// ---------------------------------------------------------------------------
const inventory = [
  ['Item', 'Quantity', 'Unit price', 'Total'],
  ['Index cards', 120, 0.05, 6],
  ['Floppy disks', 40, 1.2, 48],
  ['Ribbon cartridges', 6, 7.5, 45],
  ['Paper clips (box)', 15, 0.8, 12],
];
function workbook(rows, sheetName, title) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), sheetName);
  wb.Props = { ...(title ? { Title: title } : {}), Author: 'Reopen sample generator', CreatedDate: new Date(Date.UTC(1995, 0, 9)) };
  return wb;
}
const sheetExpect = { includes: ['Floppy disks', 'Ribbon cartridges'] };
const sheets = [
  ['sheets/inventory-biff8.xls', 'biff8', 'xls-biff8'],
  ['sheets/inventory-biff5.xls', 'biff5', 'xls-biff5'],
  ['sheets/inventory-biff2.xls', 'biff2', 'xls-biff2'],
  ['sheets/inventory.slk', 'sylk', 'sylk'],
  ['sheets/inventory.dif', 'dif', 'dif'],
  ['sheets/inventory-2003.xml', 'xlml', 'spreadsheetml-2003'],
];
for (const [rel, bookType, format] of sheets) {
  const data = XLSX.write(workbook(inventory, 'Stationery', 'Stationery inventory'), { type: 'buffer', bookType });
  write(rel, new Uint8Array(data), { format, ...sheetExpect });
}
const dbfRows = [
  ['CODE', 'NAME', 'CITY'],
  ['C001', 'Harbour Books', 'Portsmouth'],
  ['C002', 'Lantern Supplies', 'Leeds'],
  ['C003', 'Northwind Paper', 'York'],
];
write('sheets/clients.dbf', new Uint8Array(XLSX.write(workbook(dbfRows, 'Sheet1'), { type: 'buffer', bookType: 'dbf' })), {
  format: 'dbf', includes: ['Lantern Supplies', 'Northwind Paper'],
});
// Hand-built dBASE III file whose text is Shift_JIS (language driver 0x13 = code page 932).
function dbfShiftJis(fields, records) {
  const sjis = (s) => Encoding.convert(Encoding.stringToCode(s), { to: 'SJIS', from: 'UNICODE' });
  const headerSize = 32 + 32 * fields.length + 1;
  const recordSize = 1 + fields.reduce((sum, [, len]) => sum + len, 0);
  const bytes = [0x03, 95, 6, 1, ...u32(records.length), ...u16(headerSize), ...u16(recordSize), ...new Array(17).fill(0), 0x13, 0, 0];
  for (const [name, len] of fields) {
    const nameBytes = Array.from(latin1(name)).concat(new Array(11 - name.length).fill(0));
    bytes.push(...nameBytes, 0x43 /* C */, 0, 0, 0, 0, len, 0, ...new Array(14).fill(0));
  }
  bytes.push(0x0d);
  for (const record of records) {
    bytes.push(0x20);
    fields.forEach(([, len], k) => {
      const value = sjis(record[k]);
      bytes.push(...value, ...new Array(len - value.length).fill(0x20));
    });
  }
  bytes.push(0x1a);
  return Uint8Array.from(bytes);
}
write(
  'sheets/suppliers-shift_jis.dbf',
  dbfShiftJis([['NAME', 20], ['CITY', 10]], [['山田商店', '東京'], ['青葉書房', '仙台'], ['みなと文具', '横浜']]),
  { format: 'dbf', includes: ['青葉書房', 'みなと文具', '横浜'] },
);

const jaRows = [['品名', '数量', '単価'], ['鉛筆', 24, 30], ['消しゴム', 10, 50], ['ノート', 12, 120]];
write('sheets/stock-japanese-biff8.xls', new Uint8Array(XLSX.write(workbook(jaRows, '在庫'), { type: 'buffer', bookType: 'biff8' })), {
  format: 'xls-biff8', includes: ['消しゴム', 'ノート'],
});

// ---------------------------------------------------------------------------
// 3. RTF (hand-written)
// ---------------------------------------------------------------------------
// A 1×1 transparent PNG (self-made; 67 bytes).
const tinyPng = Uint8Array.from(Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000' + '1f15c4890000000d49444154789c6360000002000005000172d8b02d0000000049454e44ae426082', 'hex'));
const hexOf = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
const minutesRtf =
  '{\\rtf1\\ansi\\ansicpg1252\\deff0' +
  '{\\fonttbl{\\f0\\froman\\fcharset0 Times New Roman;}{\\f1\\fswiss\\fcharset0 Arial;}{\\f2\\fnil\\fcharset2 Symbol;}}' +
  '{\\stylesheet{\\s0 Normal;}{\\s1\\outlinelevel0 heading 1;}{\\s2\\outlinelevel1 heading 2;}}' +
  '{\\info{\\title Garden club minutes}{\\author Reopen sample generator}}' +
  '\\pard\\s1\\outlinelevel0\\f1\\fs32 Garden club minutes\\par' +
  '\\pard\\s0\\f0\\fs24 Meeting held on 14 June 1992 in the village hall. Twelve members attended.\\par' +
  '\\pard\\s2\\outlinelevel1\\f1 Decisions\\par' +
  '\\pard\\s0\\f0{\\pntext\\f2\\\'b7\\tab}The caf\\\'e9 stall will open at the summer fair.\\par' +
  '{\\pntext\\f2\\\'b7\\tab}Seed orders are due by 1 July \\endash  no exceptions.\\par' +
  '\\pard\\s0{\\listtext 1.\\tab}Collect the new watering cans.\\par' +
  '{\\listtext 2.\\tab}Repaint the greenhouse door.\\par' +
  '\\pard\\s0 The treasurer reported a balance of \\u163\\\'a3412.\\par' +
  '{\\*\\shppict{\\pict\\pngblip\\picw1\\pich1 ' + hexOf(tinyPng) + '}}{\\nonshppict{\\pict\\wmetafile8 0102}}\\par' +
  '\\pard\\s0 Next meeting: 12 July 1992.\\par}';
write('docs/garden-club-minutes.rtf', latin1(minutesRtf), {
  format: 'rtf',
  title: 'Garden club minutes',
  includes: ['Meeting held on 14 June 1992', 'The café stall will open', 'Repaint the greenhouse door', '£412'],
  headings: ['Garden club minutes', 'Decisions'],
  listItems: 4,
  pictures: 1,
});

const sjisEscape = (text) =>
  // Like Word: lead bytes as \'hh, printable ASCII trail bytes literally (escaping \ { }).
  Array.from(Encoding.convert(Encoding.stringToCode(text), { to: 'SJIS', from: 'UNICODE' }), (b) =>
    b >= 0x80 ? `\\'${b.toString(16)}` : b === 0x5c || b === 0x7b || b === 0x7d ? `\\${String.fromCharCode(b)}` : String.fromCharCode(b),
  ).join('');
const jaRtf =
  '{\\rtf1\\ansi\\ansicpg932\\deff0{\\fonttbl{\\f0\\fnil\\fcharset128 MS Mincho;}}' +
  '\\pard\\outlinelevel0\\f0 ' + sjisEscape('研修のお知らせ') + '\\par' +
  '\\pard ' + sjisEscape('来月から新しい研修が始まります。') + '\\par' +
  '\\pard ' + sjisEscape('参加を希望する方は総務課まで連絡してください。') + '\\par}';
write('docs/training-notice-japanese.rtf', latin1(jaRtf), {
  format: 'rtf', includes: ['来月から新しい研修が始まります', '総務課'], headings: ['研修のお知らせ'],
});

// ---------------------------------------------------------------------------
// 4. Word 97 .doc (own minimal writer following the public [MS-DOC] layout)
// ---------------------------------------------------------------------------
function word97(text, { unicode = false } = {}) {
  const TEXT_OFFSET = 0x800;
  const fib = new Uint8Array(TEXT_OFFSET);
  const view = new DataView(fib.buffer);
  view.setUint16(0x00, 0xa5ec, true); // wIdent
  view.setUint16(0x02, 0x00c1, true); // nFib (Word 97)
  view.setUint16(0x06, 0x0409, true); // lid
  view.setUint16(0x0a, 0x0200, true); // flags: fWhichTblStm = 1 (1Table)
  view.setUint16(0x0c, 0x00bf, true); // nFibBack
  view.setUint16(0x20, 14, true); // csw
  view.setUint16(0x3e, 22, true); // cslw
  const rgLw = 0x40;
  view.setUint32(rgLw + 3 * 4, text.length, true); // ccpText
  view.setUint16(0x98, 0x5d, true); // cbRgFcLcb (93 pairs)
  const rgFcLcb = 0x9a;
  const textBytes = unicode ? Uint8Array.from(Array.from(text).flatMap((c) => u16(c.charCodeAt(0)))) : latin1(text);
  const fcRaw = unicode ? TEXT_OFFSET : (0x40000000 | (TEXT_OFFSET * 2)) >>> 0;
  // CLX: one Prc (to exercise skipping) + Pcdt with a single piece
  const plcPcd = [...u32(0), ...u32(text.length), ...u16(0), ...u32(fcRaw), ...u16(0)];
  const clx = Uint8Array.from([0x01, ...u16(2), 0x00, 0x00, 0x02, ...u32(plcPcd.length), ...plcPcd]);
  view.setUint32(rgFcLcb + 66 * 4, 0, true); // fcClx
  view.setUint32(rgFcLcb + 67 * 4, clx.length, true); // lcbClx
  const wordDocument = new Uint8Array(TEXT_OFFSET + textBytes.length);
  wordDocument.set(fib, 0);
  wordDocument.set(textBytes, TEXT_OFFSET);
  new DataView(wordDocument.buffer).setUint32(rgLw, wordDocument.length, true); // cbMac
  const container = CFB.utils.cfb_new();
  CFB.utils.cfb_add(container, '/WordDocument', Buffer.from(wordDocument));
  CFB.utils.cfb_add(container, '/1Table', Buffer.from(clx));
  return new Uint8Array(CFB.write(container, { type: 'buffer' }));
}
const docText =
  'Quarterly report\r' +
  'Sales rose in the second quarter, led by the stationery catalogue.\r' +
  'The new branch office opens on 2 May 1997.\r' +
  'See \u0013 HYPERLINK "http://example.invalid" \u0014our price list\u0015 for details.\r';
write('docs/quarterly-report-word97.doc', word97(docText), {
  format: 'word-97-doc', includes: ['Sales rose in the second quarter', 'See our price list for details'], excludes: ['HYPERLINK'],
});
const docJa = '議事録\r次回の会議は四月十日に行います。\r資料は事前に配布します。\r';
write('docs/minutes-japanese-word97.doc', word97(docJa, { unicode: true }), {
  format: 'word-97-doc', includes: ['次回の会議は四月十日に行います', '資料は事前に配布します'],
});

// ---------------------------------------------------------------------------
// 5. Microsoft Write (.wri) — header layout as publicly described (text from byte 128 to fcMac)
// ---------------------------------------------------------------------------
const writeText =
  'Tenants’ association notice\r\n' +
  'The annual meeting is on Thursday 14 April 1983 at 7 pm.\r\n' +
  'Please bring suggestions for the spring clean-up.\r\n';
const writeBody = latin1(writeText);
const fcMac = 128 + writeBody.length;
const pnPara = Math.ceil(fcMac / 128);
const writeFile = new Uint8Array((pnPara + 1) * 128);
const writeView = new DataView(writeFile.buffer);
writeView.setUint16(0, 0xbe31, true); // wIdent
writeView.setUint16(2, 0, true); // dty
writeView.setUint16(4, 0xab00, true); // wTool
writeView.setUint32(14, fcMac, true); // fcMac
for (let k = 18; k <= 28; k += 2) writeView.setUint16(k, pnPara, true); // pnPara … pnFfntb
writeView.setUint16(96, pnPara + 1, true); // pnMac
writeFile.set(writeBody, 128);
write('docs/tenants-notice.wri', writeFile, {
  format: 'write-wri', includes: ['The annual meeting is on Thursday 14 April 1983', 'spring clean-up'],
});

// ---------------------------------------------------------------------------
// 6. WordPerfect-style document (self-made from the public function-code layout)
// ---------------------------------------------------------------------------
const wp = [
  0xff, 0x57, 0x50, 0x43, ...u32(16), 0x01, 0x0a, 0x00, 0x01, ...u16(0), ...u16(0),
  ...latin1('PROJECT STATUS NOTE'), 0x0a, 0x0a,
  0xc3, 0x0c, 0xc3, ...latin1('Budget'), 0xc4, 0x0c, 0xc4, ...latin1(' remains within the approved limits.'), 0x0d,
  ...latin1('The survey team'), 0xa0, ...latin1('finished early.'), 0x0a,
  0xd0, 0x04, ...u16(6), 0x11, 0x22, ...u16(6), 0x04, 0xd0,
  ...latin1('Next review in June 1991'), 0xc0, 0x17, 0x01, 0xc0, ...latin1('.'), 0x0a,
];
write('docs/project-status.wpd', Uint8Array.from(wp), {
  format: 'wordperfect', includes: ['PROJECT STATUS NOTE', 'Budget remains within the approved limits', 'Next review in June 1991'],
});

// ---------------------------------------------------------------------------
// 7. A small BMP (Windows bitmap) image
// ---------------------------------------------------------------------------
function bmp(width, height) {
  const rowBytes = Math.ceil((width * 3) / 4) * 4;
  const size = 54 + rowBytes * height;
  const bytes = new Uint8Array(size);
  const v = new DataView(bytes.buffer);
  bytes.set([0x42, 0x4d]);
  v.setUint32(2, size, true);
  v.setUint32(10, 54, true);
  v.setUint32(14, 40, true);
  v.setInt32(18, width, true);
  v.setInt32(22, height, true);
  v.setUint16(26, 1, true);
  v.setUint16(28, 24, true);
  v.setUint32(34, rowBytes * height, true);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const o = 54 + y * rowBytes + x * 3;
      const on = (x + y) % 4 < 2;
      bytes.set(on ? [0x2a, 0x6b, 0x1f] : [0xec, 0xf3, 0xf7], o); // BGR
    }
  return bytes;
}
write('images/pattern.bmp', bmp(16, 16), { format: 'bmp-image' });

// ---------------------------------------------------------------------------
// 8. Mystery format: Quillstone Notebook (.QNB) — see docs/specs/quillstone-notebook-qnb.md
// ---------------------------------------------------------------------------
function qnb(title, date, records) {
  const scramble = (s) => Array.from(latin1(s), (b) => b ^ 0x5a);
  const t = scramble(title);
  if (t.length > 19) throw new Error('title too long');
  const header = [0x51, 0x4e, 0x42, 0x31, ...u16(3), ...u16(records.length), ...u16(date[0]), date[1], date[2], t.length, ...t, ...new Array(19 - t.length).fill(0)];
  const body = records.flatMap(([type, text]) => {
    const s = scramble(text);
    return [type, ...u16(s.length), ...s];
  });
  return Uint8Array.from([...header, ...body]);
}
const notebooks = [
  ['mystery/garden-plan.qnb', 'Garden', [1989, 4, 15], [[1, 'Spring planting'], [2, 'Sow the beans along the south fence after the last frost.'], [3, 'Runner beans'], [3, 'Sweet peas'], [2, 'Water every second evening in dry weather.']]],
  ['mystery/recipe-notes.qnb', 'Recipes', [1990, 11, 2], [[1, 'Apple crumble'], [2, 'Rub the butter into the flour until it looks like breadcrumbs.'], [3, 'Four cooking apples'], [2, 'Bake for forty minutes until golden.']]],
  ['mystery/club-minutes.qnb', 'Chess club', [1991, 2, 20], [[1, 'February meeting'], [2, 'The club will enter two teams in the spring league.'], [2, 'Subscriptions stay the same this year.']]],
];
for (const [rel, title, date, records] of notebooks) {
  write(rel, qnb(title, date, records), {
    format: 'unknown',
    mystery: 'quillstone-notebook-qnb',
    title,
    includes: records.map(([, text]) => text),
  });
}

// ---------------------------------------------------------------------------
// 9. "Old folder": 8.3 names, misleading extensions, nested directory — and a zip of it
// ---------------------------------------------------------------------------
const folder = [
  ['text/memo-shift_jis.txt', 'MEMO1.TXT'],
  ['text/notice-euc-jp.txt', 'NOTICE.TXT'],
  ['text/letter-cp1252.txt', 'LETTER.TXT'],
  ['text/ledger-ebcdic-cp037.txt', 'LEDGER.DAT'],
  ['sheets/inventory-biff8.xls', 'BUDGET.XLS'],
  ['sheets/inventory-biff5.xls', 'STOCK.DAT'],
  ['sheets/inventory.slk', 'INVENT.SLK'],
  ['sheets/inventory.dif', 'PRICES.DIF'],
  ['sheets/clients.dbf', 'CLIENTS.DBF'],
  ['docs/garden-club-minutes.rtf', 'MINUTES.RTF'],
  ['docs/quarterly-report-word97.doc', 'REPORT.DOC'],
  ['docs/tenants-notice.wri', 'TENANTS.WRI'],
  ['docs/project-status.wpd', 'STATUS.DOC'],
  ['images/pattern.bmp', 'PAINT.BMP'],
  ['mystery/garden-plan.qnb', 'NOTEBOOK/GARDEN.QNB'],
];
const zipTree = {};
for (const [from, to] of folder) {
  const target = join(out, 'old-folder', to);
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(join(out, from), target);
  const entry = manifest.find((m) => m.path === from);
  manifest.push({ ...entry, path: `old-folder/${to}`, copyOf: from });
  zipTree[`OLDPC/${to}`] = [new Uint8Array(require('node:fs').readFileSync(target)), { mtime: new Date(Date.UTC(1999, 11, 31, 12)) }];
}
writeFileSync(join(out, 'old-folder.zip'), zipSync(zipTree, { level: 6 }));

writeFileSync(join(out, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`wrote ${manifest.length} samples (+ old-folder.zip) to ${out}`);
