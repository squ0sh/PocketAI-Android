#!/usr/bin/env node
// Builds the signed Android APK from the TWA project.
//
// The signing password lives in twa/keystore.properties (git-ignored). It is
// passed to Bubblewrap through the environment so the build never asks a
// question.
//
// Usage:  node tools/twa-build.mjs
//
// Needs a JDK 17, the Android SDK, and @bubblewrap/cli.

import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const targetDirectory = join(root, "twa");
const properties = join(targetDirectory, "keystore.properties");

if (!existsSync(properties)) {
  console.error(
    `Missing ${properties}. Create a keystore first — see docs/ANDROID-ACCEPTANCE.md.`,
  );
  process.exit(1);
}

const read = (key) => {
  const line = readFileSync(properties, "utf8")
    .split("\n")
    .find((l) => l.startsWith(`${key}=`));
  return line ? line.slice(key.length + 1).trim() : "";
};

const keystorePassword = read("storePassword");
const keyPassword = read("keyPassword");
if (!keystorePassword || !keyPassword) {
  console.error(`${properties} must define storePassword and keyPassword.`);
  process.exit(1);
}

const bubblewrap = join(root, "node_modules", ".bin", "bubblewrap");
if (!existsSync(bubblewrap)) {
  console.error("Bubblewrap is not installed. Run: npm install");
  process.exit(1);
}

const child = spawn(bubblewrap, ["build"], {
  cwd: targetDirectory,
  stdio: "inherit",
  env: {
    ...process.env,
    BUBBLEWRAP_KEYSTORE_PASSWORD: keystorePassword,
    BUBBLEWRAP_KEY_PASSWORD: keyPassword,
  },
});

child.on("exit", (code) => process.exit(code ?? 1));
