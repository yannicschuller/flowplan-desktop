// Offline use in the desktop app (Settings → Data → Offline use): the window
// offers what the web app needs for it, and without a connection the stored
// app opens from the instance's service worker instead of the app's own
// offline page. A small stand-in instance with a service worker like
// Flowplan's (public/sw.js: navigations to "/" network first) is enough; no
// running Flowplan is needed. Usage: node test/offline.mjs (Linux: xvfb-run)
import { _electron as electron } from "playwright";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import assert from "node:assert/strict";

const require = createRequire(import.meta.url);
const { fallbackFor } = require("../fallback.js");
// FLOWPLAN_APP: path of a packaged app executable instead of the dev build.
const packaged = process.env.FLOWPLAN_APP;
const executablePath = packaged || require("electron");

// Which page a failed load leads to.
{
  const origin = "https://flowplan.example.com";
  assert.equal(fallbackFor(`${origin}/`, origin), "offline-page");
  assert.equal(fallbackFor(`${origin}/?w=1#page=2`, origin), "offline-page");
  assert.equal(fallbackFor(`${origin}/share/abc`, origin), "start");
  assert.equal(fallbackFor(`${origin}/api/auth/callback`, origin), "start");
  assert.equal(fallbackFor("https://login.example.com/authorize", origin), "offline-page");
  assert.equal(fallbackFor(`${origin}/share/abc`, undefined), "offline-page");
  assert.equal(fallbackFor("not a url", origin), "offline-page");
  console.log("✔ Rückfall bei Ladefehlern");
}

const worker = `
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.mode !== "navigate" || url.pathname !== "/") return;
  e.respondWith(
    fetch(e.request)
      .then(async (r) => ((await caches.open("app")).put("/", r.clone()), r))
      .catch(async () => (await (await caches.open("app")).match("/")) || Response.error()),
  );
});`;
function instance() {
  const server = createServer((req, res) => {
    if (req.url === "/sw.js") {
      res.setHeader("Content-Type", "text/javascript");
      return res.end(worker);
    }
    if (req.url === "/api/health") {
      res.setHeader("Content-Type", "application/json");
      return res.end(JSON.stringify({ service: "flowplan" }));
    }
    res.setHeader("Content-Type", "text/html");
    res.end("<!doctype html><title>Flowplan</title><h1>Stored app</h1>");
  });
  return new Promise((done) =>
    server.listen(0, "127.0.0.1", () =>
      done({
        origin: `http://localhost:${server.address().port}`,
        stop: () => new Promise((closed) => (server.close(closed), server.closeAllConnections())),
      }),
    ),
  );
}
const dir = mkdtempSync(join(tmpdir(), "flowplan-offline-"));
const launch = () =>
  electron.launch({
    executablePath,
    args: [...(packaged ? [] : ["."]), `--user-data-dir=${dir}`],
    cwd: new URL("..", import.meta.url).pathname,
  });
const offlinePage = (url) => url.startsWith("file:") && url.includes("offline.html");
const { origin, stop } = await instance();
writeFileSync(join(dir, "config.json"), JSON.stringify({ server: origin }));

// Online: the web app finds what its offline option needs (with
// contextIsolation and sandbox on) and stores itself.
{
  const app = await launch();
  const window = await app.firstWindow();
  await window.waitForSelector("text=Stored app");
  const support = await window.evaluate(() => ({
    secure: window.isSecureContext,
    serviceWorker: "serviceWorker" in navigator,
    caches: "caches" in window,
  }));
  assert.deepEqual(support, { secure: true, serviceWorker: true, caches: true });
  // The instance's pages have no bridge to the app (preload.js).
  assert.equal(await window.evaluate(() => typeof window.flowplanDesktop), "undefined");
  await window.evaluate(async () => {
    await navigator.serviceWorker.register("/sw.js", { scope: "/" });
    await navigator.serviceWorker.ready;
  });
  await window.reload();
  await window.waitForSelector("text=Stored app");
  assert.equal(await window.evaluate(() => !!navigator.serviceWorker.controller), true);
  assert.equal(await window.evaluate(async () => !!(await (await caches.open("app")).match("/"))), true);
  await app.close();
  console.log("✔ Offline-Nutzung verfügbar");
}
await stop();

// Offline: the stored app opens, also after a failed page of the instance.
{
  const app = await launch();
  const window = await app.firstWindow();
  await window.waitForSelector("text=Stored app", { timeout: 30000 });
  assert.equal(new URL(window.url()).origin, origin);
  console.log("✔ Start ohne Verbindung aus der Offline-Kopie");
  await window.evaluate(() => (window.before = true));
  await app.evaluate(({ BrowserWindow }, url) => {
    BrowserWindow.getAllWindows()[0].loadURL(url).catch(() => {});
  }, `${origin}/share/abc`);
  // A new document (not the one from before) that is the stored app.
  let shown = null;
  for (let i = 0; i < 60 && !shown; i++) {
    await new Promise((done) => setTimeout(done, 500));
    shown = await window
      .evaluate(() => (!window.before && document.readyState !== "loading" ? location.href : null))
      .catch(() => null);
  }
  assert.equal(shown, `${origin}/`);
  await window.waitForSelector("text=Stored app");
  await app.close();
  console.log("✔ Fehlgeschlagene Seite führt zur Offline-Kopie");
}

