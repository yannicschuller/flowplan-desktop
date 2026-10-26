// Apple's on-device model in the running app, with the stand-in helper
// (test/fake-device-ai.mjs) in place of native/device-ai and the stand-in
// instance of test/stand-in.mjs: window.FlowplanDesktop.ai exists on the
// profile's own instance (not on another origin, not without a helper, not
// with the setting off), the helper starts on the first call only, answers,
// streams, reports errors with their code, and goes when the setting is
// switched off. FLOWPLAN_SCREENSHOTS=<dir> saves the settings page there.
// Usage: node test/device-ai-app.mjs (Linux without a display: xvfb-run)
import { _electron as electron } from "playwright";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import assert from "node:assert/strict";
import { standIn } from "./stand-in.mjs";

const require = createRequire(import.meta.url);
const root = new URL("..", import.meta.url).pathname;
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
async function until(test, what, timeout = 15000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const value = await test();
    if (value) return value;
    await sleep(150);
  }
  throw new Error(`timed out: ${what}`);
}
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const instance = await standIn();
const dir = mkdtempSync(join(tmpdir(), "flowplan-device-ai-"));
const helperLog = join(dir, "helper.log");
const starts = () => (existsSync(helperLog) ? readFileSync(helperLog, "utf8").split("\n").filter((l) => l.startsWith("start ")) : []);
const config = () => JSON.parse(readFileSync(join(dir, "config.json"), "utf8"));
writeFileSync(join(dir, "config.json"), JSON.stringify({ profiles: [{ id: "a1", name: "Work", server: instance.origin }], activeProfile: "a1", settings: { captureShortcut: null } }));
const launch = (helper) =>
  electron.launch({
    executablePath: require("electron"),
    args: [".", `--user-data-dir=${dir}`],
    cwd: root,
    env: { ...process.env, LANG: "en_US.UTF-8", FLOWPLAN_DEVICE_AI_HELPER: helper, FAKE_DEVICE_AI_LOG: helperLog },
  });
async function windowWith(app, test, timeout = 15000) {
  return until(async () => {
    for (const page of app.windows()) {
      if (page.isClosed()) continue;
      if (await page.evaluate(test).catch(() => false)) return page;
    }
    return null;
  }, String(test), timeout);
}
const clickMenu = (app, id) => app.evaluate(({ Menu }, id) => Menu.getApplicationMenu().getMenuItemById(id).click(), id);
// A call of the bridge in the page; an error comes back with its code.
const call = (page, script) =>
  page.evaluate(
    (script) =>
      new Function(`return (${script})`)()
        .then((value) => ({ value }))
        .catch((e) => ({ error: { isError: e instanceof Error, code: e.code, message: e.message } })),
    script,
  );

let app = await launch("test/fake-device-ai.mjs");
let main = await windowWith(app, () => !!document.getElementById("editor"));

// The bridge is there, frozen, version 1 – and nothing has started yet.
{
  const shape = await main.evaluate(() => ({
    platform: window.FlowplanDesktop.platform,
    keys: Object.keys(window.FlowplanDesktop.ai).sort(),
    version: window.FlowplanDesktop.ai.version,
    frozen: Object.isFrozen(window.FlowplanDesktop) && Object.isFrozen(window.FlowplanDesktop.ai),
    spelling: typeof window.FlowplanDesktop.spelling.check("Flowplan").misspelled,
  }));
  assert.deepEqual(shape, { platform: "desktop", keys: ["availability", "cancel", "generate", "stream", "version"], version: 1, frozen: true, spelling: "boolean" });
  await main.evaluate(() => {
    try {
      window.FlowplanDesktop.ai = null;
    } catch {}
  });
  assert.equal(await main.evaluate(() => typeof window.FlowplanDesktop.ai), "object", "the page cannot replace it");
  await sleep(500);
  assert.deepEqual(starts(), [], "no helper before the first call");
  console.log("✔ window.FlowplanDesktop.ai da, Helfer noch nicht gestartet");
}

