// Apple's on-device model (device-ai-rules.js, device-ai.js) with Node
// alone, against the stand-in helper test/fake-device-ai.mjs: which helper
// runs where, what a page may ask (types, sizes, schema depth), what the
// helper may answer, and the process – started on the first request only,
// streamed, cancelled, busy, restarted after a crash with a pause, stopped
// after a timeout and when idle, and switched off. The bridge's origin
// checks are read from preload.js and main.js.
// Usage: node test/device-ai.mjs
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const root = new URL("..", import.meta.url).pathname;
const rules = require("../device-ai-rules.js");
const { createDeviceAi } = require("../device-ai.js");
const { AiError, checkRequest, helperSchema, helperMessage, availabilityOf, answerOf, errorOf, restartDelay, helperCommand, LIMITS } = rules;
const fake = join(root, "test", "fake-device-ai.mjs");
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const rejects = (promise, code) => assert.rejects(promise, (e) => e instanceof AiError && e.code === code);
const throwsCode = (fn, code) => assert.throws(fn, (e) => e instanceof AiError && e.code === code);
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
async function until(test, what, timeout = 5000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const value = await test();
    if (value) return value;
    await sleep(25);
  }
  throw new Error(`timed out: ${what}`);
}

// Which helper runs where.
{
  const exists = (file) => file.endsWith("/MacOS/device-ai") || file.endsWith("fake.mjs") || file.endsWith("/bin/helper");
  const base = { appDir: "/app", execPath: "/electron", exists };
  const app = { ...base, execPath: "/Applications/Flowplan.app/Contents/MacOS/Flowplan" };
  assert.deepEqual(helperCommand({ ...app, platform: "darwin", packaged: true }), { command: "/Applications/Flowplan.app/Contents/MacOS/device-ai", args: [], env: {} }, "next to the app's executable");
  assert.equal(helperCommand({ ...app, platform: "darwin", packaged: true, exists: () => false }), null, "a build without the helper");
  assert.equal(helperCommand({ ...app, platform: "win32", packaged: true }), null, "only macOS carries one");
  assert.equal(helperCommand({ ...app, platform: "linux", packaged: true }), null);
  assert.equal(helperCommand({ ...app, platform: "darwin", packaged: true, env: { FLOWPLAN_DEVICE_AI_HELPER: "/tmp/fake.mjs" } }).command, "/Applications/Flowplan.app/Contents/MacOS/device-ai", "the packaged app takes no other helper");
  assert.equal(helperCommand({ ...base, platform: "linux", packaged: false }), null, "npm start on Linux: none");
  assert.deepEqual(helperCommand({ ...base, platform: "linux", packaged: false, env: { FLOWPLAN_DEVICE_AI_HELPER: "test/fake.mjs" } }), { command: "/electron", args: ["/app/test/fake.mjs"], env: { ELECTRON_RUN_AS_NODE: "1" } });
  assert.deepEqual(helperCommand({ ...base, platform: "linux", packaged: false, env: { FLOWPLAN_DEVICE_AI_HELPER: "/bin/helper" } }), { command: "/bin/helper", args: [], env: {} });
  assert.equal(helperCommand({ ...base, platform: "linux", packaged: false, env: { FLOWPLAN_DEVICE_AI_HELPER: "/missing" } }), null);
  assert.equal(helperCommand({ ...base, platform: "darwin", packaged: false, env: { FLOWPLAN_DEVICE_AI_HELPER: "off" } }), null);
  assert.equal(helperCommand({ ...base, platform: "darwin", packaged: false, exists: (f) => f === "/app/native/device-ai/.build/release/device-ai" }).command, "/app/native/device-ai/.build/release/device-ai", "npm start on a Mac: the helper built in native/device-ai");
  console.log("✔ Helfer nur im Mac-Build (und für Tests)");
}

