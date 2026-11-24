# Deterministic core: status

The deterministic core (`src/core/`) turns the bytes of one file into modern outputs with no
network, no AI and no DOM. Everything here runs on the user's device. This page records what
is built, what has been verified and how, and what has **not** been verified.

Status as of 2026-11-24. Verified with `npm test` (186 tests, all passing; three repeated runs,
all passing) and `npm run build` (passing).

## Modules

| Path | Role |
|---|---|
| `src/core/detect.ts` | Format detection **by structure** (magic numbers, OLE stream names, record headers, size arithmetic). The file extension is only recorded as agreeing or disagreeing. Never throws. |
| `src/core/encoding.ts` | Encoding detection (BOM → ISO-2022-JP → strict UTF-8 → UTF-16 → candidate votes from encoding-japanese, chardet, jschardet and own EBCDIC statistics → decode every candidate and score how plausible the text is). EBCDIC encode/decode. |
| `src/core/ebcdic-tables.ts` | Generated from the SheetJS `codepage` package by `tools/gen-ebcdic-tables.mjs`. |
| `src/core/readers/spreadsheet.ts` | SheetJS: every legacy sheet format it reads → CSV per sheet + `.xlsx`. Code page tables are always loaded (lazily, once) because without them legacy text decodes as mojibake *silently*. |
| `src/core/readers/rtf.ts` | Own pure RTF parser: code pages per font charset, `\uN`/`\ucN`, double-byte `\'hh` + literal trail bytes, headings (outline level or style name), lists, field results, embedded pictures. |
| `src/core/readers/word97.ts` | Word 97–2003 text via FIB → CLX → piece table, written from Microsoft's public [MS-DOC] specification. Detects encryption. |
| `src/core/readers/text-recovery.ts` | Best-effort recovery: cp1252, Shift_JIS, UTF-16LE (split by script, rare-kanji noise rejected) and EBCDIC runs with byte offsets; per-stream for OLE files; WordPerfect function-code walk; Microsoft Write text area. |
| `src/core/readers/text.ts`, `readers/bmp.ts` | Legacy-encoded text; BMP/DIB decoding (1/4/8/24/32-bit, uncompressed). |
| `src/core/writers/` | Markdown, DOCX (docx library, `Packer.toBlob`), CSV (RFC 4180, CRLF, UTF-8 BOM), PNG (own encoder over fflate). |
| `src/core/naming.ts` | Deterministic names: title → first meaningful line → original name, plus an ISO date when one is found; Windows/macOS-safe; ` (2)` de-duplication. |
| `src/core/no-invention.ts` | The no-invention rule (see below). |
| `src/core/catalogue.ts` | Self-contained `index.html` catalogue (no scripts, everything escaped) and `RESCUE_REPORT.md`. |
| `src/core/package.ts` | Deterministic zip output (fixed timestamps); zip input with zip-slip, entry-count and size limits. |
| `src/core/rescue.ts` | `rescueFile(path, bytes, options)`: detect → read → write → name. Never throws; reader failures fall back to text recovery. Takes an optional `rasterise` hook so the browser can convert WMF/EMF. |
| `src/core/index.ts` | Public API. |

## What works end to end (on the samples)

"End to end" = `rescueFile` on the sample bytes produces outputs that contain the expected
text (checked in Markdown/TXT/CSV, inside the DOCX XML and by re-reading the XLSX).

| Format | Level | Outputs | Verified on |
|---|---|---|---|
| Text: Shift_JIS, EUC-JP, Windows-1252, EBCDIC 037 | full | .txt, .md | self-made samples + generated texts (below) |
| Excel BIFF8, BIFF5, BIFF2; SYLK; DIF; SpreadsheetML 2003; dBASE (incl. Shift_JIS DBF) | full (values; no formatting) | .xlsx, .csv | SheetJS-written samples + one hand-built Shift_JIS DBF |
| RTF (Latin and code page 932) | text and paragraphs (headings, lists, pictures; no fonts/bold/tables) | .docx, .md, .png for PNG/JPEG pictures | hand-written samples |
| Word 97–2003 (.doc), 8-bit and UTF-16 pieces, field codes | text and paragraphs | .docx, .md | self-made minimal files |
| Microsoft Write (.wri) | text and paragraphs | .docx, .md | one self-made file |
| WordPerfect 5.x-style | text recovery (labelled raw) | .txt, .docx, .md | one self-made file |
| BMP | full | .png | self-made 24-bit file + a 1-bit DIB unit test |
| Unknown binary (e.g. the fictional `.qnb`) | none — "only fragments found", no outputs | — | 3 mystery samples |

