/** Windows code page number -> WHATWG encoding label (for TextDecoder). */
const CODEPAGE_LABELS: Record<number, string> = {
  437: 'windows-1252', // closest WHATWG option; box-drawing characters will differ
  850: 'windows-1252',
  874: 'windows-874',
  932: 'shift_jis',
  936: 'gbk',
  949: 'euc-kr',
  950: 'big5',
  1250: 'windows-1250',
  1251: 'windows-1251',
  1252: 'windows-1252',
  1253: 'windows-1253',
  1254: 'windows-1254',
  1255: 'windows-1255',
  1256: 'windows-1256',
  1257: 'windows-1257',
  1258: 'windows-1258',
  10000: 'macintosh',
  20932: 'euc-jp',
  51932: 'euc-jp',
  65001: 'utf-8',
};

/** RTF \fcharset value -> Windows code page. */
const CHARSET_CODEPAGES: Record<number, number> = {
  0: 1252,
  77: 10000,
  128: 932,
  129: 949,
  134: 936,
  136: 950,
  161: 1253,
  162: 1254,
  163: 1258,
  177: 1255,
  178: 1256,
  186: 1257,
  204: 1251,
  222: 874,
  238: 1250,
};

export function labelForCodepage(codepage: number): string {
  return CODEPAGE_LABELS[codepage] ?? 'windows-1252';
}

export function codepageForCharset(charset: number): number | undefined {
  return CHARSET_CODEPAGES[charset];
}

export function decodeWithCodepage(bytes: Uint8Array, codepage: number): string {
  try {
    return new TextDecoder(labelForCodepage(codepage)).decode(bytes);
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}
