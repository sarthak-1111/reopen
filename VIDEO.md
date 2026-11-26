# Reopen: demo video (2:47)

The video is 2:47.3 at 1920×1080 and 30 fps, with an English voice-over and burned-in English captions that use the same words.
It is on YouTube at https://youtu.be/yRxZcqVJTAw. It was recorded on 2026-11-26 from the real app with the v1.1 design
(commit `37ab87a`) in desktop Chrome 156 with Gemini Nano. Playwright drove a
dedicated Chrome profile; DevTools was never open. Every file shown is a self-made sample from `samples/` (see
`SAMPLES.md`).

## What is shown

| Time | On screen | Narration |
|---|---|---|
| 0:00–0:10 | A card listing the 15 sample files with their real sizes. Three of them are shown as their real first bytes decoded the naive way (Windows-1252), labelled as such. | "A folder from an old computer. Fifteen files. Read the naive way, they look like this." |
| 0:10–0:30 | Reopen in Chrome, "On-device AI ready". **Try the sample folder**. Cards fill in, each summary marked **ON DEVICE** (sped up 4×, real time 44 s, shown on screen). "Finished: 14 of 15 files rescued on this device. Cloud calls: 0." | "Reopen brings them back, right in the browser. I'll try the sample folder." / "Gemini Nano runs on this computer. It names and summarises each file, and every summary is marked ON DEVICE." / "14 of 15 rescued. Zero cloud calls." |
| 0:30–0:46 | The Shift_JIS note, now readable with a Japanese name. Then `STATUS.DOC`: "Format: WordPerfect document" and "Detected from the bytes inside the file, not from its name." | "Japanese text in Shift-JIS comes back readable, with a Japanese name." / "This one is called .DOC, but its bytes say WordPerfect. Formats are detected from the bytes, not the name." |
| 0:46–0:58 | **Download everything (.zip)**, then the `index.html` catalogue from that zip. | "Everything downloads as one zip, with a catalogue of every file." |
| 0:58–1:24 | "Ready offline", then the network is switched off (browser offline mode, labelled on screen). The chip reads "Offline: still working on this device". The same folder runs again with ON DEVICE badges (sped up 6×, real time 44 s): 14 of 15, 0 cloud calls. | "Now the network is off (browser offline mode). The app is cached, and Nano doesn't need the network." / "Same folder, same result: 14 of 15, all on this device." |
| 1:24–1:41 | The `GARDEN.QNB` card: "Not converted". **Unknown format?** loads the public spec. **Review what will be sent** shows exactly the text, with "Never sent: your files". | "One file stayed unknown: a notebook format Reopen can't read." / "The cloud can help, but only with public documentation. Before anything is sent, I see exactly what goes. My files never do." |
| 1:41–2:12 | Consent, then **Send to cloud Gemini**. The wait is sped up 4× (real time 9 s, shown on screen). "Draft reader for "Quillstone Notebook"", shown as data, not code. The three `samples/mystery/*.qnb` files are tested: "All tests passed on this computer." **Use this reader** adds three cards. | "Gemini drafts a reader for the format, as data, not code." / "It's tested here, on my files. Every check passes, and the three notebooks open." |
| 2:12–2:35 | The Privacy Ledger: "1 cloud call this session", "gemini-4-hydrogen · 5.5 KB · Sent", with the exact text opened. Then `STATUS.DOC` again: "Reconstructed paragraphs" (ON DEVICE), "No-invention check passed", and the raw recovered text below. | "The Privacy Ledger lists every cloud call, word for word. This session made one." / "Nano may only tidy what was recovered. A check confirms every word comes from the recovered text, and the raw text is right there." |
| 2:35–2:47 | The closing card: the tagline, https://reopen-751ea.web.app, https://github.com/sarthak-1111/reopen, and "Built with Firebase AI Logic (Gemini Nano on-device, Gemini in the cloud), App Check, Remote Config and Hosting." | "Reopen. Drop in a folder from an old computer. Your files come back, readable, and nothing leaves your laptop." |

## Honesty notes

- **Nothing is staged.**
  - Every result on screen came from the app during recording.
  - Exactly one cloud call was made, and no retry was needed.
- **Speed-ups.** The three long waits are sped up, each with an on-screen badge giving the real time:
  - rescue run: 4×, real time 44 s
  - offline run: 6×, real time 44 s
  - Gemini's draft: 4×, real time 9 s
  - Two short holds on a last frame (1.3 s and 1.6 s) have no badge.
  - The Gemini wait varies: other runs that day took from about 13 s to about 160 s.
- **"Network off" means browser offline mode**, not Wi-Fi off.
  - During that run the page made 8 requests, all answered by the service worker.
  - 4 App Check (reCAPTCHA) requests were attempted and failed. Nothing reached the network.
- **Recorded on local servers**, not the hosted demo:
  - the dev server, for the rescue and the researcher
  - a production build served locally, for the offline part, because the service worker is only in production builds
  - The same flows were checked on the hosted demo separately (`TESTING.md`).
- **The voice is synthetic.** It was generated locally with Bark (MIT). Each line was checked against a Whisper transcript.
- **Narration only claims what is on screen.**
  - Lines about the SDK badge source, the taint check and the property test were dropped, because the video doesn't show them. The repo documents them.
- **This is the second recording.** The first (2:44.9, recorded from the v1.0 design at `dd40177`) was replaced
  on 2026-11-26 after the v1.1 design pass, so the video matches the live site. It is still reachable, unlisted,
  at https://youtu.be/WDQdlzX-Ni4. The narration, captions and synthetic voice are the same; every line was checked
  again against the new recording, and only cut points changed in the edit.

## Checks before publishing

- [x] Every claim in the narration is shown on screen.
- [x] Runtime is under 3:00 (2:47.3).
- [x] Nothing personal or secret is visible: no tokens, no email addresses, no real files.
- [x] No third-party logos; product names appear as plain text only.
- [x] Uploaded to YouTube as **Public** (https://youtu.be/yRxZcqVJTAw, 2026-11-26), and the link added to the Devpost submission. The first upload (https://youtu.be/WDQdlzX-Ni4) is now unlisted.
