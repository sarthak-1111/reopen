# Reopen: Devpost description

**Drop in a folder from an old computer. Your files come back, readable, and nothing leaves your laptop.**

## Inspiration

Most families and small offices have a folder like this: letters from an old word processor, a budget workbook
from Excel 95, notes saved in Shift_JIS on a Japanese PC, a ledger exported from a mainframe in EBCDIC. Nothing on a
modern laptop opens them. The usual fix is to upload them to a conversion website. But these are exactly the
files you should not upload: tax letters, medical notes, family history.

Reopen rescues them **on your own computer**. AI only helps where it can do so privately (Gemini Nano, on-device).
The cloud is used for one thing only: reading **public documentation** about a file format, never your files.

## What it does

- **Bulk rescue.** Choose a folder (File System Access API), drop one in, or upload a .zip.
  - Every file is identified by its **structure** (magic numbers, OLE streams, record layouts), not its extension.
  - Files are converted to DOCX, Markdown, CSV, XLSX or PNG.
  - Each file gets a sensible name.
  - You get one zip with a browsable `index.html` catalogue and a Rescue Report.
- **Legacy text and encodings.**
  - Shift_JIS, EUC-JP and Windows-1252 are detected and decoded.
  - So are seven EBCDIC code pages.
  - Detection accuracy is measured in the test suite.
- **Legacy formats.**
  - Full conversion: spreadsheets (Excel 2.x–2003, SYLK, DIF, dBASE), RTF, BMP.
  - Text and paragraphs: Word 97–2003 and Write.
  - Text recovery, clearly labelled: WordPerfect, and formats that have no permissively licensed reader.
- **On-device AI (Gemini Nano through Firebase AI Logic).**
  - Triage: category, a two-line summary and a proposed file name.
  - A check that decoded text reads as natural language.
  - Paragraph and heading reconstruction of recovered text.
  - All of it as schema-validated JSON.
- **The no-invention rule.**
  - Reconstruction may only reorder, clean and structure the recovered text.
  - Code checks that every output token exists in the source. Japanese characters count one by one, and repeats are counted too.
  - If the check fails, Reopen shows the raw text, labelled, instead.
  - A property-based test enforces this.
- **Format researcher (cloud, opt-in).** For a format Reopen doesn't know:
  - You paste or load its **public documentation**.
  - Cloud Gemini drafts a reader. The reader is **declarative data**, not code, so nothing AI-written is ever executed.
  - Reopen runs local conformance tests on your sample files and only uses the reader if they pass.
  - Your files are listed under "Never sent".
- **Proof, not promises.**
  - Every AI result has an **ON DEVICE** or **CLOUD** badge, taken from the SDK's own `inferenceSource`.
  - A live counter shows cloud calls.
  - A **Privacy Ledger** records the exact text of every cloud call.
- **Works offline** once loaded (service worker), and Gemini Nano keeps working with the network off.
- **Works without Gemini Nano** too: conversion is deterministic, and recovered text is shown raw and labelled.

## How we built it: Firebase AI Logic and Firebase

- **Firebase AI Logic hybrid inference** (`firebase` 13.4.0):
  - `getGenerativeModel(ai, { mode: InferenceMode.ONLY_ON_DEVICE, onDeviceParams })` for everything that touches file contents.
    - Structured output uses `promptOptions.responseConstraint`.
    - `createOptions` declares English and Japanese.
    - `initializeDeviceModel()` warms up the model and shows download progress.
  - `InferenceMode.ONLY_IN_CLOUD` in JSON mode (`gemini-4-hydrogen`, set by Remote Config), for the format researcher only.
    - The reply format is written into the reviewed prompt text, and the thinking level comes from Remote Config.
    - The answer is validated locally against the full schema.
    - We tried constrained `responseSchema` first: the real service rejected our plugin schema ("too many states"), so we switched and recorded why.
    - When the first model we used answered "high demand" (HTTP 500) during testing, Remote Config let us move to another model without a new build, and the app now tells the user plainly to try again.
  - We deliberately never use `PREFER_ON_DEVICE`, because its silent fallback to the cloud would break the privacy promise. An architecture test fails the build if anyone adds it.
  - Badges come from `response.inferenceSource`.