// What a page may ask.
{
  const ok = { id: "r1", prompt: "Summarise" };
  assert.deepEqual(checkRequest(ok, "generate"), { id: "r1", prompt: "Summarise" });
  assert.deepEqual(checkRequest({ ...ok, instructions: "Be brief", temperature: 0.4, maxTokens: 200 }, "stream"), { id: "r1", prompt: "Summarise", instructions: "Be brief", temperature: 0.4, maxTokens: 200 });
  assert.deepEqual(checkRequest({ ...ok, instructions: "  ", temperature: null, maxTokens: undefined }, "generate"), ok, "empty values fall away");
  for (const bad of [null, "text", [], { prompt: "x" }, { id: "", prompt: "x" }, { id: "a b", prompt: "x" }, { id: "x".repeat(129), prompt: "x" }, { id: 7, prompt: "x" }, { id: "a", prompt: "" }, { id: "a", prompt: "   " }, { id: "a", prompt: 5 }])
    throwsCode(() => checkRequest(bad, "generate"), "error");
  throwsCode(() => checkRequest({ ...ok, instructions: 4 }, "generate"), "error");
  throwsCode(() => checkRequest({ ...ok, temperature: 3 }, "generate"), "error");
  throwsCode(() => checkRequest({ ...ok, temperature: Number.NaN }, "generate"), "error");
  throwsCode(() => checkRequest({ ...ok, temperature: "0.2" }, "generate"), "error");
  throwsCode(() => checkRequest({ ...ok, maxTokens: 0 }, "generate"), "error");
  throwsCode(() => checkRequest({ ...ok, maxTokens: 1.5 }, "generate"), "error");
  throwsCode(() => checkRequest({ ...ok, maxTokens: LIMITS.maxTokens + 1 }, "generate"), "error");
  throwsCode(() => checkRequest({ ...ok, prompt: "x".repeat(LIMITS.prompt + 1) }, "generate"), "context-too-long");
  throwsCode(() => checkRequest({ ...ok, instructions: "x".repeat(LIMITS.instructions + 1) }, "generate"), "context-too-long");
  throwsCode(() => checkRequest({ ...ok, schema: { type: "string" } }, "stream"), "error", "stream takes no schema");
  throwsCode(() => checkRequest(ok, "delete"), "error");
  console.log("✔ Anfragen geprüft: Typen und Größen");
}

// The schema subset, in the helper's own form.
{
  const schema = {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    additionalProperties: false,
    properties: {
      title: { type: "string", description: "A short title" },
      priority: { enum: ["low", "high", "low"] },
      tags: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 5 },
      estimate: { type: "number" },
      count: { type: "integer" },
      done: { type: "boolean" },
      steps: { type: "array", items: { type: "object", properties: { text: { type: "string" } }, required: ["text"] } },
    },
    required: ["title", "priority"],
  };
  const out = helperSchema(schema);
  assert.deepEqual(
    out.properties.map((p) => [p.name, p.optional]),
    [["title", false], ["priority", false], ["tags", true], ["estimate", true], ["count", true], ["done", true], ["steps", true]],
    "properties keep their order, required → not optional",
  );
  assert.equal(out.properties[0].description, "A short title");
  assert.deepEqual(out.properties[1].schema, { enum: ["low", "high"] });
  assert.deepEqual(out.properties[2].schema, { type: "array", items: { type: "string" }, minItems: 1, maxItems: 5 });
  assert.ok(!("$schema" in out) && !("additionalProperties" in out), "unknown keywords fall away");
  let deep = { type: "string" };
  for (let i = 0; i < LIMITS.schemaDepth; i++) deep = { type: "array", items: deep };
  throwsCode(() => helperSchema(deep), "error", "too deep");
  let fits = { type: "string" };
  for (let i = 0; i < LIMITS.schemaDepth - 1; i++) fits = { type: "array", items: fits };
  assert.ok(helperSchema(fits));
  const wide = { type: "object", properties: Object.fromEntries(Array.from({ length: LIMITS.properties + 1 }, (_, i) => [`p${i}`, { type: "string" }])) };
  throwsCode(() => helperSchema(wide), "error", "too many properties");
  const many = { type: "object", properties: Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`p${i}`, { type: "object", properties: Object.fromEntries(Array.from({ length: 5 }, (_, j) => [`q${j}`, { type: "string" }])) }])) };
  throwsCode(() => helperSchema(many), "error", "too many nodes");
  for (const bad of [null, [], "string", { type: "null" }, { type: "string", enum: [1] }, { enum: [] }, { type: "number", enum: ["a"] }, { type: "object", properties: {} }, { type: "object", properties: { a: { type: "string" } }, required: "a" }, { type: "array" }, { type: "array", items: { type: "string" }, minItems: 3, maxItems: 1 }, { type: "array", items: { type: "string" }, maxItems: -1 }, { anyOf: [{ type: "string" }] }, { type: "string", description: 5 }, { type: ["string", "null"] }])
    throwsCode(() => helperSchema(bad), "error", JSON.stringify(bad));
  console.log("✔ Schema-Teilmenge, Tiefe und Größe begrenzt");
}

