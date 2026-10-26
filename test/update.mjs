// Checks the updater of a packaged app: a local update source offers a newer
// version, "Nach Updates suchen …" finds it and the app offers it in the
// toast of the window – never in a dialog. Without the right to replace
// itself (macOS without signature, Linux outside an AppImage) the toast
// points to the download page. On Linux a second run pretends to be an
// AppImage: the update downloads in the background with its progress in the
// toast and on the taskbar, and the download that does not match its
// checksum ends in an error in the toast, not a dialog.
// Usage: FLOWPLAN_APP=<path to the app's executable> node test/update.mjs
import { _electron as electron } from "playwright";
import { createServer } from "node:http";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";

const executablePath = process.env.FLOWPLAN_APP;
if (!executablePath) throw new Error("FLOWPLAN_APP (packaged app) is required.");
const feed = { mac: "latest-mac.yml", win: "latest.yml", linux: "latest-linux.yml" }[process.platform === "darwin" ? "mac" : process.platform === "win32" ? "win" : "linux"];
const file = process.platform === "linux" ? "Flowplan-9.9.9.AppImage" : "Flowplan-9.9.9.zip";
// A download big and slow enough to report progress (about 3 seconds).
const SIZE = 3 * 1024 * 1024;
const yml = `version: 9.9.9
files:
  - url: ${file}
    sha512: AAAA
    size: ${SIZE}
path: ${file}
sha512: AAAA
releaseDate: '2026-10-14T00:00:00.000Z'
`;
const requests = [];
const server = createServer((req, res) => {
  requests.push(req.url);
  const path = new URL(req.url, "http://x").pathname;
  if (path.endsWith(feed)) {
    res.writeHead(200, { "content-type": "text/yaml" });
    res.end(yml);
  } else if (path.endsWith(file)) {
    res.writeHead(200, { "content-type": "application/octet-stream", "content-length": SIZE });
    const chunk = Buffer.alloc(64 * 1024, 1);
    let sent = 0;
    const timer = setInterval(() => {
      if (res.destroyed) return clearInterval(timer);
      res.write(chunk);
      sent += chunk.length;
      if (sent >= SIZE) {
        clearInterval(timer);
        res.end();
      }
    }, 60);
  } else {
    res.writeHead(404);
    res.end();
  }
}).listen(0);
const url = `http://127.0.0.1:${server.address().port}/`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function run(env = {}) {
  const app = await electron.launch({
    executablePath,
    args: [`--user-data-dir=${mkdtempSync(join(tmpdir(), "flowplan-update-"))}`],
    env: { ...process.env, FLOWPLAN_UPDATE_URL: url, FLOWPLAN_SERVER: "http://127.0.0.1:1", ...env },
  });
  const log = [];
  app.process().stdout.on("data", (d) => log.push(String(d)));
  app.process().stderr.on("data", (d) => log.push(String(d)));
  await app.firstWindow();
  // Dialogs are recorded – none may appear; the states of the toast too.
  await app.evaluate(({ app, dialog, BrowserWindow }) => {
    globalThis.dialogs = [];
    globalThis.states = [];
    globalThis.progress = [];
    dialog.showMessageBox = async (_win, options) => (globalThis.dialogs.push(options?.message), { response: 1 });
    dialog.showErrorBox = (title, content) => globalThis.dialogs.push(`${title}: ${content}`);
    app.on("flowplan-update", (state) => globalThis.states.push(state));
    const original = BrowserWindow.prototype.setProgressBar;
    BrowserWindow.prototype.setProgressBar = function (value, ...rest) {
      globalThis.progress.push(value);
      return original.call(this, value, ...rest);
    };
  });
  await app.evaluate(({ Menu }) => Menu.getApplicationMenu().getMenuItemById("check-updates").click());
  return { app, log };
}
const states = (app) => app.evaluate(() => globalThis.states);
async function until(app, test, what, timeout = 30000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const list = await states(app);
    if (test(list)) return list;
    await sleep(200);
  }
  throw new Error(`timed out: ${what} – ${JSON.stringify((await states(app)).map((s) => s.phase))}`);
}
const toastTitle = (app) =>
  app.evaluate(({ webContents }) => webContents.getAllWebContents().find((c) => c.getURL().includes("update.html"))?.executeJavaScript("document.getElementById('title').textContent"));

// Run 1: found and offered.
{
  const env = process.platform === "linux" ? { APPIMAGE: "" } : {};
  const { app, log } = await run(env);
  let list;
  try {
    list = await until(app, (l) => l.some((s) => s.version === "9.9.9" && (s.phase === "manual-download" || s.phase === "downloading" || s.phase === "ready")), "9.9.9 offered");
  } catch (e) {
    if (process.env.DEBUG_UPDATE) console.log(log.join(""), requests);
    throw e;
  }
  const offered = list.find((s) => s.version === "9.9.9");
  assert.match(offered.view.title, /9\.9\.9/, "the newer version is named");
  assert.match(offered.view.source, /127\.0\.0\.1/, "with its source");
  await sleep(500);
  assert.match((await toastTitle(app)) || "", /9\.9\.9/, "in the toast");
  assert.deepEqual(await app.evaluate(() => globalThis.dialogs), [], "no dialog");
  await app.close();
  assert.ok(requests.some((r) => new URL(r, "http://x").pathname.endsWith(feed)), `the app asked for ${feed}`);
  console.log(`✔ Update gefunden: ${offered.view.title}`);
}

// Run 2 (Linux): as an AppImage it downloads with progress; a download that
// does not match its checksum is an error in the toast.
if (process.platform === "linux") {
  const appImage = join(mkdtempSync(join(tmpdir(), "flowplan-appimage-")), "Flowplan.AppImage");
  writeFileSync(appImage, "not really an AppImage");
  const { app, log } = await run({ APPIMAGE: appImage });
  let list;
  try {
    list = await until(app, (l) => l.some((s) => s.phase === "downloading" && s.view && /\d+ %/.test(s.view.detail) && !/^0 %/.test(s.view.detail)), "progress", 45000);
    list = await until(app, (l) => l.some((s) => s.phase === "error"), "the failed check", 45000);
  } catch (e) {
    if (process.env.DEBUG_UPDATE) console.log(log.join(""), requests);
    throw e;
  }
  const progress = list.find((s) => s.phase === "downloading" && /MB/.test(s.view.detail));
  assert.match(progress.view.detail, /^\d+ % · [\d.,]+ (KB|MB) of 3\.1 MB/, "percent and size");
  const bars = await app.evaluate(() => globalThis.progress);
  assert.ok(bars.some((v) => v > 0 && v <= 1), "progress on the taskbar");
  assert.equal(bars.at(-1), -1, "and gone afterwards");
  const failed = list.find((s) => s.phase === "error");
  assert.match(failed.view.title, /Checking for updates did not work|Nach Updates suchen hat nicht geklappt|La recherche/);
  assert.deepEqual(await app.evaluate(() => globalThis.dialogs), [], "no dialog");
  await app.close();
  console.log(`✔ Download mit Fortschritt: ${progress.view.detail}`);
}
server.close();
