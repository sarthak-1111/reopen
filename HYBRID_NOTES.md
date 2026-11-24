# Hybrid inference notes (Firebase AI Logic, Web / Chrome)

Checked 2026-11-24. Only APIs that appear in the official Firebase docs are used.
Every API name below was also checked against the published typings of the pinned SDK
(`@firebase/ai@3.1.0/dist/ai-public.d.ts`, which ships with `firebase@13.4.0`).

Official pages used:
- https://firebase.google.com/docs/ai-logic/hybrid
- https://firebase.google.com/docs/ai-logic/hybrid/web/get-started
- https://firebase.google.com/docs/ai-logic/hybrid/web/configuration-options
- https://firebase.google.com/docs/ai-logic/hybrid/web/generate-structured-output
- https://firebase.google.com/docs/reference/js/ai.hybridparams
- https://firebase.google.com/docs/ai-logic/app-check
- https://firebase.google.com/docs/app-check/web/recaptcha-enterprise-provider
- https://firebase.google.com/docs/app-check/web/debug-provider
- https://firebase.google.com/docs/remote-config/web/get-started
- https://firebase.google.com/docs/hosting/reserved-urls
- https://firebase.google.com/docs/ai-logic/models (that fetch was truncated, so model IDs are checked again in the smoke test)
- https://developer.chrome.com/docs/ai/get-started and https://developer.chrome.com/docs/ai/prompt-api

## 1. SDK version

| What | Minimum (docs) |
|---|---|
| Hybrid / on-device inference on web | Firebase JS SDK **v12.5.0+**, Chrome desktop **139+** |
| `response.inferenceSource` | v12.5.0+ |
| Default cloud model when none is given | v13.0.0+ |
| App Check limited-use tokens (`useLimitedUseAppCheckTokens`) | v12.14.0+ |

**Pinned: `firebase@13.4.0`** (exact, no caret). It is the latest version on npm as of 2026-11-24, and it bundles `@firebase/ai@3.1.0`.
Import path: `firebase/ai`.

## 2. Inference modes

From the typings: `InferenceMode = { PREFER_ON_DEVICE: "prefer_on_device", ONLY_ON_DEVICE: "only_on_device", ONLY_IN_CLOUD: "only_in_cloud", PREFER_IN_CLOUD: "prefer_in_cloud" }`.

| Mode | Behaviour (docs) | While the on-device model is still downloading |
|---|---|---|
| `InferenceMode.PREFER_ON_DEVICE` | on-device if available, otherwise falls back to cloud | does not wait; uses the cloud |
| `InferenceMode.ONLY_ON_DEVICE` | on-device if available, otherwise **throws** | waits for the download, then runs on-device |
| `InferenceMode.PREFER_IN_CLOUD` | cloud if available, otherwise on-device | uses the cloud |
| `InferenceMode.ONLY_IN_CLOUD` | cloud if available, otherwise **throws** | uses the cloud |

Call shape: `getGenerativeModel(ai, modelParams: ModelParams | HybridParams, requestOptions?)`

```ts
import { getAI, getGenerativeModel, GoogleAIBackend, InferenceMode, InferenceSource, Schema } from 'firebase/ai';

const ai = getAI(app, { backend: new GoogleAIBackend() });              // Gemini Developer API
const model = getGenerativeModel(ai, {
  mode: InferenceMode.ONLY_ON_DEVICE,                                  // HybridParams.mode
  inCloudParams: { model: 'MODEL_ID', generationConfig: { /* … */ } },  // ModelParams
  onDeviceParams: { createOptions: { /* … */ }, promptOptions: { /* … */ } },
});
```

- `HybridParams = { mode: InferenceMode; inCloudParams?: ModelParams; onDeviceParams?: OnDeviceParams }`
- `OnDeviceParams = { createOptions?: LanguageModelCreateOptions; promptOptions?: LanguageModelPromptOptions }`

**Reopen's rule:** anything that touches file contents uses `ONLY_ON_DEVICE`, never `PREFER_ON_DEVICE`.
`PREFER_ON_DEVICE` would quietly send file text to the cloud whenever Nano is unavailable.
The format researcher, which only ever sends public documentation, uses `ONLY_IN_CLOUD`.

## 3. Warming up the on-device model

- `model.initializeDeviceModel(onDownloadProgress?: (progressValue: number) => void): Promise<void>`
  (typings; the docs say it "must be called" after a user interaction such as a click, and before any `generateContent()`).
