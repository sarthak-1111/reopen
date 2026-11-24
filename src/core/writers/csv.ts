/** RFC 4180 CSV. Fields containing a comma, quote or line break are quoted. */
export function rowsToCsv(rows: readonly (readonly string[])[]): string {
  return rows
    .map((row) => row.map((field) => (/[",\r\n]/.test(field) ? `"${field.replace(/"/g, '""')}"` : field)).join(','))
    .join('\r\n');
}

/** UTF-8 bytes with a byte order mark, so older spreadsheet programs detect the encoding. */
export function csvBytes(csv: string): Uint8Array {
  const body = new TextEncoder().encode(csv);
  const out = new Uint8Array(body.length + 3);
  out.set([0xef, 0xbb, 0xbf], 0);
  out.set(body, 3);
  return out;
}