// What the helper may answer.
{
  assert.equal(helperMessage("not json"), null);
  assert.equal(helperMessage('{"type":"done"}'), null, "no id");
  assert.equal(helperMessage('{"id":"1","type":"exec"}'), null, "unknown type");
  assert.equal(helperMessage("[1]"), null);
  assert.deepEqual(helperMessage('{"id":"1","type":"done","text":"x"}'), { id: "1", type: "done", text: "x" });
  assert.deepEqual(availabilityOf({ available: true, languages: ["de", "en", "<b>"] }), { available: true, languages: ["de", "en"] });
  assert.deepEqual(availabilityOf({ available: false, reason: "model-not-ready" }), { available: false, reason: "model-not-ready" });
  assert.deepEqual(availabilityOf({ available: false, reason: "made-up" }), { available: false, reason: "error" });
  assert.deepEqual(availabilityOf({ available: "yes" }), { available: false, reason: "error" });
  assert.deepEqual(answerOf({ text: "hi" }, { schema: false }), { text: "hi" });
  assert.deepEqual(answerOf({ json: { a: 1 } }, { schema: true }), { json: { a: 1 } });
  throwsCode(() => answerOf({ text: "hi" }, { schema: true }), "error");
  throwsCode(() => answerOf({ text: "x".repeat(LIMITS.answer + 1) }, { schema: false }), "error");
  assert.equal(errorOf({ code: "guardrail", message: "no" }).code, "guardrail");
  assert.equal(errorOf({ code: "rm -rf", message: "no" }).code, "error", "unknown codes become error");
  assert.equal(errorOf({ code: "busy", message: "x".repeat(2000) }).message.length, 500);
  // Restart pauses after crashes.
  const now = 1_000_000;
  assert.equal(restartDelay([], now), 0);
  assert.equal(restartDelay([now - 100], now), 400);
  assert.equal(restartDelay([now - 5000, now - 4000, now - 100], now), 1900);
  assert.equal(restartDelay([now - 11 * 60_000], now), 0, "old crashes are forgotten");
  assert.equal(restartDelay(Array.from({ length: 6 }, (_, i) => now - i * 1000), now), Infinity, "more than five: unavailable");
  console.log("✔ Antworten des Helfers geprüft, Pausen nach Abstürzen");
}

// The process, against the stand-in.
const dir = mkdtempSync(join(tmpdir(), "flowplan-ai-"));
let logCount = 0;
function manager(timing = {}, env = {}) {
  const logFile = join(dir, `log-${++logCount}.txt`);
  const events = [];
  const ai = createDeviceAi({ command: process.execPath, args: [fake], env: { FAKE_DEVICE_AI_LOG: logFile, ...env }, timing: { graceMs: 300, ...timing }, onEvent: (name, detail) => events.push([name, detail]) });
  const log = () => (existsSync(logFile) ? readFileSync(logFile, "utf8").trim().split("\n") : []);
  return { ai, events, log };
}

