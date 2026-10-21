// Starts the desktop app against a running Flowplan instance and checks
// setup, loading and the offline page. Usage: node test/smoke.mjs <url>
import { _electron as electron } from "playwright";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { request as playwrightRequest } from "playwright";
// FLOWPLAN_APP: path of a packaged app executable instead of the dev build.
const packaged = process.env.FLOWPLAN_APP;
const executablePath = packaged || createRequire(import.meta.url)("electron");

const server = process.argv[2] || "http://127.0.0.1:3100";
async function launch(config, env = {}) {
  const dir = mkdtempSync(join(tmpdir(), "flowplan-desktop-"));
  if (config) writeFileSync(join(dir, "config.json"), JSON.stringify(config));
  const app = await electron.launch({
    executablePath,
    args: [...(packaged ? [] : ["."]), `--user-data-dir=${dir}`],
    cwd: new URL("..", import.meta.url).pathname,
    env: { ...process.env, ...env },
  });
  return { app, window: await app.firstWindow() };
}
// First start: the setup page, a wrong address is refused, the right one loads.
{
  const { app, window } = await launch();
  await window.waitForSelector("#form");
  assert.equal(await window.inputValue("#server"), "https://app.flowplan.org");
  await window.fill("#server", "http://127.0.0.1:1");
  await window.click("#submit");
  await window.waitForSelector("#error:not(:empty)");
  assert.match(await window.textContent("#error"), /keine Flowplan-Instanz|No Flowplan instance|Aucune instance Flowplan/);
  await window.fill("#server", server);
  await window.click("#submit");
  await window.waitForURL((url) => url.href.startsWith(server), { timeout: 30000 });
  await window.waitForLoadState("domcontentloaded");
  assert.equal(await window.title().then((t) => /Flowplan/i.test(t)), true);
  await window.screenshot({ path: "test/app.png" });
  await app.close();
  console.log("✔ Einrichtung und Laden");
}
// An unreachable instance shows the offline page.
{
  const { app, window } = await launch({ server: "http://127.0.0.1:1" });
  await window.waitForSelector("#retry", { timeout: 30000 });
  await window.screenshot({ path: "test/offline.png" });
  await app.close();
  console.log("✔ Offline-Seite");
}
// A preset address (managed installation) is suggested, the first start still asks.
{
  const { app, window } = await launch(undefined, { FLOWPLAN_SERVER: server });
  await window.waitForSelector("#form");
  assert.equal(await window.inputValue("#server"), new URL(server).origin);
  await window.click("#submit");
  await window.waitForURL((url) => url.href.startsWith(server), { timeout: 30000 });
  await app.close();
  console.log("✔ Vorgegebene Adresse");
}
// A server that is not Flowplan is refused.
{
  const other = createServer((_req, res) => {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ status: "ok" }));
  });
  await new Promise((done) => other.listen(0, "127.0.0.1", done));
  const { app, window } = await launch();
  await window.waitForSelector("#form");
  await window.fill("#server", `http://127.0.0.1:${other.address().port}`);
  await window.click("#submit");
  await window.waitForSelector("#error:not(:empty)");
  assert.match(await window.textContent("#error"), /Dort läuft kein Flowplan|no Flowplan running|Aucun Flowplan/);
  await app.close();
  other.close();
  console.log("✔ Fremder Server abgelehnt");
}
// Passkeys and SSO: signing in through the browser hands a one-time code
// back to the app (needs the development sign-in of the test instance).
{
  const { app, window } = await launch({ server });
  await window.waitForLoadState("domcontentloaded");
  await app.evaluate(({ shell }) => {
    globalThis.opened = [];
    shell.openExternal = async (url) => void globalThis.opened.push(url);
  });
  const passkey = window.getByRole("link", { name: "Mit Passkey anmelden" });
  await passkey.waitFor({ timeout: 60000 });
  await passkey.evaluate((a) => a.click());
  await window.waitForTimeout(500);
  // The "continue in the browser" window waits with a field for the code.
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 2);
  const [opened] = await app.evaluate(() => globalThis.opened);
  assert.ok(opened?.startsWith(`${server}/api/auth/desktop?challenge=`), opened);
  // The browser: sign in, confirm, follow the link back.
  const browser = await playwrightRequest.newContext({ baseURL: server, extraHTTPHeaders: { origin: server, "accept-language": "de" } });
  assert.ok((await browser.post("/api/auth/demo")).ok());
  const challenge = new URL(opened).searchParams.get("challenge");
  const confirm = await (await browser.get(opened)).text();
  assert.match(confirm, /In der Desktop-App anmelden/);
  const page = await (await browser.post("/api/auth/desktop", { form: { challenge } })).text();
  const link = page.match(/href="(flowplan:[^"]+)"/)[1].replaceAll("&amp;", "&");
  await browser.dispose();
  await app.evaluate(({ app }, link) => app.emit("open-url", { preventDefault() {} }, link), link);
  await window.waitForFunction(async () => (await fetch("/api/bootstrap")).ok, undefined, { timeout: 30000 });
  // Signed in: the waiting window is gone, and the instance has no bridge.
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 1);
  assert.equal(await window.evaluate(() => typeof window.flowplanDesktop), "undefined");
  await app.close();
  console.log("✔ Anmeldung im Browser");
}
