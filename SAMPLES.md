# Sample files

Every file in `samples/` is **self-made** by `tools/make-samples.mjs` (run `npm run samples`).
All text in them is fictional and was written for this project; no real documents, real
people or personal data are included. The samples, the generator and the mystery-format
specification are licensed under **Apache-2.0**, like the rest of the repository.

`samples/manifest.json` records, for each file, the format it must be detected as and text
that must appear in the rescued output. The test suite (`tests/samples.test.ts`) checks every
entry.

## How each sample is made

| Sample | Format | Made with |
|---|---|---|
| `text/memo-shift_jis.txt` | Japanese text, Shift_JIS | encoding-japanese (encoder) |
| `text/notice-euc-jp.txt` | Japanese text, EUC-JP | encoding-japanese (encoder) |
| `text/letter-cp1252.txt` | French letter, Windows-1252 | codepage (encoder) |
| `text/ledger-ebcdic-cp037.txt` | English report, EBCDIC code page 037, NEL line ends | codepage (encoder) |
| `sheets/inventory-biff8.xls` | Excel 97–2003 (BIFF8) | SheetJS writer |
| `sheets/inventory-biff5.xls` | Excel 5.0/95 (BIFF5) | SheetJS writer |
| `sheets/inventory-biff2.xls` | Excel 2.x (BIFF2) | SheetJS writer |
| `sheets/inventory.slk` | SYLK | SheetJS writer |
| `sheets/inventory.dif` | DIF | SheetJS writer |
| `sheets/inventory-2003.xml` | Excel 2003 XML (SpreadsheetML) | SheetJS writer |
| `sheets/clients.dbf` | dBASE III | SheetJS writer |
| `sheets/suppliers-shift_jis.dbf` | dBASE III, Shift_JIS text (language driver 0x13) | hand-built bytes in the generator |
| `sheets/stock-japanese-biff8.xls` | Excel 97–2003 with Japanese text | SheetJS writer |
| `docs/garden-club-minutes.rtf` | RTF: headings, bullet and numbered lists, `\u` escapes, an embedded PNG | hand-written RTF |
| `docs/training-notice-japanese.rtf` | RTF, code page 932 (Shift_JIS `\'hh` escapes) | hand-written RTF |
| `docs/quarterly-report-word97.doc` | Word 97 binary: FIB + piece table, 8-bit text, a HYPERLINK field | own minimal writer following [MS-DOC], packed with cfb |
| `docs/minutes-japanese-word97.doc` | Word 97 binary, UTF-16 text piece | same |
| `docs/tenants-notice.wri` | Microsoft Write 3.x layout | hand-built bytes |
| `docs/project-status.wpd` | WordPerfect 5.x-style document with function codes | hand-built bytes |
| `images/pattern.bmp` | 24-bit Windows bitmap | hand-built bytes |
| `mystery/*.qnb` | "Quillstone Notebook", a **fictional** format | hand-built bytes following `docs/specs/quillstone-notebook-qnb.md` |
| `old-folder/…` | Copies of the files above with 8.3 names and misleading extensions (e.g. a WordPerfect file named `STATUS.DOC`, a BIFF5 workbook named `STOCK.DAT`) | copied by the generator |
| `old-folder.zip` | The `old-folder` tree as a zip (for the zip fallback) | fflate |

## Honest limits of these samples

- The Word 97, Write and WordPerfect samples are **minimal files written by us** from public
  descriptions of those formats. They exercise the readers, but they are not files saved by
  the original programs. Real files have more structure (formatting tables, fast-saved
  piece tables, embedded objects) that these samples do not cover.
- The spreadsheet samples are written by SheetJS, the same library that reads them, so they
  test Reopen's detection and conversion pipeline rather than SheetJS's compatibility with
  files from the original programs.
- Lotus 1-2-3 (WKS/WK1/WK3), Quattro Pro, Works and Ichitaro files are detected by structure
  in the code, but there are **no samples** for them (no permissive way to create them here).
- The "Quillstone Notebook" format does not exist. It is the demo's mystery format: Reopen
  cannot read it without a format plugin, and its specification in `docs/specs/` is the kind
  of public documentation the format researcher works from.