// Started on the first request only; text, JSON, a stream.
{
  const { ai, log } = manager();
  await sleep(100);
  assert.equal(ai.status().running, false, "nothing runs before a request");
  assert.deepEqual(log(), []);
  assert.deepEqual(await ai.availability(), { available: true, languages: ["de", "en", "fr"] });
  assert.equal(ai.status().running, true);
  assert.deepEqual(await ai.generate({ id: "a", prompt: "Hallo", instructions: "kurz" }), { text: "[kurz] echo: Hallo" });
  assert.deepEqual(
    await ai.generate({ id: "b", prompt: "Plan", schema: { type: "object", properties: { title: { type: "string" }, n: { type: "integer" }, tags: { type: "array", items: { enum: ["x", "y"] } }, note: { type: "string" } }, required: ["title", "n", "tags"] } }),
    { json: { title: "text", n: 2, tags: ["x"] } },
  );
  const chunks = [];
  assert.deepEqual(await ai.stream({ id: "c", prompt: "one two three" }, { onChunk: (t) => chunks.push(t) }), { text: "echo: one two three" });
  assert.deepEqual(chunks, ["echo:", "echo: one", "echo: one two", "echo: one two three"], "the text so far, each time");
  assert.equal(log().filter((l) => l.startsWith("start")).length, 1, "one helper for all of it");
  // Requests the rules refuse never reach the helper.
  await rejects(ai.generate({ id: "d", prompt: "x".repeat(LIMITS.prompt + 1) }), "context-too-long");
  await rejects(ai.generate({ id: "d", prompt: "x", schema: { type: "object", properties: { a: { type: "date" } } } }), "error");
  assert.ok(!log().some((l) => l.endsWith(" d")) && log().length === 5, "refused before the helper");
  await rejects(ai.generate({ id: "e", prompt: "guardrail" }), "guardrail");
  await rejects(ai.generate({ id: "e", prompt: "too-long" }), "context-too-long");
  ai.stop();
  console.log("✔ Start bei der ersten Anfrage, Text, JSON, Stream");
}

// Busy, cancel, a cancel the helper ignores, another page's cancel.
{
  const { ai, log } = manager();
  const chunks = [];
  const slow = ai.stream({ id: "s1", prompt: "slow" }, { owner: "page-1", onChunk: (t) => chunks.push(t) });
  await until(() => chunks.length >= 2, "first chunks");
  await rejects(ai.generate({ id: "s2", prompt: "Hallo" }, { owner: "page-2" }), "busy");
  assert.deepEqual(await ai.availability(), { available: true, languages: ["de", "en", "fr"] }, "availability is answered while busy");
  assert.equal(ai.cancel("page-2", "s1"), false, "another page cannot cancel it");
  assert.equal(ai.cancel("page-1", "other"), false);
  assert.equal(ai.cancel("page-1", "s1"), true);
  await rejects(slow, "cancelled");
  assert.ok(chunks.length < 10, "stopped early");
  assert.ok(log().includes("cancel 1"), "the helper heard the cancel");
  assert.deepEqual(await ai.generate({ id: "s3", prompt: "after" }), { text: "echo: after" }, "free again");
  // A helper that ignores the cancel is stopped after the grace time.
  const pid = ai.status().pid;
  const stubborn = ai.stream({ id: "s4", prompt: "stubborn" }, { owner: "page-1" });
  await sleep(100);
  assert.equal(ai.cancelOwner("page-1"), true, "a page that went away");
  await rejects(stubborn, "cancelled");
  await until(() => !alive(pid), "stubborn helper stopped");
  assert.deepEqual(await ai.generate({ id: "s5", prompt: "again" }), { text: "echo: again" }, "a new helper");
  assert.notEqual(ai.status().pid, pid);
  ai.stop();
  console.log("✔ Beschäftigt, Abbrechen nur durch die eigene Seite");
}

// Crash and restart with a pause; timeouts; idle; switched off.
{
  const { ai, events, log } = manager({ requestMs: 400, idleMs: 300 });
  await ai.availability();
  const first = ai.status().pid;
  await rejects(ai.generate({ id: "k1", prompt: "crash" }), "error");
  assert.equal(ai.status().running, false);
  assert.equal(ai.status().crashes, 1);
  const before = Date.now();
  assert.deepEqual(await ai.generate({ id: "k2", prompt: "back" }), { text: "echo: back" });
  assert.ok(Date.now() - before >= 350, "restarted after a pause");
  assert.notEqual(ai.status().pid, first);
  assert.equal(ai.status().crashes, 0, "an answer clears the crashes");
  // A hanging request times out, and its helper is stopped by PID.
  const hanging = ai.status().pid;
  await rejects(ai.generate({ id: "k3", prompt: "hang" }), "error");
  await until(() => !alive(hanging), "hanging helper stopped");
  assert.ok(events.some(([name]) => name === "timeout"));
  assert.deepEqual(await ai.generate({ id: "k4", prompt: "next" }), { text: "echo: next" });
  // Idle: stopped after a while without requests.
  const idle = ai.status().pid;
  await until(() => !alive(idle), "idle helper stopped", 3000);
  assert.ok(events.some(([name]) => name === "idle"));
  assert.equal(ai.status().running, false);
  // Switched off while a request runs: it ends, the helper goes.
  const running = ai.stream({ id: "k5", prompt: "slow" });
  await until(() => ai.status().running, "running");
  const pid = ai.status().pid;
  ai.stop();
  await rejects(running, "unavailable");
  await until(() => !alive(pid), "stopped when switched off");
  assert.equal(events.filter(([name]) => name === "spawn").length, 4, "four helpers, one after the other");
  assert.equal(events.filter(([name]) => name === "crash").length, 1, "stopping on purpose is no crash");
  assert.ok(log().length >= 8);
  console.log("✔ Neustart nach Absturz mit Pause, Zeitlimit, Leerlauf, Ausschalten");
}