// Answers, a stream, errors with their codes.
{
  assert.deepEqual(await call(main, "window.FlowplanDesktop.ai.availability()"), { value: { available: true, languages: ["de", "en", "fr"] } });
  assert.equal(starts().length, 1, "started by the first call");
  assert.deepEqual(await call(main, `window.FlowplanDesktop.ai.generate({ id: "g1", prompt: "Hallo", instructions: "kurz" })`), { value: { text: "[kurz] echo: Hallo" } });
  assert.deepEqual(
    await call(main, `window.FlowplanDesktop.ai.generate({ id: "g2", prompt: "Plan", schema: { type: "object", properties: { title: { type: "string" }, done: { type: "boolean" } }, required: ["title", "done"] } })`),
    { value: { json: { title: "text", done: true } } },
  );
  const streamed = await main.evaluate(async () => {
    const chunks = [];
    const result = await window.FlowplanDesktop.ai.stream({ id: "s1", prompt: "eins zwei" }, (text) => chunks.push(text));
    return { result, chunks };
  });
  assert.deepEqual(streamed, { result: { text: "echo: eins zwei" }, chunks: ["echo:", "echo: eins", "echo: eins zwei"] });
  const guardrail = await call(main, `window.FlowplanDesktop.ai.generate({ id: "g3", prompt: "guardrail" })`);
  assert.equal(guardrail.error.isError, true);
  assert.equal(guardrail.error.code, "guardrail");
  assert.match(guardrail.error.message, /declined/);
  assert.equal((await call(main, `window.FlowplanDesktop.ai.generate({ id: "g4", prompt: "x".repeat(30000) })`)).error.code, "context-too-long");
  assert.equal((await call(main, `window.FlowplanDesktop.ai.generate({ id: "g5", prompt: "x", schema: { type: "object", properties: { a: { type: "date" } } } })`)).error.code, "error");
  assert.equal((await call(main, `window.FlowplanDesktop.ai.generate({ id: "bad id", prompt: "x" })`)).error.code, "error");
  assert.equal((await call(main, `window.FlowplanDesktop.ai.generate({ id: "g7", prompt: 5 })`)).error.code, "error");
  assert.equal((await call(main, `window.FlowplanDesktop.ai.stream({ id: "g6", prompt: "x", schema: { type: "string" } }, () => {})`)).error.code, "error", "a stream takes no schema");
  // Busy while a stream runs; cancel by id ends it.
  const busy = await main.evaluate(async () => {
    const ai = window.FlowplanDesktop.ai;
    const chunks = [];
    const slow = ai.stream({ id: "slow-1", prompt: "slow" }, (t) => chunks.push(t)).catch((e) => ({ code: e.code }));
    await new Promise((r) => setTimeout(r, 200));
    const second = await ai.generate({ id: "g8", prompt: "Hallo" }).catch((e) => ({ code: e.code }));
    ai.cancel("slow-1");
    return { second, slow: await slow, chunks: chunks.length };
  });
  assert.equal(busy.second.code, "busy");
  assert.equal(busy.slow.code, "cancelled");
  assert.ok(busy.chunks >= 1 && busy.chunks < 10, "chunks until the cancel");
  assert.equal(starts().length, 1, "still the one helper");
  console.log("✔ Antworten, Stream, Fehler mit Code, beschäftigt, abbrechen");
}

// Another origin in the profile's session – even with a preload told it is
// the instance – gets no `ai`: main.js checks the frame itself.
{
  const other = instance.origin.replace("localhost", "127.0.0.1");
  const id = await app.evaluate(({ BrowserWindow, app }, other) => {
    const w = new BrowserWindow({ show: false, webPreferences: { preload: `${app.getAppPath()}/preload.js`, partition: "persist:profile-a1", contextIsolation: true, sandbox: true, additionalArguments: [`--flowplan-instance=${other}`] } });
    void w.loadURL(other);
    return w.webContents.id;
  }, other);
  const page = await windowWith(app, () => location.hostname === "127.0.0.1" && !!document.getElementById("editor"));
  assert.equal(await page.evaluate(() => window.FlowplanDesktop?.platform), "desktop", "the preload was fooled");
  assert.equal(await page.evaluate(() => typeof window.FlowplanDesktop.ai), "undefined", "main.js was not");
  await app.evaluate(({ webContents }, id) => webContents.fromId(id).close(), id);
  console.log("✔ Keine KI für einen anderen Ursprung");
}

