# End-to-end tests (Playwright, Google Chrome)

These tests drive the real app in **Google Chrome** (Playwright `channel: 'chrome'`; Playwright
downloads no browser). They never click **Wake on-device AI** (which would start a large model
download) and never send anything to a real cloud model.

```sh
npm run test:e2e                 # local, hermetic: builds the app twice and tests both
npm run test:e2e:hosted          # the hosted demo (default https://reopen-751ea.web.app)
npx playwright show-report       # HTML report of the last run (playwright-report/)
```

Set `E2E_HEADED=1` to watch the browser. Set `E2E_BASE_URL=<url>` to test any deployed copy
(`test:e2e:hosted` sets it for you).

## What runs where

`npm run test:e2e` starts two local servers with `tools/e2e-server.mjs`. Both are production
builds (service worker included), written to `.e2e-dist/`, never to `dist/`. **Neither contacts a
real Firebase project.** Real settings stay in the untracked `.env.local`; the e2e builds override
every `VITE_*` value.

| Server | Port | Firebase settings | Used by |
|---|---|---|---|
| `plain` | 4183 | blanked: AI Logic not configured, stub AI, no cloud lane | `reopen.spec.ts` |
| `configured` | 4184 | **fake** values; every Firebase and reCAPTCHA request is answered inside the browser by `firebase-mock.ts` | `configured.spec.ts` and the with-Nano test |

`firebase-mock.ts` answers the reCAPTCHA Enterprise script (a stub that returns a fake token),
App Check, Installations, Remote Config (lane on, off, or unreachable) and the Gemini endpoint
(fixed reply: the hand-written QNB reader from `tests/research/qnb-plugin.ts`). Any other
non-local request is aborted, so nothing leaves the machine.

## The tests

`reopen.spec.ts` (plain build, or the hosted URL):

- **App shell:** the 10-second line, zeroed counters, Apache-2.0 and source link in the footer,
  the folder picker offered in Chrome, a known Gemini Nano chip state, no page errors. Also: keyboard
  skip link, and no horizontal scrolling at 360 px before and after a rescue.
- **Rescue:** the self-made sample folder, the same folder as a `.zip` upload, a `.zip` dropped on
  the drop zone, and the classic folder `<input>`. For every file in `samples/manifest.json`
  (`old-folder/`), the card exists and shows every expected phrase. Detection by structure is
  checked (`STOCK.DAT` is Excel, `STATUS.DOC` is WordPerfect, `LEDGER.DAT` is EBCDIC), encodings
  are named, the mystery file is left "Not converted", there are no CLOUD badges and 0 cloud calls.
  Start over clears the library and the counters.
- **Export:** the downloaded zip has `index.html` (every original path listed), `RESCUE_REPORT.md`
  ("Files processed on this device: 15. Cloud calls: 0."), and DOCX, Markdown, CSV and PNG outputs.
  Every expected phrase is present in an exported text file, and `HYPERLINK` (a Word field code)
  appears in none.
- **Network guard:** a full rescue (sample folder and zip) plus export is recorded with service
  workers blocked. It fails on any AI endpoint call, any non-GET request to the app's own origin, or
  any sample file's bytes, hex or known text in any URL or request body. On the local build it also
  requires **zero** external requests. A **self-check** plants leaks (raw bytes from the page, text
  from a Web Worker) to a fake host answered locally, and proves the guard reports both.
- **Without Gemini Nano:** with the Prompt API removed, the chip says so, every card's AI badge is
  "NO AI", nothing is reconstructed, and recovered text is shown raw, labelled and open.
- **Format researcher:** on the plain build the panel is a placeholder that says AI Logic is not
  configured. On a configured or hosted build the test declines consent every way (Cancel, Escape,
  box unticked) and checks that nothing is sent.
- **Offline:** after "Ready offline" appears, the browser goes offline. The test checks that the
  page and the service worker both lose the network, then reloads (served by the service worker),
  sees "Offline: still working on this device" and rescues the whole sample folder.
- **With Gemini Nano** (skipped unless `E2E_CHROME_PROFILE` is set; see below).

`configured.spec.ts` (configured build plus mock, local only):

- **Start-up and privacy:** only reCAPTCHA (App Check), Installations and Remote Config are
  contacted. A full rescue and export makes no AI call and leaks nothing.
- **Taint block:** pasting a rescued file's text (the letter) into the researcher and confirming
  is refused before any request exists ("Nothing was sent. The text contains a passage copied
  from one of your files…"). The ledger stays at 0, even though the fake endpoint would have
  answered.
- **Consent declined, lane off by Remote Config, Remote Config unreachable (fails closed),
  offline and back:** each state shows its message, and Review is disabled where it must be.
- **Full researcher flow:**
  1. The sample folder is rescued, leaving the QNB file unconverted.
  2. The QNB spec is pasted, reviewed and sent with consent.
  3. Exactly one cloud call is made. Its prompt text equals the reviewed payload, and it carries
     the App Check token.
  4. The Privacy Ledger shows the call with the exact text, and the draft is marked CLOUD.
  5. Tests run on this device against the QNB file and a known phrase, and all pass.
  6. **Use this reader** adds the file with all its expected text, and the cloud call count
     stays at 1.
- **Gemini Nano states:** "unavailable", "downloadable" (a Wake button is shown but never clicked)
  and API missing. Each shows the right chip, and conversion works with NO AI badges.

## With Gemini Nano (optional, manual set-up)

Playwright cannot download Gemini Nano. Give it a Chrome user-data directory that already has it:

1. Close Chrome. In a terminal, run
   `"C:\Program Files\Google\Chrome\Application\chrome.exe" --user-data-dir=D:\chrome-nano-e2e`
2. In that window, open the Reopen demo and click **Wake on-device AI**. This downloads the model
   (several GB) once. Wait until the chip says **On-device AI ready**, then close that Chrome window.
3. Run `E2E_CHROME_PROFILE=D:\chrome-nano-e2e npm run test:e2e -- -g "Gemini Nano"`
   (PowerShell: `$env:E2E_CHROME_PROFILE='D:\chrome-nano-e2e'; npm run test:e2e -- -g "Gemini Nano"`).

The test runs headed. If the chip is not "On-device AI ready", it skips and says what the chip
shows. It checks ON DEVICE badges on the cards, that every shown reconstruction passed the
no-invention check, that no AI endpoint was called, and that no file content was sent.
Playwright's `--disable-component-update` and `--disable-field-trial-config` defaults are
switched off for this test, in case the on-device model needs them. **Not yet verified on a real
profile.**

## Honest limits

- The configured build's cloud traffic is answered by a mock, so the local suite verifies the
  app's own behaviour (gate, consent, ledger, App Check header, taint block, reader flow). It does
  not verify Firebase's real responses. Run `npm run test:e2e:hosted` after deploying for that.
- The File System Access folder picker (`showDirectoryPicker`) cannot be automated. The same code
  path after picking (zip expansion, the rescue run) is covered by the zip, drop and folder-input
  tests.
- `context.on('request')` sees page and Web Worker requests in Chromium (the self-check proves
  both). Service workers are blocked in the guard tests so their fetches can't hide anything.