// Crashing again and again: unavailable, not restarted without end.
{
  let clock = 0;
  const { ai } = { ai: createDeviceAi({ command: process.execPath, args: [fake], timing: { graceMs: 300 }, now: () => clock }) };
  for (let i = 0; i < 6; i++) {
    clock += 60_000; // past every pause
    await rejects(ai.generate({ id: `c${i}`, prompt: "crash" }), "error");
  }
  await rejects(ai.generate({ id: "c7", prompt: "hello" }), "unavailable");
  clock += 11 * 60_000;
  assert.deepEqual(await ai.generate({ id: "c8", prompt: "hello" }), { text: "echo: hello" }, "back after the window");
  ai.stop();
  // A helper that is not there: unavailable, availability says error.
  const missing = createDeviceAi({ command: join(dir, "missing-helper") });
  assert.deepEqual(await missing.availability(), { available: false, reason: "error" });
  await rejects(missing.generate({ id: "m", prompt: "x" }), "error");
  // The stand-in's availability passes through.
  const off = manager({}, { FAKE_DEVICE_AI: JSON.stringify({ available: false, reason: "apple-intelligence-off" }) });
  assert.deepEqual(await off.ai.availability(), { available: false, reason: "apple-intelligence-off" });
  off.ai.stop();
  console.log("✔ Wiederholte Abstürze: nicht verfügbar statt Endlosschleife");
}

// The bridge: only the instance's main frame, only when present.
{
  const preload = readFileSync(join(root, "preload.js"), "utf8");
  const main = readFileSync(join(root, "main.js"), "utf8");
  const AI_CHANNELS = ["ai-availability", "ai-cancel", "ai-generate", "ai-stream"];
  assert.deepEqual([...main.matchAll(/handle\("flowplan:(ai-[a-z-]+)",[\s\S]*?\{ instance: true \}\);/g)].map((m) => m[1]).sort(), AI_CHANNELS, "every ai channel answers only the instance");
  assert.match(main, /ipcMain\.on\("flowplan:ai-present", \(event\) => \{\s*event\.returnValue = fromOwnInstance\(event\) && aiEnabled\(\);/, "presence is asked by the instance's main frame only");
  assert.match(main, /function aiEnabled\(\) \{\s*return !!aiHelper && settings\(\)\.deviceAi;/, "only with a helper and the setting on");
  assert.match(main, /function aiService\(\) \{\s*if \(!aiEnabled\(\)\) return null;/, "nothing starts with the setting off");
  // The preload asks once, and only on the instance's own pages.
  const instanceBranch = preload.slice(preload.indexOf("else if (instance &&"));
  assert.match(instanceBranch, /ipcRenderer\.sendSync\("flowplan:ai-present"\)/);
  assert.deepEqual([...preload.slice(0, preload.indexOf("else if (instance &&")).matchAll(/flowplan:(ai-[a-z-]+)/g)].map((m) => m[1]), ["ai-status"], "the app's own pages only see the status (settings)");
  assert.match(main, /handle\("flowplan:ai-status", async \(\) => \(\{ supported: !!aiHelper, enabled: settings\(\)\.deviceAi, availability: aiEnabled\(\) \? await aiAvailability\(\) : null \}\)\);/, "the status starts nothing with the setting off");
  // Chunks only to the frame that asked.
  assert.match(main, /event\.senderFrame/);
  console.log("✔ Brücke nur für die eigene Instanz, nur wenn eingeschaltet");
}
console.log("device-ai: ok");
