# Format researcher: status

The format researcher is the only part of Reopen that uses the cloud. It is opt-in and limited to public documentation.

1. The user pastes or uploads **public documentation** for an unknown format (.txt, .md, .html or .htm). The file is read as text in the browser.
2. Reopen shows the **exact** text it will send, with its size in bytes. The user must tick "This is public documentation I'm allowed to share" and press Send. Cancel sends nothing.
3. The text goes through the single cloud gate (`src/ai/cloud-gate.ts`), which checks four things in order:
   - the Remote Config lane is on;
   - the browser is online;
   - there is a single-use consent token for this exact payload;
   - the taint check passes (no bytes or text from the user's files).
   The gate then records the request in the Privacy Ledger, and only then calls cloud Gemini.
4. Gemini drafts a **reader plugin**. The plugin is JSON data, never code. Reopen validates it against the schema (ajv) and runs semantic checks.
5. The user picks sample files: unconverted files from this session, or files picked locally. Reopen runs **conformance tests on this computer**. The reader is offered ("Use this reader") only if every check passes.
6. The files are read by Reopen's own interpreter. The results join the library with the CLOUD badge and this note: only the documentation went to the cloud.

AI-written code is never executed. File bytes and contents never reach the gate: the panel has no path that passes them, and the taint registry blocks copies of them.

## Files

| File | Role |
|---|---|
| `src/research/plugin-schema.ts` | `ReaderPlugin` type, `READER_PLUGIN_SCHEMA` (used for Gemini `responseSchema` and ajv), `semanticProblems()` |
| `src/research/interpreter.ts` | `readWithPlugin(plugin, bytes)`: deterministic, bounds-checked, never throws |
| `src/research/conformance.ts` | `runConformance(plugin, samples, { knownText? })` |
| `src/research/researcher.ts` | `createResearcher(gate)`: `prepare`, `draft`, `certify`, `apply`; `parsePlugin()` |
| `src/ui/researcher-panel.ts` | Panel (`mountResearcherPanel`), DOM-free controller (`createResearcherController`), placeholder |
| `src/ui/app.ts` | `AppOptions.researcher`, `AppOptions.onFileLoaded`; unconverted files kept in memory; sample files picked in the panel are also passed to `onFileLoaded` (taint registry); certified results added to the library |

## Plugin schema

Only these JSON Schema keywords are used, because they are understood by both Gemini `responseSchema` and ajv: `type`, `properties`, `required`, `items`, `enum`, `description`, `nullable`, `maxItems`.

```text
ReaderPlugin
  formatName, formatVersion            string
  endianness                           'little' | 'big'
  magic { offset, ascii? | hex? }      signature bytes, e.g. ascii "QNB1" or hex "51 4E 42 31"
  defaultEncoding                      windows-1252 | shift_jis | euc-jp | utf-8 | utf-16le
  headerLength?                        fixed header size; header fields must end inside it
  header: FieldSpec[]                  absolute offsets
  body: BodySpec
  titleField?                          name of a header text field
  dateFields? { year?, month?, day? }  names of numeric header fields
  notes?                               free text from the model (shown, never interpreted)

FieldSpec
  name, type: u8 | u16 | u32 | i16 | i32 | bytes | text
  offset?                              header fields only
  length? | lengthFrom?                for bytes/text; lengthFrom names an EARLIER numeric field
  xor?                                 0-255, applied to every byte before decoding
  encoding?                            overrides defaultEncoding

BodySpec, kind 'records'
  startOffset? (default: end of header), countFrom?, until: 'count' | 'end-of-file'
  recordFields: FieldSpec[]            read one after another
  kindField? + kindMap [{value, kind: heading | paragraph | list-item}]
  textField                            the record's text field

BodySpec, kind 'text-block'
  textOffset? | textOffsetFrom?, textLength? | textLengthFrom?, xor?, encoding?
  (text is split into paragraphs at line breaks)
```

`semanticProblems()` rejects a plugin if any of these hold:
- a reference points at an unknown, later or non-numeric field;
- a field name is duplicated;
- a text or bytes field has no length;
- `until: 'count'` has no `countFrom`;
- `textField` is missing;
- an XOR value is outside 0–255;
- the magic is empty.

## Interpreter limits

- **Never throws.** Every problem comes back in `errors[]`.
- **Strict bounds checks.** Any read that goes past the end of the file, or uses a negative or non-integer offset, sets `outOfBounds`.
- **Hard caps:** 100,000 records, 1,000,000 bytes per field, 10,000,000 characters of text in total.
- **No endless loops.** An empty record with `until: 'end-of-file'` is an error.
- **Decoding** uses `TextDecoder` (non-fatal). Trailing NULs are trimmed.

## Conformance checks (per sample file)

| id | Passes when |
|---|---|
| `magic` | the signature bytes match |
| `parses` | the read finishes with no errors |
| `bounds` | no offset or length leaves the file, and header fields stay inside `headerLength` |
| `consumed` | `end-of-file`: every byte is read and the header record count (if declared) matches. `count`: the declared count matches and no bytes are left over |
| `plausible` | all of these: core `plausibility()` ≥ 0.6; no U+FFFD; letters ≥ 50% of visible characters; control characters ≤ 1% |
| `deterministic` | two reads give identical results |
| `has-text` | at least one non-empty block |
| `known-text` | (optional, once per run) a phrase the user knows is in the files was found |
| `samples` | fails if no sample was chosen |

A reader is certified only if **every** check passes.

## Verified (by tests: `tests/research/*.test.ts`, 27 tests)

- **Self-made QNB samples:** the hand-written QNB plugin (`tests/research/qnb-plugin.ts`) passes every check on all three `samples/mystery/*.qnb` files. It reads the manifest's title, text and dates, and consumes every byte.
- **Wrong plugins fail conformance:**
  - XOR transform missing
  - wrong `titleLength` offset, both with and without `headerLength`
  - wrong endianness
  - record fields in the wrong order
  - wrong magic
  - no samples
- **Never throws:** two fast-check properties, each with 400 runs. One uses random bytes with random plugin-shaped objects (including invalid values); the other uses random bytes after a valid QNB magic. Results never claim bytes beyond the file.
- **Through the real `createCloudGate`, `createLedger`, `createConsentStore` and `createTaintRegistry`, with a fake `cloudGenerate`:**
  - **Valid flow:** exactly one ledger entry. It contains the documentation text and no 16-byte window of any sample (raw or hex), and no decoded sample text. Certify and apply add no further cloud calls.
  - **Consent:** the consent token is single-use. Consent for different text does not cover an edited payload. A missing token sends nothing and leaves the ledger empty.
  - **Lane disabled / offline:** blocked. The model factory is never called and the ledger stays empty.
  - **Copied file data:** documentation containing a 64-byte sample slice as hex, or decoded sample text, is blocked as tainted. Nothing is sent and the ledger stays empty.
  - **Model failures:** invalid JSON returns `invalid-json`; a schema-valid but inconsistent plugin returns `invalid-plugin` with the problems; a model error returns `model-error`, and the ledger entry is settled as `error`.
- **Panel controller:** Cancel sends nothing. Without the "public documentation" tick nothing is sent. With it, exactly the reviewed payload is sent once, and a second confirm without a new review sends nothing. Lane status messages cover: not configured, lane off, offline.

## Not verified yet

- **No real cloud call yet.** A real Gemini call through Firebase AI Logic has not been made, so whether Gemini returns a valid plugin from the QNB spec is unknown. It needs AI Logic, App Check and a Remote Config lane switched on.
- **Not run in a browser yet.** The DOM panel has not been run in Chrome. That covers the `<dialog>` focus and Escape behaviour, the file pickers, `DOMParser` for .html specs, and the online/offline events. It is type-checked and built, but not exercised in tests (vitest runs in Node without a DOM).
- **Wiring is with the main thread.** `src/main.ts` does not pass `researcher` or `onFileLoaded` yet, so the app currently shows the placeholder.

## Known limitation

The plausibility checks cannot catch every subtle mistake. An XOR key that is off by one bit (0x5B instead of 0x5A) keeps most letters as letters and passes the automatic checks; a test pins this down. The optional **known-text** check (a phrase the user remembers from the file) catches it. The panel asks for one and recommends it.