// The settings: the switch, the availability line; off stops the helper,
// and pages loaded afterwards have no `ai`.
{
  await clickMenu(app, "settings");
  const settings = await windowWith(app, () => location.pathname.endsWith("settings.html") && !!document.getElementById("deviceAi"));
  await settings.waitForFunction(() => document.getElementById("device-ai-status").textContent.startsWith("Available"));
  assert.equal(await settings.isVisible("#device-ai"), true);
  assert.equal(await settings.isChecked("#deviceAi"), true, "on by default");
  assert.match(await settings.textContent("#device-ai h2"), /optional/i);
  if (process.env.FLOWPLAN_SCREENSHOTS) {
    await settings.setViewportSize({ width: 560, height: 960 });
    await settings.screenshot({ path: join(process.env.FLOWPLAN_SCREENSHOTS, "settings-device-ai.png"), fullPage: true });
  }
  const pid = Number(starts().at(-1).split(" ")[1]);
  assert.ok(alive(pid));
  await settings.uncheck("#deviceAi");
  await until(() => config().settings.deviceAi === false, "saved off");
  await settings.waitForFunction(() => document.getElementById("device-ai-status").textContent.startsWith("Off"));
  await until(() => !alive(pid), "helper stopped when switched off");
  if (process.env.FLOWPLAN_SCREENSHOTS) await settings.screenshot({ path: join(process.env.FLOWPLAN_SCREENSHOTS, "settings-device-ai-off.png"), fullPage: true });
  // The page loaded before still has the object, but nothing answers.
  assert.equal((await call(main, `window.FlowplanDesktop.ai.generate({ id: "o1", prompt: "Hallo" })`)).error.code, "unavailable");
  assert.deepEqual(await call(main, "window.FlowplanDesktop.ai.availability()"), { value: { available: false } });
  await main.reload();
  await main.waitForSelector("#editor");
  assert.equal(await main.evaluate(() => typeof window.FlowplanDesktop.ai), "undefined", "gone after reloading");
  assert.equal(await main.evaluate(() => window.FlowplanDesktop.platform), "desktop", "the rest of the bridge stays");
  const before = starts().length;
  await sleep(500);
  assert.equal(starts().length, before, "nothing started with the setting off");
  // On again: back after reloading.
  await settings.check("#deviceAi");
  await until(() => config().settings.deviceAi === true, "saved on");
  await main.reload();
  await main.waitForSelector("#editor");
  assert.equal(await main.evaluate(() => typeof window.FlowplanDesktop.ai), "object");
  await settings.close();
  console.log("✔ Einstellung: Schalter, Zustand, aus beendet den Helfer");
}
await app.close();

// Without a helper (Windows, Linux, a Mac build without it): no `ai`, no
// section in the settings.
{
  app = await launch("off");
  main = await windowWith(app, () => !!document.getElementById("editor"));
  assert.equal(await main.evaluate(() => window.FlowplanDesktop.platform), "desktop");
  assert.equal(await main.evaluate(() => "ai" in window.FlowplanDesktop), false);
  await clickMenu(app, "settings");
  const settings = await windowWith(app, () => location.pathname.endsWith("settings.html") && !!document.getElementById("deviceAi"));
  await settings.waitForFunction(() => document.getElementById("version").textContent !== "");
  assert.equal(await settings.isVisible("#device-ai"), false);
  await app.close();
  console.log("✔ Ohne Helfer keine KI");
}
await instance.stop();
console.log("device-ai-app: ok");
