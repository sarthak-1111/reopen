/** Formats Reopen can recognise from file structure (never from the extension alone). */
export type FormatId =
  // Spreadsheets
  | 'xls-biff2'
  | 'xls-biff3'
  | 'xls-biff4'
  | 'xls-biff5'
  | 'xls-biff8'
  | 'spreadsheetml-2003'
  | 'sylk'
  | 'dif'
  | 'lotus-wks'
  | 'lotus-wk1'
  | 'lotus-wk3'
  | 'lotus-wk4'
  | 'lotus-123'
  | 'quattro'
  | 'works-sheet'
  | 'dbf'
  // Documents
  | 'rtf'
  | 'word-97-doc'
  | 'word-legacy-doc'
  | 'wordperfect'
  | 'works-wps'
  | 'write-wri'
  | 'ichitaro'
  // Containers and modern formats (passed through)
  | 'ole-unknown'
  | 'zip'
  | 'ooxml'
  | 'opendocument'
  // Images
  | 'bmp-image'
  // Text
  | 'text'
  | 'ebcdic-text'
  | 'unknown';

export type FormatFamily = 'spreadsheet' | 'document' | 'text' | 'image' | 'container' | 'unknown';

export interface Detection {
  format: FormatId;
  family: FormatFamily;
  /** Human-readable reasons for the decision, in the order they were checked. */
  evidence: string[];
  /** 0..1, how sure the structural check is. */
  confidence: number;
  /** Stream names when the file is an OLE compound file. */
  oleStreams?: string[];
  /** Display name when the format was identified outside the built-in detector (a researched reader). */
  label?: string;
}

export interface EncodingCandidate {
  encoding: string;
  confidence: number;
  source: string;
}

export interface EncodingDetection {
  /** WHATWG label (e.g. "shift_jis", "windows-1252") or "ebcdic-<cp>". */
  encoding: string;
  confidence: number;
  candidates: EncodingCandidate[];
  /** Which checks decided it. */
  method: string[];
}

/** A piece of text found inside a binary file, before any reconstruction. */
export interface TextRun {
  offset: number;
  byteLength: number;
  encoding: string;
  text: string;
}

export type Block =
  | { type: 'heading'; level: 1 | 2 | 3 | 4 | 5 | 6; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'list-item'; text: string; ordered: boolean };

export interface EmbeddedPicture {
  kind: 'wmf' | 'emf' | 'png' | 'jpeg' | 'bmp' | 'unknown';
  bytes: Uint8Array;
  /** Converting WMF/EMF/BMP to PNG happens in the browser UI layer (canvas). */
  needsRasterising: boolean;
}

export interface OutputFile {
  name: string;
  mime: string;
  bytes: Uint8Array;
}

export type ConversionLevel = 'full' | 'text-and-paragraphs' | 'text-recovery' | 'none';

export interface RescueResult {
  source: { path: string; size: number };
  detected: Detection;
  encoding?: EncodingDetection;
  /** Proposed human-friendly base name (no extension). */
  proposedName: string;
  outputs: OutputFile[];
  /** Raw recovered text (text-recovery formats), kept for later on-device reconstruction. */
  recoveredText?: string;
  textRuns?: TextRun[];
  structure?: Block[];
  pictures?: EmbeddedPicture[];
  sheets?: { name: string; rows: number; cols: number }[];
  warnings: string[];
  conversionLevel: ConversionLevel;
}