- **App Check** with reCAPTCHA Enterprise protects the Gemini endpoint. AI Logic enforcement is on.
- **Remote Config** controls:
  - the cloud lane switch (the app's built-in default is **off**, so it fails closed)
  - the batch size
  - the cloud model name, output-token limit and thinking level
  - the Nano chunk size and retry attempts
- **Firebase Hosting** serves the app with an offline-capable shell.
- There is **no database of user files**, because there is nothing to store.

**One function can reach the cloud.** `sendToCloud` checks, in order:
1. the Remote Config switch
2. that the browser is online
3. a **single-use consent token tied to the SHA-256 of the exact text** you reviewed
4. a **taint check** that blocks the request if it contains any run of your files' bytes (raw, hex or base64) or text

It writes the exact text to the Privacy Ledger **before** sending.

## Judging criteria

**Technological Implementation**
- Real hybrid routing with a reason for each step: deterministic code first, Nano on-device for anything personal, cloud only for public knowledge.
- Formats are detected by their structure. Some readers were written from public specifications, such as the Word 97 piece table from Microsoft's [MS-DOC].
- 298 automated tests, including property-based tests:
  - no invention
  - no file bytes in any cloud payload
  - encoding round-trips
  - readers never throw on random bytes
- Fallback tests cover: Nano unavailable, offline, cloud lane disabled by Remote Config, consent declined.
- Playwright end-to-end tests run in Chrome, against a local build (with a mocked Firebase for the cloud paths) and against the live demo.

**Design**
- One screen and one action: drop a folder in.
- The header always shows where things run: on-device AI state, files processed on this device, cloud calls.
- Every card explains how the format was recognised ("Detected from the bytes inside the file, not from its name").
- Calm and readable: warm paper colours, one type scale, and colour kept for the ON DEVICE / CLOUD / NO AI stamps and status dots.
- Accessibility: native buttons, inputs and `<dialog>`, labelled controls, live regions for progress, a skip link (tested with the keyboard in Playwright), visible focus rings, and reduced-motion support. Text contrast measures at least 4.5:1 in light and dark themes, and the layout has no horizontal scrolling at 360 px wide.

**Potential Impact**
- Old files are personal, and reading them should not require uploading them.
- Reopen helps anyone with an old folder: families, small offices, archivists, and Japanese users with Shift_JIS-era files.
- It runs free in Chrome, with no account and no installation.
- The researcher pattern (public docs → declarative reader → local tests) lets the community add formats without anyone sending their files anywhere.

**Quality of the Idea**
- The privacy claim is **enforced and visible**, not just stated:
  - the badges come from the SDK
  - the ledger shows exact payloads
  - consent is tied to the exact text
  - a taint check blocks file bytes
- The no-invention guarantee makes on-device AI trustworthy for documents where a made-up word would be worse than no answer.

## What we built during the submission period

Everything in the repository was written from scratch starting 2026-11-24, as the git history shows. Pre-existing code is limited to the
open-source libraries listed in `NOTICE` (MIT, Apache-2.0, BSD-family, 0BSD and ISC; no GPL or LGPL). All sample files are self-made
and fictional (`SAMPLES.md`).

## What's next

- More readers written from public specifications.
- A shared catalogue of researcher-drafted readers that pass conformance tests.

## Tested on the live demo

On https://reopen-751ea.web.app in Chrome 156 on Windows, with Gemini Nano, on 2026-11-26:
- The sample folder: 14 of 15 files rescued in about a minute, 43 ON DEVICE results, **0 cloud calls**, and no requests to any other site.
- The format researcher, with production App Check: the reader was drafted by cloud Gemini in under two minutes, passed 21 of 21 local checks, and opened all three notebooks.
- With the network switched off (browser offline mode, production build): 14 of 15 files rescued with every on-device call succeeding, and nothing reached the network.
- Without Nano (a fresh Chrome profile, Playwright): conversion works, recovered text is labelled raw, and the app works offline after one visit.

Full details are in `TESTING.md` in the repository: https://github.com/sarthak-1111/reopen