// Without a stored copy the app's own offline page appears.
{
  const fresh = mkdtempSync(join(tmpdir(), "flowplan-offline-"));
  writeFileSync(join(fresh, "config.json"), JSON.stringify({ server: origin }));
  const app = await electron.launch({
    executablePath,
    args: [...(packaged ? [] : ["."]), `--user-data-dir=${fresh}`],
    cwd: new URL("..", import.meta.url).pathname,
  });
  const window = await app.firstWindow();
  await window.waitForSelector("#retry", { timeout: 30000 });
  assert.match(await window.textContent("h1"), /Keine Verbindung zu Flowplan|No connection to Flowplan|Pas de connexion à Flowplan/);
  assert.equal(offlinePage(window.url()), true);
  // The app's own page has the bridge, and in the system language.
  assert.equal(await window.evaluate(() => typeof window.flowplanDesktop.retry), "function");
  assert.match(await window.evaluate(() => document.documentElement.lang), /^(de|en|fr)$/);
  await app.close();
  console.log("✔ Ohne Offline-Kopie die Offline-Seite");
}

// An outdated copy in the window's browser cache (#182): a script the
// instance serves as immutable stays in the cache across starts. Asked by
// the page (window.FlowplanDesktop.clearCache, the web app's self-heal) and
// once after an update of the app, the HTTP cache goes – the sign-in
// (cookies), local storage and the service worker's offline copy stay.
{
  let version = "1";
  const server = createServer((req, res) => {
    if (req.url === "/app.js") {
      res.setHeader("Content-Type", "text/javascript");
      res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      return res.end(`window.appVersion = ${JSON.stringify(version)};`);
    }
    if (req.url === "/api/health") {
      res.setHeader("Content-Type", "application/json");
      return res.end(JSON.stringify({ service: "flowplan" }));
    }
    res.setHeader("Content-Type", "text/html");
    res.setHeader("Cache-Control", "private, no-cache, no-store, max-age=0, must-revalidate");
    res.end('<!doctype html><title>Flowplan</title><script src="/app.js"></script><h1>App</h1>');
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  const site = `http://localhost:${server.address().port}`;
  const home = mkdtempSync(join(tmpdir(), "flowplan-cache-"));
  writeFileSync(join(home, "config.json"), JSON.stringify({ server: site }));
  const start = async () => {
    const app = await electron.launch({ executablePath, args: [...(packaged ? [] : ["."]), `--user-data-dir=${home}`], cwd: new URL("..", import.meta.url).pathname });
    const window = await app.firstWindow();
    await window.waitForSelector("text=App", { timeout: 30000 });
    return { app, window };
  };
  const config = () => JSON.parse(readFileSync(join(home, "config.json"), "utf8"));
  const shown = (window) => window.evaluate(() => window.appVersion);
  let { app, window } = await start();
  assert.equal(await shown(window), "1");
  const appVersion = await app.evaluate(({ app }) => app.getVersion());
  assert.equal(config().webCacheVersion, appVersion, "the first start with it clears and remembers the version");
  await window.evaluate(() => {
    document.cookie = "session=kept; max-age=86400; path=/";
    localStorage.setItem("kept", "yes");
  });
  await window.evaluate(async () => {
    await navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {});
    await (await caches.open("flowplan-data-v1")).put("/offline", new Response("copy"));
  });
  await app.close();
  // The instance was updated; the window's cache still has the old file.
  version = "2";
  ({ app, window } = await start());
  assert.equal(await shown(window), "1", "the same app version: the cache is kept (and outdated)");
  // The page asks before loading itself again.
  assert.equal(await window.evaluate(() => window.FlowplanDesktop.clearCache()), true);
  assert.equal(await window.evaluate(() => window.FlowplanDesktop.clearCache()), false, "once a minute");
  await window.reload();
  await window.waitForSelector("text=App");
  assert.equal(await shown(window), "2");
  assert.deepEqual(
    await window.evaluate(async () => ({ cookie: document.cookie, stored: localStorage.getItem("kept"), copy: await (await (await caches.open("flowplan-data-v1")).match("/offline"))?.text() })),
    { cookie: "session=kept", stored: "yes", copy: "copy" },
    "sign-in, storage and the offline copy stay",
  );
  await app.close();
  // An update of the app clears it once at the start, before the page loads.
  version = "3";
  writeFileSync(join(home, "config.json"), JSON.stringify({ ...config(), webCacheVersion: "0.0.1" }));
  ({ app, window } = await start());
  assert.equal(await shown(window), "3");
  assert.equal(config().webCacheVersion, appVersion);
  assert.equal(await window.evaluate(() => localStorage.getItem("kept")), "yes");
  await app.close();
  await new Promise((closed) => (server.close(closed), server.closeAllConnections()));
  console.log("✔ Veralteter Zwischenspeicher nach Updates geleert");
}
