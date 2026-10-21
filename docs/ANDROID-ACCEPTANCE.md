# Android acceptance checklist

Record the exact phone, Android version, Chrome version, app version, model and load source. No physical Android result is inferred from the automated Chromium tests.

The app is a Trusted Web Activity. It shows the site served from `pocket-ai-android.web.app`; the phone only trusts it when the signing fingerprint in `https://pocket-ai-android.web.app/.well-known/assetlinks.json` matches the APK. Check that first — a mismatch shows the site in a browser tab instead of as an installed app.

## 1. Install

1. Copy `twa/app-release-signed.apk` to the phone and open it.
2. Confirm the package is `app.pocketai.android` and the app name is **Pocket AI**.
3. Launch from the launcher. The app must open in its own window, with no browser address bar and no "Open in Chrome" prompt.

```sh
# Optional, with the phone connected and USB debugging on:
adb install -r twa/app-release-signed.apk
adb shell dumpsys package app.pocketai.android | grep -i versionName
```

## 2. Digital Asset Links

```sh
curl -s https://pocket-ai-android.web.app/.well-known/assetlinks.json
keytool -list -v -keystore twa/keystore.jks -alias pocketai-android -storepass "$STORE_PASSWORD" | grep SHA256
```

The SHA-256 fingerprint in the served `assetlinks.json` must match the certificate in the APK, upper-case with colons. A mismatch means the phone will not treat the app as the owner of the site.

## 3. Offline GGUF on a real phone

1. Open the app online with fresh website storage. Wait for offline readiness without loading a model. Save Bonsai 1.7B Q1_0 to Downloads and confirm it is downloaded onto the phone, not only in cloud storage.
2. Enable airplane mode, force-close the app, reopen it and select the GGUF. Verify successful generation, streamed output, Stop, retry and edit/resend.
3. Attach page text offline, ask a question, close and reopen the app, reselect the GGUF, and verify the reference and history survived. Search, export and delete the chat.
4. Try an oversized question and long reference. Verify a useful size error or visible excerpt notice; ensure the question is never silently dropped.
5. Cancel a file or network model load, choose another model, and verify progress belongs to the new attempt. Background and return during generation; verify either continued use or an actionable model-reload message.
6. Run Speed test and record measurements. Compare 4B/8B only on devices that can sustain their memory use; do not label 27B phone-compatible based on its offline assets.
7. Interrupt an app update before it finishes. Verify the previous version still opens offline and retains history. Finish the update online and verify the new version's readiness.

## 4. Devices without WebGPU

Run this on a phone that has WebGPU, to check the fallback path in a known-good device:

1. Open `https://pocket-ai-android.web.app/?nogpu=1` (or add `?nogpu=1` to the app's start URL while testing).
2. Verify the app explains that the browser has no WebGPU, greys out every local model, disables **Load from a file…**, and selects **Online Assist** by itself.
3. Verify the load button reads **Connect Online Assist** and that nothing is sent until you tap Send.
4. Reload without `?nogpu=1` and verify the local models are offered again.

On a real phone without WebGPU (Android 11 or older, or a GPU Chrome does not support), repeat steps 1–3 without the query string.

## 5. Online Assist

- With internet disabled, select Online Assist and verify that it requests connectivity without sending through a different runtime. Local GGUF mode must remain selectable.
- With internet enabled, verify a request to `/api/online-assist` returns a reply. **Note:** the shared Firebase project is on the free plan and currently has no deployed function, so this call returns `404` until the backend is deployed. Record that outcome rather than treating it as an app defect.
- Decline online fallback and verify no API request occurs.

## 6. Update in place

Rebuild the APK with the same keystore, bump `appVersionCode`, install over the top and verify the app updates without losing chats.

| Device / Android | Chrome | Mode | Model | Offline load + chat | Background recovery | Version / date |
| --- | --- | --- | --- | --- | --- | --- |
| Awaiting physical-device validation | — | — | — | Not yet measured | Not yet measured | v0.9.0 |

## Rebuilding the APK

```sh
# JDK 17 and the Android SDK must be on PATH.
export JAVA_HOME=/path/to/jdk-17
export ANDROID_SDK_ROOT=/path/to/android-sdk

npm install
npm run twa:init     # regenerate twa/ from the hosted web manifest
npm run twa:build    # build + sign -> twa/app-release-signed.apk
```

Requirements: JDK 17, Android SDK with `platforms;android-36`, `build-tools;36.1.0` and `platform-tools`.

The signing key lives in `twa/keystore.jks` and its password in `twa/keystore.properties`. Both are git-ignored. **Back them up somewhere safe** — without the keystore the installed app cannot be updated in place, and a phone may refuse the new APK. If the key is ever replaced, update `public/.well-known/assetlinks.json` with the new fingerprint and redeploy hosting, or the app will stop launching as a TWA.

## Deploying hosting

```sh
npm run build
npx firebase-tools deploy --only hosting:android --project pocket-ai-sovereign-aether
```

This repository deploys **hosting only**. It never deploys functions and never touches the `pocket-ai-iphone` site.

## Deploying the Online Assist backend (optional, separate)

The `onlineAssist` function needs the Firebase Blaze plan, because it reads `FREELLM_API_URL` and `FREELLM_API_KEY` from Secret Manager.

```sh
firebase functions:secrets:set FREELLM_API_URL
firebase functions:secrets:set FREELLM_API_KEY
firebase deploy --only functions:onlineAssist
```

The hosting rewrite already points `/api/online-assist` at that function, so no client or hosting change is needed afterwards. Deploy it from the repository that owns the backend (the iPhone project) so the two sites keep a single backend.
