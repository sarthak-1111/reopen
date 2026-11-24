import * as XLSX from 'xlsx';

export interface SheetSummary {
  name: string;
  rows: number;
  cols: number;
  csv: string;
}

export interface SpreadsheetResult {
  sheets: SheetSummary[];
  /** The workbook re-saved as a modern .xlsx file. */
  xlsx: Uint8Array;
  /** Document title from the workbook's properties, when it has one. */
  title?: string;
  warnings: string[];
}

let codepagesLoaded: Promise<void> | undefined;

/**
 * Legacy workbooks store text in the code page they were saved with (e.g. Shift_JIS in a
 * Japanese DBF or BIFF5 file). Without SheetJS's code page tables those strings decode as
 * mojibake *silently*, so the tables are always loaded (lazily, once) before parsing.
 */
function loadCodepages(): Promise<void> {
  codepagesLoaded ??= import('xlsx/dist/cpexcel.full.mjs').then((tables) => {
    // The module's namespace exposes `utils.decode`, which is all SheetJS needs.
    XLSX.set_cptable(tables);
  });
  return codepagesLoaded;
}

/** Reads any spreadsheet format SheetJS supports and returns CSV per sheet plus an .xlsx copy. */
export async function readSpreadsheet(bytes: Uint8Array): Promise<SpreadsheetResult> {
  const warnings: string[] = [];
  await loadCodepages();
  const workbook = XLSX.read(bytes, { type: 'array', cellDates: true, cellNF: false, cellStyles: false });

  const sheets: SheetSummary[] = [];
  for (const name of workbook.SheetNames) {
    const sheet = workbook.Sheets[name];
    if (!sheet) continue;
    const ref = sheet['!ref'];
    const range = ref ? XLSX.utils.decode_range(ref) : undefined;
    const rows = range ? range.e.r - range.s.r + 1 : 0;
    const cols = range ? range.e.c - range.s.c + 1 : 0;
    const fullRef = (sheet as Record<string, unknown>)['!fullref'];
    if (typeof fullRef === 'string' && ref && fullRef !== ref) {
      warnings.push(`Sheet "${name}" was truncated by the reader (${ref} of ${fullRef}).`);
    }
    sheets.push({ name, rows, cols, csv: XLSX.utils.sheet_to_csv(sheet, { blankrows: false }) });
  }
  if (sheets.length === 0) warnings.push('The workbook contains no readable sheets.');

  const xlsx = XLSX.write(workbook, { type: 'array', bookType: 'xlsx', compression: true }) as ArrayBuffer;
  const title = workbook.Props?.Title?.trim();
  return { sheets, xlsx: new Uint8Array(xlsx), ...(title ? { title } : {}), warnings };
}