- Chrome's own check: `await LanguageModel.availability()` returns `"unavailable" | "downloadable" | "downloading" | "available"`.
  When it returns `downloadable`, the download needs user activation (Chrome docs).

## 4. Structured JSON output

The docs say structured output (JSON and enums) works with both cloud and on-device models.

```ts
const schema = Schema.object({ properties: { summary: Schema.string(), documentType: Schema.string() } });

getGenerativeModel(ai, {
  mode: InferenceMode.ONLY_ON_DEVICE,
  onDeviceParams: { promptOptions: { responseConstraint: schema } },        // on-device
});
getGenerativeModel(ai, {
  mode: InferenceMode.ONLY_IN_CLOUD,
  inCloudParams: { model: 'MODEL_ID',
    generationConfig: { responseMimeType: 'application/json', responseSchema: schema } },  // cloud
});
const data = JSON.parse(result.response.text());   // we still validate it ourselves and retry
```

- Enums: `responseMimeType: 'text/x.enum'` plus `Schema.enumString({ enum: [...] })`.
- Helpers: `Schema.object`, `Schema.array`, `Schema.string`, `Schema.number`, `Schema.enumString`. A plain JSON Schema object is also accepted.

## 5. Where a response actually ran

- `result.response.inferenceSource` (on `EnhancedGenerateContentResponse`, optional, v12.5.0+).
- Typings: `InferenceSource = { ON_DEVICE: "on_device", IN_CLOUD: "in_cloud" }`. The values are lowercase strings.
  Compare against `InferenceSource.*`, not `"ON_DEVICE"`.
- Reopen's badges read only this field. A missing value is shown as "UNKNOWN".

## 6. Chrome on this workstation

Checked through the Claude in Chrome extension on 2026-11-24:
- Chrome 156.
- `LanguageModel` is present with **no chrome://flags enabled**.
- `availability()` returns `downloadable` for text in `en`, `ja`, `es`, `de` and `fr`.
- So the hardware qualifies, but the model is **not downloaded yet**. The download is one user click (see GO_NO_GO.md).

The Firebase docs also list `chrome://flags/#prompt-api-for-gemini-nano-multimodal-input`. Reopen sends text only, and the API is present without that flag here.

## 7. On-device limits that matter for Reopen

- On-device supports single-turn text and structured output, with a maximum of **9216 tokens**. Long documents must be chunked.
- Not supported on-device: multi-turn chat, PDFs/audio/video, function calling and other tools.
- AI monitoring in the Firebase console shows nothing for on-device calls, so our own counter and Privacy Ledger are the record.

## 8. Backend, App Check, Remote Config, Hosting

- Backend: Gemini Developer API (`new GoogleAIBackend()`), recommended in the docs for a no-cost start.
  The rules say Firebase AI Logic and Gemini Nano can be used at no cost on the free tier.
- App Check: AI Logic requires it. Firebase has enforced it automatically for every project since Nov 2, 2026.
  - Production web provider: `ReCaptchaEnterpriseProvider(siteKey)` from `firebase/app-check`, with `isTokenAutoRefreshEnabled: true`.
    The site key is created in Google Cloud (Security → reCAPTCHA, a "Web" key, checkbox challenge off). Never add `localhost` to it.
  - On the Spark plan only 5 score thresholds are available; that is enough for us.
  - Debug: set `self.FIREBASE_APPCHECK_DEBUG_TOKEN = true` before `initializeAppCheck`, copy the token from the console,
    then register it under App Check → Apps → ⋮ → Manage debug tokens.
    The docs say: do not commit it or ship it in production builds.
  - The rules say "debug tokens are accepted in submissions". We still ship reCAPTCHA Enterprise on the hosted demo and keep the debug token local.
- Remote Config (web): `getRemoteConfig(app)`, `remoteConfig.defaultConfig = {...}`, `remoteConfig.settings.minimumFetchIntervalMillis`,
  `fetchAndActivate(remoteConfig)`, `getValue(remoteConfig, key)`.
  The docs advise in-app defaults for every parameter because the app may be offline.
- Hosting config: the reserved URL `/__/firebase/init.json` is documented as "available only with version 8 and earlier" of the JS SDK.
  So Reopen injects the web config at build time from an untracked `.env.production.local` instead. It is public by design once deployed, but it is never committed.
