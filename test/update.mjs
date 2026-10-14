// Checks the updater of a packaged app: a local update source offers a newer
// version, "Nach Updates suchen …" finds it and the app offers it (macOS
// without signature: with a link to the download page).
// Usage: FLOWPLAN_APP=<path to the app's executable> node test/update.mjs
import { _electron as electron } from "playwright";
import { createServer } from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";

const executablePath = process.env.FLOWPLAN_APP;
if (!executablePath) throw new Error("FLOWPLAN_APP (packaged app) is required.");
const feed = { mac: "latest-mac.yml", win: "latest.yml", linux: "latest-linux.yml" }[process.platform === "darwin" ? "mac" : process.platform === "win32" ? "win" : "linux"];
const yml = `version: 9.9.9
files:
  - url: Flowplan-9.9.9.zip
    sha512: AAAA
    size: 1
path: Flowplan-9.9.9.zip
sha512: AAAA
releaseDate: '2026-10-14T00:00:00.000Z'
`;
const requests = [];
const server = createServer((req, res) => {
  requests.push(req.url);
  if (new URL(req.url, "http://x").pathname.endsWith(feed)) {
    res.writeHead(200, { "content-type": "text/yaml" });
    res.end(yml);
  } else {
    res.writeHead(404);
    res.end();
  }
}).listen(0);
const url = `http://127.0.0.1:${server.address().port}/`;

const app = await electron.launch({
  executablePath,
  args: [`--user-data-dir=${mkdtempSync(join(tmpdir(), "flowplan-update-"))}`],
  env: { ...process.env, FLOWPLAN_UPDATE_URL: url, FLOWPLAN_SERVER: "http://127.0.0.1:1" },
});
const log = [];
app.process().stdout.on("data", (d) => log.push(String(d)));
app.process().stderr.on("data", (d) => log.push(String(d)));
await app.firstWindow();
// Dialogs of the main process are recorded instead of shown.
await app.evaluate(({ dialog }) => {
  globalThis.shown = [];
  dialog.showMessageBox = async (_win, options) => {
    globalThis.shown.push(options.message);
    return { response: 1 };
  };
});
await app.evaluate(({ Menu }) => {
  const find = (items) => {
    for (const item of items) {
      if (item.label === "Nach Updates suchen …") return item;
      const inner = item.submenu && find(item.submenu.items);
      if (inner) return inner;
    }
  };
  find(Menu.getApplicationMenu().items).click();
});
let shown = [];
for (let i = 0; i < 40 && !shown.length; i++) {
  await new Promise((r) => setTimeout(r, 250));
  shown = await app.evaluate(() => globalThis.shown);
}
await app.close();
server.close();
if (process.env.DEBUG_UPDATE) console.log(log.join(""), requests, shown);
assert.ok(requests.some((r) => new URL(r, "http://x").pathname.endsWith(feed)), `the app asked for ${feed}`);
assert.match(shown[0] || "", /9\.9\.9/, "the newer version is offered");
console.log(`✔ Update gefunden: ${shown[0]}`);