Detection is checked on all 38 sample paths, both with their names and with no name at all,
including copies with misleading names (a WordPerfect file called `STATUS.DOC`, a BIFF5
workbook called `STOCK.DAT`, EBCDIC text called `LEDGER.DAT`).

## Encoding detection accuracy (measured)

From `tests/encoding.test.ts`: 60 generated texts per cell, built from self-written sentences.
Correct = the text decoded with the detected encoding equals the original exactly.

| | ≥20 chars | ≥60 chars | ≥200 chars | ≥1000 chars |
|---|---|---|---|---|
| Shift_JIS | 100% | 100% | 100% | 100% |
| EUC-JP | 100% | 100% | 100% | 100% |
| Windows-1252 | 92% (5 read as Shift_JIS) | 100% | 100% | 100% |
| EBCDIC 37, 20273, 500, 1026, 1047, 1140, 20290 | 100% | 100% | 100% | 100% |

The test asserts ≥95% for texts of 60 characters or more. Caveats:

- The EBCDIC texts are plain English, which decodes identically in all the tested EBCDIC
  pages, so this measures *recognising EBCDIC*, not *telling EBCDIC pages apart*. Choosing
  the right page for accented letters is not tested.
- EBCDIC 875 (Greek) is excluded from the accuracy test (its Latin letters differ).
- Generated texts are cleaner than real files. Real-world accuracy has not been measured.

Exact round-trips with a known encoding are property-tested for Shift_JIS, EUC-JP,
Windows-1252 and every byte of all eight EBCDIC tables.

## The no-invention rule

`checkNoInvention(source, output)`: both texts are NFKC-normalised and case-folded; tokens are
runs of letters/digits, and every kanji/kana is its own token. The output may not contain any
token **more times** than the source does (multiset), so AI may reorder, drop, re-case and
re-punctuate but never add or repeat words. Rejoining a word split by a line-end hyphen is
allowed. `enforceNoInvention` returns the raw source labelled `raw-fallback` when the check
fails. Property tests: every reorder/drop/re-case/re-punctuate edit passes; every added word
and every extra repetition fails; the fallback always passes. The property test found one real
bug during development (`großen` vs `GROSSEN`), fixed by full case folding.

## Browser safety

- `src/core` imports no Node built-ins and does not use `Buffer`.
- Checked by bundling `src/core/index.ts` with Vite (library mode, es2022): no warnings about
  Node modules; the SheetJS code page tables become a separate lazily loaded chunk (462 KB);
  the main bundle is 2.56 MB unminified.
- That bundle was run in Node 20 with `globalThis.Buffer` set to `undefined`: 38/38 samples
  rescued as expected, and the sample zip unpacked.
- **Not yet verified in a real browser.** `npm run build` currently bundles only the smoke page;
  the core is not wired into the app yet.

## Decisions

- **Own RTF parser instead of rtf.js for text.** rtf.js renders to the DOM, so it cannot run in
  tests or a worker. rtf.js stays a dependency for the UI layer, to rasterise WMF/EMF pictures
  through the `rasterise` hook.
- **BMP → PNG in the core** (own decoder + encoder), so it is testable without a canvas.
  WMF/EMF still need the browser: without a `rasterise` hook they are reported as a warning.
- **Fragments are not a document.** If recovery finds fewer than 16 letters, the result is level
  `none` with no outputs, rather than presenting a magic number like `QNB1` as recovered text.

## Not verified / known limits

- **No real files from the original programs were tested.** The Word 97, Write and WordPerfect
  samples are minimal files we wrote from public format descriptions. Real files carry more
  structure (fast-saved documents, headers/footers/footnotes after the main text, embedded
  objects) that has not been exercised.
- Word 6/95 and older `.doc` files are detected but not parsed; they fall back to text recovery.
  Encrypted Word files are reported as encrypted, with no output.
- WordPerfect: the function-code walk follows the public layout but has only been checked on one
  self-made file. Extended characters (`0xC0` codes) are left out and counted in a warning.
- Lotus 1-2-3 (WKS/WK1/WK3/WK4/123), Quattro Pro, Works and Ichitaro: **detection code only, no
  samples**. Ichitaro detection is a heuristic (confidence 0.5). Whether SheetJS reads real Lotus
  or Quattro files has not been tested here.
- Spreadsheet samples are written by SheetJS itself, which also reads them.
- RTF tables are flattened (cells → tabs); fonts, bold/italic and colours are not carried over.
- Short Windows-1252 texts (under ~60 characters) are sometimes read as Shift_JIS.
- Text recovery is heuristic: run order follows byte order, which may not be reading order.
