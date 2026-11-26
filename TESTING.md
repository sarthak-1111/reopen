# Testing Reopen

> The verification table at the end lists what has been checked, when, and what has not.

## Try it in 3 minutes (judges)

You need desktop Chrome. Gemini Nano is optional, because the app works without it.

1. Open the demo: https://reopen-751ea.web.app.
2. Look at the header:
   - The chip shows the state of on-device AI.
   - The counters show **0 files processed on this device** and **0 cloud calls**.
3. Click **Try the sample folder**. It holds 15 self-made, fictional files from an "old computer" (see `SAMPLES.md`):
   - Japanese and Windows-1252 text notes
   - EBCDIC text named `LEDGER.DAT`
   - Excel workbooks (one is named `STOCK.DAT`), SYLK, DIF and a dBASE table
   - an RTF document, a Word 97 report and a Write document
   - a WordPerfect file renamed to `STATUS.DOC`
   - a BMP image
   - one file in an unknown format (`GARDEN.QNB`)
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
   - The drafted reader is data, not code. Add the three files in `samples/mystery/` under **Add sample files**, then click **Run tests on this computer** before **Use this reader**.
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
| `npm test` (unit, property, fallback, architecture) | Passing: 298 tests on 2026-11-26 |
| `npm run build`, `npm run licenses`, `npm audit --omit=dev` | Passing (0 vulnerabilities) on 2026-11-26 |
| Playwright E2E against the local build (Firebase mocked) | Passing: 24 passed, 1 skipped (with-Nano test needs `E2E_CHROME_PROFILE`), 2026-11-26, after the UI restyle |
| Real Gemini Nano call through Firebase AI Logic (`ONLY_ON_DEVICE`) | Passed on the smoke page, 2026-11-26: `inferenceSource = on_device`, schema-valid, 1.1 s warm, zero network requests (GO_NO_GO.md §5) |
| Real cloud Gemini call (`ONLY_IN_CLOUD`) through Firebase AI Logic with App Check | Passed on the smoke page, 2026-11-26: `inferenceSource = in_cloud`, schema-valid, 32 s (GO_NO_GO.md §5) |
| Real cloud call through the app's gate (format researcher) | Passed in Chrome, 2026-11-26: reader drafted (1–2 min), 21/21 local checks, three `.qnb` files opened. Needed a fix first (see GO_NO_GO.md §5) |
| On-device AI with the network fully off | Passed, 2026-11-26, recording the demo video. Setup: production build served locally, browser offline mode (Playwright `set_offline`), Chrome 156 with Nano. Result: "14 of 15 files rescued on this device. Cloud calls: 0.", with 14 ON DEVICE cards. All 8 page requests were answered by the service worker. 4 App Check (reCAPTCHA) requests failed with `ERR_INTERNET_DISCONNECTED`, and on-device calls succeeded anyway. Reloading while offline loaded the app from the cache with Nano ready, but the automated browser then reported `navigator.onLine = true`, so the chip said "Online". A reload with a real network outage has not been tested |
| Sample folder in the real app with Gemini Nano (local dev server, Chrome on Windows) | Passed, 2026-11-26: "14 of 15 files rescued on this device. Cloud calls: 0." in about 45 s, with 43 ON DEVICE badges (summaries, names, reconstruction). Only same-origin and blob requests appeared in Chrome's network log. WordPerfect reconstruction passed the no-invention check |
| Without Nano | Playwright (fresh profile, Nano unavailable): every card says NO AI, and recovered text is shown raw and labelled |
| Hosted demo with Gemini Nano (https://reopen-751ea.web.app, Chrome on Windows, production App Check via reCAPTCHA Enterprise) | Passed twice on 2026-11-26, before and after the UI restyle: "14 of 15 files rescued on this device. Cloud calls: 0." in about 60 s, with 43 ON DEVICE results and only same-origin requests. The deployed bundle contains no debug token and no smoke page (`/smoke/` returns 404) |
| Hosted format researcher (real cloud call, production App Check) | `gemini-3.8-flash` answered HTTP 500 "This model is currently experiencing high demand" three times (2026-11-26, about 01:10–01:27 UTC). The app showed the error and the ledger recorded "Failed". After switching Remote Config to `gemini-4-hydrogen`: **passed** (01:36 UTC). The draft arrived in under 90 s (HTTP 200), 21/21 local checks passed, all three `.qnb` files opened as "Quillstone Notebook", and the counters read 3 processed on this device and 1 cloud call. The same flow on the local dev server took about 160 s |
| Hosted demo without Nano (Playwright, fresh Chrome profile, `npm run test:e2e:hosted`) | Passed, 2026-11-26, after the restyle: 14 passed, 11 skipped. The skipped tests need the mocked Firebase build (10) or a Nano profile (1). Passed tests include the offline test (after one visit, the app and the sample folder work with no network) and the network guard (a full rescue and export send no file bytes or text anywhere) |
| Card labels (after the video review) | A researched file's card explains its CLOUD stamp ("Read on this device. Only the reader was drafted in the cloud…"), and the Playwright flow asserts it. With Nano on the hosted demo, `STATUS.DOC`'s chip reads "Recovered text — tidied, raw kept" once the no-invention check passes. Checked 2026-11-26 |
| Hosted caching | Fixed, 2026-11-26: `/` was served with `max-age=3600`, so a returning browser kept the old build for up to an hour. `/`, `sw.js` and the manifests are now `no-cache`; hashed assets stay immutable. Checked with curl |
| v1.1 design (taste-skill pass, `ui-taste-preview` fast-forwarded into `trunk`, deployed from `6c47385`) | Checked 2026-11-26 before and after deploying. `npm test`: 298 passed. Local Playwright: 24 passed, 1 skipped. Lowest text contrast 5.55:1 (light) and 7.02:1 (dark) over 446 text nodes per view; no horizontal scrolling at 360 or 390 px. Same copy, IDs and ARIA; no TypeScript changes |
| Hosted demo with Gemini Nano, v1.1 | Passed, 2026-11-26: "14 of 15 files rescued on this device. Cloud calls: 0." in 60 s, with 43 ON DEVICE results and only same-origin requests. Hosted Playwright (`npm run test:e2e:hosted`): 14 passed, 11 skipped, as before |
| Hosted, first visit, rescue then researcher (normal Chrome on Windows, v1.1) | Passed, 2026-11-26: with the site's stored data cleared first, the sample folder gave 14 of 15 files and 0 cloud calls. Then the Quillstone spec was reviewed and sent: draft received in under 20 s, 7/7 local checks passed on the rescued `GARDEN.QNB`, which opened as "1989-04-15 Garden" with the "Read on this device…" note. The ledger showed 1 call: `gemini-4-hydrogen`, 5.5 KB, Sent |
| Hosted researcher in a Playwright-driven Chrome (gallery screenshots, v1.1) | Twice, with the site's stored data cleared first, the draft request was refused with HTTP 401 "Firebase App Check token is invalid"; the app showed the error and sent nothing else. With stored data from an earlier run it passed: draft in 16.8 s, 21/21 local checks, three `.qnb` files opened. The likely cause, not confirmed, is reCAPTCHA Enterprise scoring the automated browser low. The same first-visit flow passed in a normal Chrome (row above) |
