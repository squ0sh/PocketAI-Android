#!/usr/bin/env node
// Live-site smoke test for the Android port.
//
// Loads the deployed site in a real browser and checks the things that can
// only be checked on the deployed origin: the page boots, the model tiles
// render, the manifest is served as JSON, and the Digital Asset Links file
// answers.
//
// Usage:  node tools/live-check.mjs [url]

import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const url = process.argv[2] || "https://pocket-ai-android.web.app";
const failures = [];
const notes = [];

function chromiumName() {
  for (const name of ["google-chrome", "google-chrome-stable", "chrome", "chromium", "chromium-browser"]) {
    const res = spawn("which", [name], { encoding: "utf8" });
    if (res.status === 0 && res.stdout.trim()) return res.stdout.trim();
  }
  for (const p of ["/usr/bin/chromium", "/usr/lib/chromium/chromium", "/usr/bin/google-chrome"]) {
    if (existsSync(p)) return p;
  }
  return "";
}

// The Digital Asset Links file must be reachable over the deployed origin.
for (const [path, expect] of [
  ["/", "text/html"],
  ["/manifest.webmanifest", "application/manifest+json"],
  ["/.well-known/assetlinks.json", "application/json"],
]) {
  try {
    const res = await fetch(url + path);
    const type = res.headers.get("content-type") || "";
    if (!res.ok) failures.push(`${path} answered ${res.status}`);
    else if (!type.includes(expect)) failures.push(`${path} served "${type}", expected ${expect}`);
    else notes.push(`${path} → ${res.status} ${type}`);
  } catch (e) {
    failures.push(`${path} could not be fetched: ${e.message}`);
  }
}

const chrome = chromiumName();
if (!chrome) {
  console.log("  live: " + notes.join(" | "));
  notes.push("chromium not on PATH — browser boot probe skipped");
} else {
  const port = 9333;
  const profile = mkdtempSync(join(tmpdir(), "pa-live-chrome-"));
  const browser = spawn(chrome, [
    "--headless=new", "--no-sandbox", "--disable-dev-shm-usage", "--no-first-run", "--no-default-browser-check",
    `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "about:blank",
  ], { stdio: ["ignore", "ignore", "pipe"] });
  let browserError = "";
  browser.stderr.on("data", (c) => { browserError = (browserError + c).slice(-2000); });
  try {
    const version = await (async () => {
      for (let i = 0; i < 60; i++) {
        try {
          const v = await fetch(`http://127.0.0.1:${port}/json/version`).then((r) => r.json());
          if (v) return v;
        } catch {}
        await new Promise((r) => setTimeout(r, 250));
      }
      return null;
    })();
    if (!version) {
      failures.push("live: browser did not expose CDP: " + browserError);
    } else {
      const ws = new WebSocket(version.webSocketDebuggerUrl);
      await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
      let msgId = 0;
      const pending = new Map();
      const send = (method, params = {}) => new Promise((res) => { const id = ++msgId; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
      ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); } };
      const { targetId } = await send("Target.createTarget", { url: "about:blank" });
      const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
      const tab = (method, params = {}) => new Promise((res) => { const id = ++msgId; pending.set(id, res); ws.send(JSON.stringify({ id, method, params, sessionId })); });
      const ev = async (expression, awaitPromise = false) => {
        const r = await tab("Runtime.evaluate", { expression, awaitPromise, returnByValue: true });
        if (r.exceptionDetails) throw new Error("Eval failed: " + JSON.stringify(r.exceptionDetails).slice(0, 400));
        return r.result?.value;
      };
      await tab("Page.enable");
      await tab("Page.addScriptToEvaluateOnNewDocument", {
        source: "window.__errs=[];addEventListener('error',e=>window.__errs.push(String(e.message)));addEventListener('unhandledrejection',e=>window.__errs.push('rejection: '+String(e.reason)));",
      });
      await tab("Page.navigate", { url });
      let booted = false;
      for (let i = 0; i < 120; i++) {
        const ok = await ev("document.querySelectorAll('.model-option').length > 0").catch(() => false);
        if (ok) { booted = true; break; }
        await new Promise((r) => setTimeout(r, 250));
      }
      if (!booted) {
        failures.push("live: the deployed app did not render model tiles");
      } else {
        const errs = await ev("window.__errs.join(' | ')");
        if (errs) failures.push("live: boot errors — " + String(errs).slice(0, 300));
        const title = await ev("document.title");
        const tiles = await ev("document.querySelectorAll('.model-option').length");
        notes.push(`app booted at ${url} — "${title}", ${tiles} model tile(s)`);

        // The no-WebGPU fallback must work on the deployed origin too.
        await tab("Page.navigate", { url: url + "/?nogpu=1" });
        let fellBack = false;
        for (let i = 0; i < 80; i++) {
          const ok = await ev("document.querySelectorAll('.model-option').length > 0 && !document.querySelector('#capabilityNotice').hidden").catch(() => false);
          if (ok) { fellBack = true; break; }
          await new Promise((r) => setTimeout(r, 250));
        }
        if (!fellBack) {
          failures.push("live: the deployed app did not report a missing GPU with ?nogpu=1");
        } else {
          const state = JSON.parse(await ev(`JSON.stringify({
            disabled: [...document.querySelectorAll('.model-option')].filter(b => b.disabled).length,
            selected: document.querySelector('#modelButton').textContent,
          })`));
          if (!state.disabled) failures.push("live: local models stayed selectable without a GPU");
          if (!/Online/i.test(state.selected)) failures.push(`live: Online Assist was not selected automatically (${state.selected})`);
          else notes.push(`fallback on the live site — ${state.disabled} local model(s) disabled, "${state.selected}" selected`);
        }
      }
    }
  } catch (e) {
    failures.push("live: " + e.message);
  } finally {
    try { browser.kill("SIGKILL"); } catch {}
    try { rmSync(profile, { recursive: true, force: true }); } catch {}
  }
}

console.log("  live: " + notes.join(" | "));
if (failures.length) {
  console.error("✖ live check failed:\n");
  for (const f of failures) console.error("  - " + f);
  process.exit(1);
}
console.log("✔ live check passed");
