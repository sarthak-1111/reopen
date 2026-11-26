# Reopen: GO / NO-GO (Step 0)

Checked 2026-11-24 (JST). Deadline: **Nov 30 2026, 2:00 pm PT = Dec 1 2026, 07:00 JST**.
Commits after that time are not evaluated (rules §7).

## Verdict: CONDITIONAL GO. **Approved by you on 2026-11-24.**

Your decision, 2026-11-24: `jschardet` 4.x (0BSD) is accepted, so it will be used for EBCDIC detection candidates.

Your decisions, 2026-11-26:
- ISC is accepted for the five packages Firebase brings in.
- Deploy approved: Hosting and Remote Config are live at https://reopen-751ea.web.app.
- The empty Google Cloud project `reopen-files` (left over from the failed CLI attempt on Nov 24) was shut down. It is pending deletion and recoverable for 30 days.
- Cloud model switched to `gemini-4-hydrogen` (stable, no billing required per the Firebase AI Logic model list) in Remote Config v3 and the built-in default. `gemini-3.8-flash` answered HTTP 500 "high demand" three times on the live site; `gemini-4-hydrogen` passed the smoke cloud call (5.2 s, schema-valid) and the full researcher both locally and on the live site (see TESTING.md).

Nothing found blocks the project. It needs four things from you before the build can be tested end to end:
your approval, two CLI sign-ins, the Gemini Nano download, and the Firebase console steps in §4.

| # | Check | Result |
|---|---|---|
| 1 | Rules | **GO.** Read in full (in your Chrome). Requirements and how Reopen meets them are below. |
| 1 | Hybrid docs → `HYBRID_NOTES.md` | **GO.** Exact SDK version and API names, checked against the SDK's typings. |
| 2 | Gemini Nano in your Chrome | **PARTIAL.** The API is present and needs no flags; the model is *downloadable* but not downloaded yet. |
| 3 | Format feasibility | **GO, with limits.** Spreadsheets, RTF and legacy-encoded text convert fully. Most word-processor formats only get text recovery (table below). |
| 4 | Firebase setup | **PENDING YOU.** Steps in §4. |
| 5 | Smoke test | **PASSED on 2026-11-26** (§5): cloud call, on-device call (zero network requests), and the format researcher end to end. Still open: the on-device call with the network fully off. |

## 1. Rules: what matters for Reopen

Source: https://firebasehybridaihackathon.devpost.com/rules, read 2026-11-24.

| Rule | How Reopen meets it |
|---|---|
| "Build a Gen AI application using Firebase AI Logic along with supported firebase products such as: AppCheck, RemoteConfig…" | AI Logic hybrid inference, App Check, Remote Config and Hosting. No Firestore (no database of user files). |
| Platform "Web (Chrome): Integrating with Gemini Nano 4 via Firebase AI Logic" | Web app in Chrome; on-device calls go through AI Logic `ONLY_ON_DEVICE`. |
| "Firebase AI Logic requires App Check; debug tokens are accepted in submissions." | The hosted demo uses reCAPTCHA Enterprise. The debug token stays in an untracked local file. |
| Repo "must demonstrate the use of Firebase AI Logic at runtime in your code — imported and actually called" | `src/firebase/init.ts`, plus `getGenerativeModel(...).generateContent(...)` in the app. |
| Public repo with an open-source licence "visible at the top of the repository page (in the About section)"; "Apache is preferred" | Apache-2.0 `LICENSE` at the repo root, so GitHub detects it. |
| Video: "should not be longer than 3 minutes", public on YouTube, English | Script target is 2:50. |
| "must not include production API keys, live Google Cloud project secrets, … or personally identifiable information (PII)" | `.env*` files are git-ignored now. Planned: a secret scan before every commit. All samples will be self-made. |
| New project, or "significantly updated"; "disclose any other pre-existing code" | Built from scratch from 2026-11-24. The only pre-existing code is the open-source libraries listed below. |
| Open source use is allowed if licences are complied with | Only MIT, Apache-2.0 or BSD dependencies. Planned: a NOTICE file with third-party attributions. |
| No "third party advertising, slogan, logo, trademark" | No vendor logos in the UI or video. Format names appear only as plain descriptive text. |
| Judging: equally weighted 1–5 on **Technological Implementation, Design, Potential Impact, Quality of the Idea** | `DESCRIPTION.md` will map to these four. |
| Eligibility | Japan is not on the excluded list. Google/Devpost employees, contractors and their families are ineligible, which you need to confirm yourself. |
| Free tier: "All required tools, including Firebase AI Logic and Gemini Nano 4, can be used at no cost through the free tier." | We stay on the Spark plan. |

