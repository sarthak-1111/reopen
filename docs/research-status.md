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

## Verified (by tests: `tests/research/*.test.ts`, 32 tests)

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

## Verified in Chrome with the real service (2026-11-26)

Setup: desktop Chrome on Windows, the local dev server, Firebase AI Logic with the Gemini Developer API, and App Check with a debug token.

1. **First attempt:** constrained decoding with `READER_PLUGIN_SCHEMA` as `responseSchema` → **HTTP 400** "The specified schema produces a constraint that has too many states for serving".
2. **Second attempt:** a lighter copy of the schema (no `maxItems`, `description` or `nullable`) → **HTTP 503** "Deadline expired" after 3.5 min.
3. **Third attempt:** JSON mode with no `responseSchema`. The reply format goes into the reviewed prompt text, and the thinking level is LOW (Remote Config `cloud_thinking_level`).
   - Gemini drafted a reader for "Quillstone Notebook" in 1–2 min, and it passed local schema and semantic validation.
   - **All 21 conformance checks passed** on the three `samples/mystery/*.qnb` files.
   - **Use this reader** added them to the library as full conversions: "1989-04-15 Garden", "1990-11-02 Recipes" and "1991-02-20 Chess club".

Also seen in that run:
- The ledger showed the entry as "Sending…" and then "Sent".
- The cloud counter read 1.
- The consent dialog, the file inputs and the known-text field worked in Chrome.
- The Playwright suite (`tests/e2e/configured.spec.ts`) covers the same flow against a mock, including declining consent, the lane being off, and being offline.

## Busy model, and the switch to `gemini-4-hydrogen` (2026-11-26)

- On the live site, `gemini-3.8-flash` answered **HTTP 500** "This model is currently experiencing high demand" three times (about 01:10–01:27 UTC). App Check accepted each request. The app showed the error, the ledger recorded "Failed", and nothing else was sent.
  - The error message is now plain: "Cloud Gemini is busy right now (HTTP 500). Nothing else was sent. Please try again in a minute; it needs your consent again." A unit test covers it.
- Remote Config (v3) and the built-in default now use `gemini-4-hydrogen`, which is stable and needs no billing according to the Firebase AI Logic model list.
- **Local dev server, debug token:** the draft arrived in about 160 s, 21/21 checks passed, and the three notebooks opened. The counters read 3 processed on this device and 1 cloud call, which confirms the counting fix against the real service.
- **Live site, production App Check (reCAPTCHA Enterprise):** the draft arrived in under 90 s (HTTP 200), 21/21 checks passed, and the three notebooks opened as "Quillstone Notebook". The counters again read 3 and 1.

## Not verified yet

- **Model variability.** Four successful real drafts so far (one with `gemini-3.8-flash`, three with `gemini-4-hydrogen`, including the one in the demo video). Another run may draft a reader that fails the local checks. The app then says so, uses nothing, and lets the user try again with fresh consent.
- **Latency.** The three `gemini-4-hydrogen` drafts so far took about 13 s, under 90 s and about 160 s, and the model can be busy. The panel shows progress text, but no time estimate.

## Known limitation

The plausibility checks cannot catch every subtle mistake. An XOR key that is off by one bit (0x5B instead of 0x5A) keeps most letters as letters and passes the automatic checks; a test pins this down. The optional **known-text** check (a phrase the user remembers from the file) catches it. The panel asks for one and recommends it.
