import type { ReaderPlugin } from '../../src/research/plugin-schema';

/** A hand-written, correct reader for the self-made QNB spec (docs/specs/quillstone-notebook-qnb.md). */
export const QNB_PLUGIN: ReaderPlugin = {
  formatName: 'Quillstone Notebook',
  formatVersion: '3',
  endianness: 'little',
  magic: { offset: 0, ascii: 'QNB1', hex: null },
  defaultEncoding: 'windows-1252',
  headerLength: 32,
  header: [
    { name: 'magic', offset: 0, type: 'text', length: 4 },
    { name: 'version', offset: 4, type: 'u16' },
    { name: 'recordCount', offset: 6, type: 'u16' },
    { name: 'year', offset: 8, type: 'u16' },
    { name: 'month', offset: 10, type: 'u8' },
    { name: 'day', offset: 11, type: 'u8' },
    { name: 'titleLength', offset: 12, type: 'u8' },
    { name: 'title', offset: 13, type: 'text', lengthFrom: 'titleLength', xor: 0x5a },
  ],
  body: {
    kind: 'records',
    startOffset: null,
    countFrom: 'recordCount',
    until: 'end-of-file',
    recordFields: [
      { name: 'type', type: 'u8' },
      { name: 'length', type: 'u16' },
      { name: 'text', type: 'text', lengthFrom: 'length', xor: 0x5a },
    ],
    kindField: 'type',
    kindMap: [
      { value: 1, kind: 'heading' },
      { value: 2, kind: 'paragraph' },
      { value: 3, kind: 'list-item' },
    ],
    textField: 'text',
  },
  titleField: 'title',
  dateFields: { year: 'year', month: 'month', day: 'day' },
  notes: null,
};

export const clonePlugin = (): ReaderPlugin => JSON.parse(JSON.stringify(QNB_PLUGIN)) as ReaderPlugin;
