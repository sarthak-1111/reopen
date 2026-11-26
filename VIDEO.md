# Reopen: demo video script (2:50)

> **DRAFT for checkpoint 3.** Record in English, at 1080p, in desktop Chrome with Gemini Nano downloaded.
> Upload publicly to YouTube. The rules allow 3:00 at most; this script targets 2:50.
> Every shot uses only the self-made sample files in `samples/`. Show no real personal files, no API keys, and no
> console tokens (close DevTools before recording, except in shot 3).

## Before recording

1. Clear the browser state for the demo site (or use a fresh profile that has Gemini Nano downloaded).
2. Open the demo once while online so the service worker caches it.
3. Put `samples/old-folder/` on the desktop, and keep `docs/specs/quillstone-notebook-qnb.md` ready.
4. Turn off notifications. Zoom the browser to 110%.

## Script

| Time | On screen | Narration |
|---|---|---|
| **0:00–0:10** | A desktop folder named "old-folder". Try to open two files with the computer's default apps. Show only what actually happens on the recording PC (an error, or garbage text). _[verify: pick files that really fail there, e.g. `STATUS.DOC` or `LEDGER.DAT`; don't stage it]_ | "This is a folder from an old computer. Letters, budgets, notes. Nothing opens them anymore." |
| **0:10–0:25** | Reopen in Chrome. The header reads "On-device AI ready", "0 files processed on this device", "0 cloud calls". Drag the folder onto the drop zone. | "Reopen brings them back. I drop the folder in, and everything happens inside this browser tab." |
| **0:25–0:50** | Cards fill in. Zoom in on the Shift_JIS note: readable Japanese, a proposed name, a two-line summary, and the **ON DEVICE** badge. Then the WordPerfect file renamed `.DOC`: "Detected from the bytes inside the file, not from its name." | "Each file is recognised from its bytes, not its extension, and converted to Word, Markdown or a spreadsheet. Gemini Nano runs on my laptop through Firebase AI Logic. It names and summarises each file, and the badge comes straight from the SDK." |
| **0:50–1:00** | Pan to the header counter: **0 cloud calls**. Click **Download everything (.zip)** and open the catalogue `index.html`. | "Fourteen of fifteen files rescued, zero cloud calls, and a tidy catalogue to keep." _[verify the count on the recording]_ |
| **1:00–1:30** | Turn Wi-Fi off (show the OS indicator). Click **Start over** and drop the folder again. Cards fill in again, with ON DEVICE badges. | "Wi-Fi off. It still works: the app is cached, and Nano doesn't need the network. Your files were never going anywhere." |
| **1:30–1:45** | Wi-Fi back on. Scroll to the `GARDEN.QNB` card: "No files could be produced from this one." Open **Unknown format?** and load the public spec `quillstone-notebook-qnb.md`. | "One file is in a format nobody knows. This is where the cloud helps, but only with public documentation." |
| **1:45–2:00** | Click **Review what will be sent**. The dialog shows **exactly** the text, with "Never sent: your files". Tick the box and click **Send to cloud Gemini**. The Privacy Ledger gets an entry and the counter becomes **1 cloud call**. | "Before anything leaves, I see exactly what will be sent. My files are never part of it, and the code blocks any request that contains their bytes." |
| **2:00–2:10** | The drafted reader appears (data, not code). Add the three `.qnb` files from `samples/mystery/` and click **Run tests on this computer**: green checks. Click **Use this reader**: the `.qnb` notes open with a **CLOUD**-drafted reader running locally. | "Gemini drafts a reader as data, not code. It's tested here, on my files, and the files open." |
| **2:10–2:25** | Open the **Privacy Ledger**: one entry with the exact payload and the time. | "The Privacy Ledger shows every cloud call, word for word. This session made one." |
| **2:25–2:35** | A WordPerfect card: the **Raw recovered text** next to **Reconstructed paragraphs**. Caption: "Every word must exist in the original". | "Nano may only reorder and clean up what was recovered. If it adds a single word, code rejects it and shows the raw text. A property test enforces that." |
| **2:35–2:50** | The hero line on screen, then the repo URL and demo URL. | "Reopen. Drop in a folder from an old computer. Your files come back, readable, and nothing leaves your laptop. Built with Firebase AI Logic, App Check and Remote Config." |

## Checks before publishing

- [ ] Every claim in the narration was shown on screen in this recording.
- [ ] Runtime is 2:50 or less.
- [ ] Nothing personal or secret is visible: no tokens, no email addresses, no real files.
- [ ] No third-party logos or trademarks in the video beyond plain format names.
- [ ] _[verify]_ The researcher segment (1:30–2:10) works on the hosted demo. If the real cloud call doesn't produce a passing reader, re-script that segment honestly rather than staging it.
