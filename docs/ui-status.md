# App UI shell: status

What the browser app does today, what was checked and how, and what is still open.
Written 2026-11-24 by the UI work stream. The AI layer is a stub (`src/ai/stub.ts`) until the
real one lands; everything below was checked with that stub, i.e. the "no on-device AI" path.

## Files

| Path | What it is |
| --- | --- |
| `index.html` | Page shell: hero, drop zone, library, Format researcher panel, Privacy Ledger, "Where each step runs" |
| `src/main.ts` | Entry: starts the app (batch size 4), connectivity chip, service worker |
| `src/ui/app.ts` | Controller: inputs → worker pool → AI (one at a time) → cards; counters; export |
| `src/ui/input.ts` | Folder picker (File System Access), folder `<input>`, drag-and-drop walk, zip, sample folder |
| `src/ui/filter.ts` | Skips system/hidden/temporary/empty/over-64 MB files; 2,000-file limit |
| `src/ui/pool.ts` | Module-worker pool, size = min(batch size, cores, 8) |
| `src/workers/rescue.worker.ts`, `protocol.ts` | Runs `rescueFile` off the main thread |
| `src/ui/rasterise.ts` | WMF/EMF → SVG (rtf.js) → canvas → PNG, main thread |
| `src/ui/view-model.ts` | Pure logic: labels, naming/de-duplication, previews, CSV preview parser, export file list |
| `src/ui/cards.ts` | Library cards: name, original path, format + evidence, encoding, level, badge, preview, AI area, raw text, reconstruction, downloads |
| `src/ui/ledger-panel.ts` | Privacy Ledger: every cloud call with the exact text sent; JSON export |
| `src/ui/nano-chip.ts` | On-device AI status chip + "Wake on-device AI" (download progress) |
| `src/ui/researcher-panel.ts` | **Placeholder** for the format researcher, mounted at `#format-researcher-root` |
| `src/ui/sw-register.ts`, `public/sw.js` | Offline app shell; "Ready offline" chip |
| `src/ui/styles.css` | Warm paper/ink theme, light and dark, reduced motion, 360 px+ |
| `src/ai/contract.ts`, `stub.ts`, `index.ts` | AI service interface the UI talks to; the stub reports "not set up" and never sends anything |
| `public/manifest.webmanifest`, `public/icon.svg` | Web app manifest and a self-made icon |
| `vite.config.ts` | Adds the app entry, ES-module workers, `__BUILD_ID__`, and emits `precache-manifest.json` |
| `tests/ui/*.test.ts` | 41 UI logic tests (filter, view-model, naming, CSV preview, export, pool size, metafile sizing, stub, sample-folder pipeline, precache list) |

## Checked, and how

All browser checks: `npm run build`, then `vite preview`, driven with playwright-cli in desktop
Chrome (headed, in-memory profile), with the stub AI.

| Check | Result |
| --- | --- |
| Sample folder ("Try the sample folder") | 15 files processed on this device, 14 produced files, `GARDEN.QNB` shown as "Not converted" with the core's hint; 0 cloud calls; 0 console errors or warnings |
| "Download everything (.zip)" | 31 entries: 29 files under `files/`, plus `index.html` and `RESCUE_REPORT.md`; non-ASCII names (Japanese, ’) carry the UTF-8 flag and decode correctly |
| Zip upload (file input) and dropping a zip on the drop zone | Same 15-file result; the drop zone highlights while dragging |
| Drop with only junk files (`.DS_Store`, empty file) | "Nothing to rescue: every file was a system, hidden or empty file.", 2 skipped |
| WMF → PNG, EMF → PNG | Self-made WMF (rectangle + ellipse) and EMF (rectangle) render with the expected colours at 512 px on the long side; garbage input returns nothing and the card says the picture could not be converted |
| Offline | Fresh profile: load once, go offline, reload, run the sample folder → works, 15 cards, "Offline: still working on this device". Same after an update from an older build |
| Layout | 1280 px light and dark, 360 px light: no horizontal scrolling; on phones only the counter bar stays pinned |
| Contrast | Every text/background token pair used, both themes: ≥ 4.5:1 (lowest 4.95:1); focus ring ≥ 5.28:1 |
| Keyboard | Tab order: skip link → home → Choose a folder → Upload a .zip → Try the sample folder → Source code; Enter starts the sample run |
| Tests | `npm test`: 11 files, 227 tests pass (186 core + 41 UI) |
| Build | `npm run build` passes (tsc strict + Vite 6.4.6) |
| Licences | `npm run licenses`: OK, no new dependencies added |

## Not checked yet

- The real folder picker (`showDirectoryPicker`) and dragging a real folder from the OS: both need a person and an OS dialog. The code paths are written; only zip/file drops were automated.
- The classic folder `<input webkitdirectory>` (shown only in browsers without the folder picker): not exercised.
- Every AI state: Nano "available/downloadable/downloading", the Wake button, summaries, AI names, the reconstruction panel with a passed or failed no-invention check, and a ledger with entries. These render from the contract types, but only the stub's "not set up" state was seen in a browser.
- Screen readers, Firefox and Safari: not tested.
- The sample folder does not exercise WMF/EMF: `MINUTES.RTF` embeds its picture as a 1×1 PNG (`\shppict`); its 2-byte WMF fallback sits in `\nonshppict`, which the core rightly skips.

## Notes for the AI layer

- Replace `getAiService()` in `src/ai/index.ts`; the UI only uses the `AiService` interface in `src/ai/contract.ts`.
- The UI calls `triage` for every file with readable text, and `reconstruct` only for `text-recovery` files, one call at a time.
- A reconstruction is used (and `(reconstructed).md/.docx` added) only when `mode === 'ai-structured'`, the no-invention check passed, and there is at least one block. Otherwise the card shows the raw recovered text and, for a failed check, says so.
- An AI-proposed name is used only when the insight's badge is not `NO_AI`; it is sanitised and de-duplicated.
- The cloud counter is `ledger().length`, refreshed through `onLedgerChange`.
- The format researcher mounts into `#format-researcher-root` and replaces `mountResearcherPlaceholder`.
- `batchSize` is passed to `startApp` in `src/main.ts`; wire Remote Config `batch_size` there.

## Observations outside the UI

- Spreadsheets are named after their header row (e.g. "Item, Quantity, Unit price, Total", and "… (2)" for a second file with the same header). That comes from the core's `proposeName`; a sheet title, or the original file name, may read better until AI naming is available.