## 2. Gemini Nano on your workstation

Checked in your Chrome via the extension:
- Chrome 156.
- `LanguageModel` exists with no `chrome://flags` enabled.
- `LanguageModel.availability()` returns **`downloadable`** for English, Japanese, Spanish, German and French text.

**Flags needed: none for Reopen (text only).** The Firebase docs list `#prompt-api-for-gemini-nano-multimodal-input`, but that one is for image input.

The extension isn't allowed to open `chrome://` pages, so two things need you:
1. Open `chrome://on-device-internals` and check that the Model Status tab and Broker State show no errors.
2. **Approve the Nano download.** It runs inside Chrome, from Google, over an unmetered connection. Chrome doesn't state the exact size; it requires 22 GB free, and you have about 1.5 TB.
   Either click **Warm up Gemini Nano** on the smoke page once it's running, or tell me and I'll start it from your Chrome.

## 3. Format feasibility

Licences and supported formats were checked against each project's own docs, repo or package. MIT, Apache-2.0 and BSD only.

### Full conversion: a permissive reader exists

| Family | Formats (as listed in the library's own docs) | Library (licence, version) | Reopen output |
|---|---|---|---|
| Spreadsheets | Excel 2.x–2003 `.xls` (BIFF2/3/4/5/8; Multiplan 4 "normal" files read as BIFF2), Excel 2003 XML, SYLK, DIF, Lotus 1-2-3 (WK1/WK3, read-only WKS/WK2/WK4/123), Quattro Pro (WQ1/WQ2/WB1/WB2/WB3/QPW, read-only), Works spreadsheets (WKS, XLR, read-only), dBASE/FoxPro DBF, ODS/FODS, PRN | **SheetJS CE 0.20.3** (Apache-2.0; LICENSE checked inside the official tarball). Installed from `cdn.sheetjs.com`, because the docs say npm stopped at 0.18.5. | CSV per sheet (+ XLSX) |
| Rich Text | RTF, including embedded WMF/EMF pictures | **rtf.js 3.0.9** (MIT; bundles js-codepage, Apache-2.0) | DOCX and Markdown; pictures → PNG |
| Legacy-encoded text | Shift_JIS, EUC-JP, ISO-2022-JP, windows-1252 (all in the WHATWG Encoding Standard) | Decoding: the browser's built-in `TextDecoder`. Detection: **encoding-japanese 2.5.0** (MIT: SJIS/EUC-JP/JIS/UTF) and **chardet 2.2.0** (MIT: windows-125x, ISO-8859-x, Shift_JIS, EUC-JP…) | UTF-8 text / Markdown |
| EBCDIC text, single-byte | Decoding of cp037, 500, 875, 1026, 1047, 1140 and 20290 (Japanese Katakana) | **codepage 1.15.0** (Apache-2.0) for decoding. Detection: our own byte-statistics check, because neither MIT detector lists EBCDIC. | UTF-8 text |

Supporting libraries, all permissive:
- OLE containers (to detect Word/Excel/Works files by structure): **cfb 1.2.2** (Apache-2.0)
- DOCX writing in the browser: **docx 9.16.0** (MIT, `Packer.toBlob`)
- zip in and out: **fflate 0.8.3** (MIT)
- schema validation: **ajv 8.20.0** (MIT)
- property tests: **fast-check 4.11.0** (MIT)
- end-to-end tests: **Playwright 1.65.1** (Apache-2.0)

### Text recovery only: no permissive full reader exists

| Format | Why | What Reopen does |
|---|---|---|
| Word 97–2003 `.doc` | The only MIT option (`word-extractor`) describes itself as a Node.js library; browser use is unverified. | Our own text extraction from the OLE `WordDocument` stream, written from Microsoft's public [MS-DOC] spec. Full text with paragraph breaks, **no formatting**. |
| WordPerfect `.wpd/.wp5`, Works word processor `.wps`, MacWrite, ClarisWorks | The only verified readers (libwpd, libwps, libmwaw) are LGPLv2 / MPL 2.0, so they're excluded. | Recover text runs and detect their encoding, then on-device paragraph/heading reconstruction under the no-invention rule. |
| Write `.wri`, Word for DOS / Word 6, Ichitaro `.jtd`, Ami Pro / Word Pro | No permissive reader found. The search wasn't exhaustive, so this means none found, not none exists. | Same text recovery. These also make good test cases for the format researcher. |
| Japanese EBCDIC (930/939, double-byte) | Not in `codepage`. | Detected and labelled; only the single-byte parts are decoded. |

**One decision for you:** `jschardet` 4.x is now licensed **0BSD** (Zero-Clause BSD); v3 was LGPL.
It is the only detector I found that also lists EBCDIC code pages. Is 0BSD acceptable as "BSD"?
If not, I'll use our own EBCDIC check, which is the default plan anyway.

## 4. Firebase setup: what you need to click

Stay on the **Spark (no-cost)** plan. If any screen asks for billing, stop and tell me.
Alternatively, approve and I'll click through these in your Chrome. I'd stop at any terms, billing or permission screen for you.

1. https://console.firebase.google.com → **Create a project** → name `reopen` (or similar) → Google Analytics **off** → Create. Note the project ID.
2. Project Overview → **Add app** → **Web (</>)** → nickname `reopen-web` → tick **Also set up Firebase Hosting** → Register.
   Copy the config values into `.env.local` (fields in `.env.example`); I can do this from the console page.
3. **AI Services → AI Logic → Get started** → choose **Gemini Developer API** → finish.
   Don't copy the Gemini API key anywhere; the app never needs it.
4. Google Cloud console → **Security → reCAPTCHA** (https://console.cloud.google.com/security/recaptcha), in the same project:
   - Create a **Web** key with domains `<project-id>.web.app` and `<project-id>.firebaseapp.com`.
   - Leave the checkbox challenge off and **don't add localhost**.
5. Firebase → **Security → App Check → Apps** → `reopen-web` → **reCAPTCHA Enterprise** → paste the site key → Save.
6. **Debug token** (after the smoke page first runs on localhost):
   - Copy the `AppCheck debug token` from the DevTools console.
   - Register it under App Check → Apps → ⋮ → **Manage debug tokens**.
   - It only ever goes in `.env.local`, never in git, chat or docs.
7. **Remote Config:** I'll create these from the CLI as a template file, so no clicks are needed:
   - `cloud_lane_enabled` (default false in the app, true on the server)
   - `batch_size`
   - `cloud_model`
   - `nano_temperature`
   - `max_recovery_chars`
8. **Hosting:** deployed from the CLI. The demo URL will be `https://<project-id>.web.app`.

CLI sign-ins (you run these; each one waits for you in the browser):
- `! firebase login`. Open the printed link, sign in, then run `! firebase login <code>`.
- `! & "C:\Program Files\GitHub CLI\gh.exe" auth login --hostname github.com --git-protocol https --web --scopes "repo,workflow"`.
  This is needed to create the public repo `sarthak-1111/reopen` and set its About licence.

## 5. Smoke test

`smoke/index.html` + `smoke/main.ts` (Vite, `firebase@13.4.0` bundled locally so it works offline). It has:
- Environment readout: SDK version, App Check mode, `navigator.onLine`, `LanguageModel.availability()`.
- **Warm up** → `initializeDeviceModel(progress)`.
- **On-device call:** `ONLY_ON_DEVICE` with `promptOptions.responseConstraint`.
- **Cloud call:** `ONLY_IN_CLOUD` with `responseMimeType: "application/json"` + `responseSchema`, default model `gemini-3.8-flash`.
- Each result shows the **ON DEVICE / CLOUD badge from `response.inferenceSource`**, schema validity, latency, and every network request made during the call.
- Offline check: after warm-up, turn Wi-Fi off. The on-device call should still succeed with no requests, and the cloud call should fail cleanly.

The smoke run also settles the one open technical risk: does an `ONLY_ON_DEVICE` call try to fetch an App Check token over the network?

### Smoke results

Setup completed on 2026-11-26:
- AI Logic is enabled with the Gemini Developer API. AI monitoring is off.
- The project is on the Spark plan, with no billing account.
- The reCAPTCHA Enterprise key `reopen-web` is restricted to `reopen-751ea.web.app` and `reopen-751ea.firebaseapp.com`.
- App Check is registered for reopen-web, and enforcement for AI Logic is on.
- The debug token is registered and kept only in `.env.local`.
- The browser is Chrome on Windows, at `http://127.0.0.1:5173/smoke/` (Vite dev server).

| Test | Result |
|---|---|
| Cloud call (`ONLY_IN_CLOUD`, `gemini-3.8-flash`, JSON schema) | **PASS** (2026-11-26 00:34 UTC). `inferenceSource = "in_cloud"`; output valid against the schema; latency **32,086 ms** (first call); one request: `firebasevertexai.googleapis.com/v1beta/projects/reopen-751ea/models/gemini-3.8-flash:generateContent`. The prompt is the smoke page's own made-up memo text. |
| On-device call (`ONLY_ON_DEVICE`, `responseConstraint`) | **PASS** (2026-11-26 00:40 UTC, after the Nano download finished). `inferenceSource = "on_device"`; output valid against the schema; **19,220 ms** cold (includes loading the model), **1,067 ms** warm; **zero network requests** in both runs (page log and Chrome's network log). |
| Offline: on-device succeeds, cloud fails cleanly | _pending: needs the network switched off on this PC (Playwright covers offline conversion without Nano)._ |
| Does `ONLY_ON_DEVICE` need the network for App Check? | **No requests were made** during either on-device call while online. Behaviour with the network fully off is still to be confirmed (row above). |
| Format researcher through the app's cloud gate | **PASS on the third attempt** (2026-11-26 00:51 UTC), with one real call of 1–2 min. Gemini drafted a valid "Quillstone Notebook" reader. All 21 local conformance checks passed on the three `samples/mystery/*.qnb` files, and they opened as "1989-04-15 Garden", "1990-11-02 Recipes" and "1991-02-20 Chess club". Earlier attempts: constrained decoding with the full plugin schema → **HTTP 400** "too many states for serving"; a lighter schema → **503** timeout after 3.5 min. Fix: JSON mode with the reply format inside the reviewed prompt text, thinking level LOW (Remote Config `cloud_thinking_level`), and local validation as before. |

Raw record (cloud):

```json
{"test":"cloud","at":"2026-11-26T00:34:36.261Z","online":true,"ok":true,"inferenceSource":"in_cloud","output":{"summary":"The riverside office stock count is complete with totals attached for filing under the first quarter.","documentType":"memo"},"schemaValid":true,"latencyMs":32086,"requests":["fetch https://firebasevertexai.googleapis.com/v1beta/projects/reopen-751ea/models/gemini-3.8-flash:generateContent","resource https://firebasevertexai.googleapis.com/v1beta/projects/reopen-751ea/models/gemini-3.8-flash:generateContent"]}
```

### Build check (2026-11-24)

- `tsc --noEmit` (TypeScript 7.0.2, strict): **passes**.
- `vite build` (Vite 6.4.6): **passes**. `dist/smoke/index.html` is 4.8 kB and the JS bundle is 105 kB (24 kB gzipped).
- Tooling note: Vite 8 does not run here. Its native bundler binding failed to install, and your Node is 20.12.1, older than Vite 8 supports.
  I pinned **Vite 6.4.6** (Node `^18 || ^20 || >=22`) instead of upgrading your system Node.
- `npm audit --omit=dev` reports 4 "high" advisories. All four come from `@grpc/grpc-js` via `@firebase/firestore`, a Node-only gRPC transport.
  Reopen never imports Firestore, and it isn't in the browser bundle. npm's suggested fix (downgrading to `firebase@9.14.0`) would remove hybrid inference, so I won't apply it.
  Done on 2026-11-26: an npm `overrides` entry pins `@grpc/grpc-js` 1.14.7, and `npm audit --omit=dev` now reports 0 vulnerabilities.

## What I need from you

1. **Approve this go/no-go**, and answer the 0BSD question for `jschardet`.
2. Run the two CLI sign-ins above.
3. Do Firebase steps 1–5, or tell me to click through them in your Chrome.
4. Check `chrome://on-device-internals`, and approve the Nano download.

Then I'll run the smoke test, record the results here, and start the build.
