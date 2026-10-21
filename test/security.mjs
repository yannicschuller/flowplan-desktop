// What the window lets through (guards.js, strings.js, updates.js), checked
// with Node alone – no Electron, no network. Usage: node test/security.mjs
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const root = new URL("..", import.meta.url).pathname;
const guards = require("../guards.js");
const strings = require("../strings.js");
const { isOwnPage, allowedInWindow, isSignInRedirect, permissionAllowed, updateFeedUrl, classifyHealth } = guards;

const pagesDir = join(root, "pages");
const page = (name) => pathToFileURL(join(pagesDir, name)).href;
const server = "https://flowplan.example.com";

// E1: the bridge answers only the app's own pages.
{
  assert.equal(isOwnPage(page("setup.html"), pagesDir), true);
  assert.equal(isOwnPage(`${page("offline.html")}?server=x&lang=de`, pagesDir), true);
  assert.equal(isOwnPage(page("sign-in.html"), pagesDir), true);
  assert.equal(isOwnPage(`${server}/`, pagesDir), false, "the instance has no bridge");
  assert.equal(isOwnPage(`${server}/pages/setup.html`, pagesDir), false);
  assert.equal(isOwnPage("https://evil.example/file:///x/pages/setup.html", pagesDir), false);
  assert.equal(isOwnPage(pathToFileURL(join(root, "main.js")).href, pagesDir), false, "other files of the app");
  assert.equal(isOwnPage(`${page("")}../main.js`, pagesDir), false, "no climbing out of pages/");
  assert.equal(isOwnPage(`${page("")}%2e%2e/main.js`, pagesDir), false);
  assert.equal(isOwnPage(pathToFileURL(pagesDir).href, pagesDir), false, "the directory itself is no page");
  assert.equal(isOwnPage(pathToFileURL(`${pagesDir}-evil/setup.html`).href, pagesDir), false, "a sibling directory with the same prefix");
  assert.equal(isOwnPage(undefined, pagesDir), false, "a sender frame that is gone");
  assert.equal(isOwnPage("", pagesDir), false);
  // The preload defines the bridge only on file: pages.
  const preload = readFileSync(join(root, "preload.js"), "utf8");
  assert.match(preload, /if \(location\.protocol === "file:"\)\s*contextBridge\.exposeInMainWorld/);
  // Every handler in main.js goes through the guard.
  const main = readFileSync(join(root, "main.js"), "utf8");
  assert.equal((main.match(/ipcMain\.handle\(/g) || []).length, 1, "ipcMain.handle only inside handle()");
  assert.match(main, /isOwnPage\(from, defaultPagesDir\)/);
  console.log("✔ Bridge nur für eigene Seiten");
}

// E2/E7: what may open inside the window.
{
  const identityHosts = new Set(["login.idp.example"]);
  const options = { server, pagesDir, identityHosts };
  assert.equal(allowedInWindow(`${server}/api/auth/x`, options), true, "the instance's sign-in");
  assert.equal(allowedInWindow(`${server}/some/page`, options), true);
  assert.equal(allowedInWindow("https://evil.example/api/auth/x", options), false, "/api/auth/ elsewhere");
  assert.equal(allowedInWindow("https://evil.example/", options), false);
  assert.equal(allowedInWindow(`https://evil.example/${server}/api/auth/x`, options), false);
  assert.equal(allowedInWindow("https://login.idp.example/authorize", options), true, "the identity provider");
  assert.equal(allowedInWindow("https://login.idp.example.evil.example/", options), false);
  assert.equal(allowedInWindow(page("setup.html"), options), true, "the app's own pages");
  assert.equal(allowedInWindow(pathToFileURL(join(root, "package.json")).href, options), false, "other files");
  assert.equal(allowedInWindow("file:///etc/passwd", options), false);
  assert.equal(allowedInWindow(`${server}/x`, { ...options, server: undefined }), false, "no server, no instance");
  assert.equal(allowedInWindow("not a url", options), false);
  // Only redirects from the instance's sign-in add identity hosts.
  assert.equal(isSignInRedirect(`${server}/api/auth/login`, server), true);
  assert.equal(isSignInRedirect(`${server}/share/x`, server), false);
  assert.equal(isSignInRedirect("https://evil.example/api/auth/login", server), false);
  console.log("✔ Navigation im Fenster");
}

// E3: permissions of the instance.
{
  const from = true;
  assert.equal(permissionAllowed("notifications", {}, from), true);
  assert.equal(permissionAllowed("clipboard-read", {}, from), true);
  assert.equal(permissionAllowed("media", { mediaTypes: ["audio"] }, from), true, "microphone for voice notes");
  assert.equal(permissionAllowed("media", { mediaTypes: ["video"] }, from), false, "no camera");
  assert.equal(permissionAllowed("media", { mediaTypes: ["audio", "video"] }, from), false);
  assert.equal(permissionAllowed("media", { mediaTypes: [] }, from), false);
  assert.equal(permissionAllowed("media", {}, from), false);
  assert.equal(permissionAllowed("display-capture", {}, from), false, "no screen");
  assert.equal(permissionAllowed("geolocation", {}, from), false);
  assert.equal(permissionAllowed("media", { mediaTypes: ["audio"] }, false), false, "only the instance");
  assert.equal(permissionAllowed("notifications", {}, false), false);
  console.log("✔ Berechtigungen");
}

// E5/E8: the update source.
{
  assert.equal(updateFeedUrl("https://mirror.example/flowplan/"), "https://mirror.example/flowplan/");
  assert.equal(updateFeedUrl("http://mirror.example/flowplan/"), null, "http is refused");
  assert.equal(updateFeedUrl("http://evil.example/"), null);
  assert.equal(updateFeedUrl("ftp://mirror.example/"), null);
  assert.equal(updateFeedUrl("file:///tmp/feed/"), null);
  assert.equal(updateFeedUrl("not a url"), null);
  assert.equal(updateFeedUrl(""), null);
  assert.equal(updateFeedUrl(undefined), null);
  assert.equal(updateFeedUrl("http://127.0.0.1:4321/"), "http://127.0.0.1:4321/", "loopback for test/update.mjs");
  assert.equal(updateFeedUrl("http://localhost:4321/"), "http://localhost:4321/");
  // updates.js names the source; outside Electron it still loads.
  const { feed } = require("../updates.js");
  assert.equal(feed({ FLOWPLAN_UPDATE_URL: "http://evil.example/" }).url, null);
  assert.equal(feed({ FLOWPLAN_UPDATE_URL: "http://evil.example/" }).ignored, "http://evil.example/");
  assert.equal(feed({ FLOWPLAN_UPDATE_URL: "https://mirror.example/f/" }).url, "https://mirror.example/f/");
  assert.match(feed({}).label, /github\.com\/yannicschuller\/flowplan-desktop/);
  console.log("✔ Updatequelle nur https");
}

// E10: what the health check says.
{
  assert.equal(classifyHealth({ status: 200, contentType: "application/json", data: { service: "flowplan" } }), "ok");
  assert.equal(classifyHealth({ status: 503, contentType: "application/json", data: { service: "flowplan", status: "degraded" } }), "ok", "a degraded Flowplan is still Flowplan");
  assert.equal(classifyHealth({ status: 200, data: { checks: { database: "ok" }, searchBacklog: 0 } }), "ok", "older versions");
  assert.equal(classifyHealth({ status: 401, contentType: "text/html", data: null }), "proxy-auth");
  assert.equal(classifyHealth({ status: 403, data: null }), "proxy-auth");
  assert.equal(classifyHealth({ status: 407, data: null }), "proxy-auth");
  assert.equal(classifyHealth({ status: 502, contentType: "text/html", data: null }), "error");
  assert.equal(classifyHealth({ status: 404, data: null }), "error");
  assert.equal(classifyHealth({ status: 200, contentType: "text/html; charset=utf-8", data: null }), "html");
  assert.equal(classifyHealth({ status: 200, contentType: "application/json", data: { status: "ok" } }), "other");
  console.log("✔ Antworten des Servers unterschieden");
}

// E9: words in three languages, English otherwise.
{
  assert.equal(strings.pickLocale("de-CH"), "de");
  assert.equal(strings.pickLocale("fr_CA"), "fr");
  assert.equal(strings.pickLocale("en-US"), "en");
  assert.equal(strings.pickLocale("it-IT"), "en");
  assert.equal(strings.pickLocale(undefined), "en");
  for (const [key, entry] of Object.entries(strings.STRINGS)) {
    assert.equal(entry.length, 3, `${key}: de, en, fr`);
    for (const text of entry) assert.ok(text.trim(), `${key}: no empty text`);
  }
  strings.setLocale("de");
  assert.equal(strings.t("menu.checkUpdates"), "Nach Updates suchen …");
  assert.equal(strings.t("updates.available", "1.2.3"), "Flowplan 1.2.3 ist verfügbar");
  strings.setLocale("fr");
  assert.equal(strings.t("setup.connect"), "Se connecter");
  strings.setLocale("xx");
  assert.equal(strings.t("setup.connect"), "Connect");
  assert.equal(strings.t("missing.key"), "missing.key");
  // The pages ask only for words that exist.
  for (const name of ["setup.html", "offline.html", "sign-in.html"]) {
    const html = readFileSync(join(pagesDir, name), "utf8");
    for (const [, key] of html.matchAll(/data-i18n(?:-\w+)?="([^"]+)"/g)) assert.ok(strings.STRINGS[key], `${name}: ${key}`);
    assert.match(html, /script-src 'self'/, `${name}: CSP without inline scripts`);
  }
  console.log("✔ Sprachen");
}

// The release workflow checks for a supported Electron the same way CI does.
{
  const ci = readFileSync(join(root, ".github", "workflows", "ci.yml"), "utf8");
  assert.match(ci, /dist-tags\.latest/, "CI compares with the latest Electron");
  assert.match(ci, /test:security/, "CI runs this test");
  console.log("✔ CI prüft Electron und Tests");
}
