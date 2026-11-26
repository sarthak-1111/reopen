# Testing Reopen

> **Draft.** The verification table at the end lists what has been checked and what has not.
> It is updated as each check is actually run.

## Try it in 3 minutes (judges)

You need desktop Chrome. Gemini Nano is optional, because the app works without it.

1. Open the demo: `https://reopen-751ea.web.app` _(live after deployment)_.
2. Look at the header:
   - The chip shows the state of on-device AI.
   - The counters show **0 files processed on this device** and **0 cloud calls**.
3. Click **Try the sample folder**. It holds 38 self-made, fictional files from an "old computer" (see `SAMPLES.md`):
   - Shift_JIS and EUC-JP notes
   - Excel 95/97 workbooks and dBASE tables
   - RTF and Word 97 letters
   - a Write document
   - a WordPerfect file renamed to `.DOC`
   - EBCDIC text
   - three files in an unknown format
4. Watch **Your library** fill. Each card shows:
   - the format Reopen **detected from the bytes** (not from the file name)
   - the encoding
   - the new name
   - the converted files (DOCX, Markdown, CSV, XLSX, PNG)
   - an **ON DEVICE** or **NO AI** badge
5. Open a recovered-text card (for example the WordPerfect file):
   - The **Raw recovered text** is shown and labelled.
   - With Nano, a **Reconstructed paragraphs** view appears too. Every word in it exists in the raw text.
6. Click **Download everything (.zip)**. The zip contains the converted files, a browsable `index.html` catalogue and `RESCUE_REPORT.md`.
7. Check the **Privacy Ledger**. It still says **0 cloud calls this session**.
8. Optional, offline:
   - Reload once so the app is cached.
   - In DevTools → Network, set **Offline**.
   - Reload and run the sample folder again. It still works.
9. Optional, the cloud lane (format researcher):
   - Under **Unknown format?**, paste the public spec in `docs/specs/quillstone-notebook-qnb.md`.
   - Click **Review what will be sent**. The dialog shows **exactly** the text that would be sent.
   - Your files are listed under "Never sent".
   - Tick the box only if you agree, then send.
   - The drafted reader is data, not code. Run **Run tests on this computer** on `samples/mystery/*.qnb` before **Use this reader**.
   - The Privacy Ledger records the call with its exact text.

### With Gemini Nano

1. Click **Wake on-device AI** in the header. Chrome downloads Gemini Nano once.
2. Requirements and manual checks are in the README section "Enable Gemini Nano in Chrome".
3. After the download, the chip reads **On-device AI ready**.
4. Cards gain an AI category, a two-line summary and a proposed name, each with an **ON DEVICE** badge.
5. The badge comes from the Firebase SDK's `response.inferenceSource`, not from the app's assumptions.

## Automated tests

```bash
npm ci
npm test            # type-check + vitest: unit, property-based (fast-check), fallback and architecture tests
npm run test:e2e    # Playwright in your installed Chrome against a local production build
E2E_BASE_URL=https://reopen-751ea.web.app npm run test:e2e:hosted   # same suite against the hosted demo
npm run licenses    # fails on GPL/LGPL/AGPL/MPL or unknown licences in production dependencies
npm run secret-scan # fails on API keys, App Check debug tokens, private keys or .env files
```

| Area | File(s) | What is checked |
|---|---|---|
| No invention | `tests/no-invention.test.ts`, `tests/ai/reconstruct.test.ts` | Property: any output that adds a word, number or character not in the source is rejected, and the raw text is shown instead (labelled). Includes Japanese text, full-width forms, case and repeated words. |
| Files never reach the cloud | `tests/ai/cloud-gate.test.ts` | Property: a payload holding a copied run of any dropped file (raw, hex, base64 or Latin-1, 47 bytes or more) is blocked before sending. Clean public documentation passes. Consent is single-use and tied to the SHA-256 of the exact payload. |
| Fallbacks | `tests/ai/service.test.ts`, `tests/ai/cloud-gate.test.ts`, `tests/research/*.test.ts` | Nano unavailable, downloading or missing, Firebase not configured, offline, cloud lane off via Remote Config, consent declined or reused. |
| Architecture | `tests/ai/architecture.test.ts` | Only two files create models; only the composition root passes the cloud model to the gate; no `PREFER_*` modes; App Check only in `src/firebase/init.ts`; no Firebase imports in the UI. |
| Encoding | `tests/encoding.test.ts` | Round-trips and measured detection accuracy for Shift_JIS, EUC-JP, Windows-1252 and seven EBCDIC code pages. |
| Formats | `tests/readers.test.ts` and others | Detection by structure on all samples, with and without names; `detectFormat` and `rescueFile` never throw on random or corrupted bytes. |
| Format researcher | `tests/research/*.test.ts` | Interpreter bounds and caps; a wrong reader fails local conformance; never throws on random input. |
| End to end | `tests/e2e/` | See `tests/e2e/README.md`. |

## Verification status

| Check | Status |
|---|---|
| `npm test` (unit, property, fallback, architecture) | Passing: 290 tests on 2026-11-26 |
| `npm run build`, `npm run licenses`, `npm audit --omit=dev` | Passing (0 vulnerabilities) on 2026-11-26 |
| Playwright E2E against the local build | _pending_ |
| Real Gemini Nano call through Firebase AI Logic (`ONLY_ON_DEVICE`) | _pending: needs AI Logic, App Check and the Nano download_ |
| Real cloud Gemini call (`ONLY_IN_CLOUD`) through Firebase AI Logic with App Check | Passed on the smoke page, 2026-11-26: `inferenceSource = in_cloud`, schema-valid, 32 s (GO_NO_GO.md §5) |
| Real cloud call through the app's gate (format researcher) | _pending_ |
| Whether on-device calls need the network for App Check | _pending_ |
| Hosted demo in Chrome, with and without Nano | _pending deployment_ |
