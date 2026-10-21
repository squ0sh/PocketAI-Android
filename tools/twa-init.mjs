#!/usr/bin/env node
// Generates the Trusted Web Activity (Bubblewrap) Android project for the
// Pocket AI Android port.
//
// The interactive `bubblewrap init` is unusable in a script (it always asks
// questions), so this does the same job deterministically: read the hosted
// web manifest, pin the Android-specific fields, and write the Gradle
// project next to it.
//
// Usage:  node tools/twa-init.mjs
//
// Needs a JDK 17 and the Android SDK (see docs/ANDROID-ACCEPTANCE.md).

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { TwaGenerator, TwaManifest, ConsoleLog } from "@bubblewrap/core";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const targetDirectory = join(root, "twa");

const HOST = "pocket-ai-android.web.app";
const PACKAGE_ID = "app.pocketai.android";
const APP_NAME = "Pocket AI";
const LAUNCHER_NAME = "Pocket AI";
const KEYSTORE = join(targetDirectory, "keystore.jks");
const KEY_ALIAS = "pocketai-android";
const WEB_MANIFEST = `https://${HOST}/manifest.webmanifest`;

mkdirSync(targetDirectory, { recursive: true });

const manifest = await TwaManifest.fromWebManifest(WEB_MANIFEST);
manifest.host = HOST;
manifest.fullScopeUrl = `https://${HOST}/`;
manifest.startUrl = "/";
manifest.name = APP_NAME;
manifest.launcherName = LAUNCHER_NAME;
manifest.packageId = PACKAGE_ID;
manifest.appVersionCode = 1;
manifest.appVersionName = "1";
manifest.display = "standalone";
manifest.orientation = "default";
// androidbrowserhelper requires API 24 (Android 7.0) as a minimum.
manifest.minSdkVersion = 24;
// The app never asks for notifications; do not request the permission.
manifest.enableNotifications = false;
// The APK is sideloaded, so no Play Store track.
manifest.fallbackType = "customtabs";
manifest.signingKey = { path: KEYSTORE, alias: KEY_ALIAS };
manifest.generatorApp = "bubblewrap";

const manifestFile = join(targetDirectory, "twa-manifest.json");
await manifest.saveToFile(manifestFile);

const generator = new TwaGenerator();
const log = new ConsoleLog("TWA");
await generator.createTwaProject(targetDirectory, manifest, log, () => {});

// The checksum lets `bubblewrap build` notice manifest changes instead of
// silently building a stale project.
const checksum = createHash("sha1")
  .update(readFileSync(manifestFile))
  .digest("hex");
writeFileSync(join(targetDirectory, "manifest-checksum.txt"), checksum);

console.log(`TWA project written to ${targetDirectory}`);
console.log(`  package: ${PACKAGE_ID}`);
console.log(`  host:    ${HOST}`);
