// What the window lets through (guards.js, profiles.js, notifications.js, strings.js, updates.js), checked
// with Node alone – no Electron, no network. Usage: node test/security.mjs
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const root = new URL("..", import.meta.url).pathname;
const guards = require("../guards.js");
const profiles = require("../profiles.js");
const strings = require("../strings.js");
const notifications = require("../notifications.js");
const { isOwnPage, isInstancePage, allowedInWindow, isSignInRedirect, permissionAllowed, updateFeedUrl, classifyHealth } = guards;

const pagesDir = join(root, "pages");
const page = (name) => pathToFileURL(join(pagesDir, name)).href;
const server = "https://flowplan.example.com";

// E1: the bridge answers only the app's own pages.
{
  assert.equal(isOwnPage(page("setup.html"), pagesDir), true);
  assert.equal(isOwnPage(`${page("offline.html")}?server=x&lang=de`, pagesDir), true);
  assert.equal(isOwnPage(page("sign-in.html"), pagesDir), true);
  assert.equal(isOwnPage(page("profiles.html"), pagesDir), true);
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

// E15: the tiny bridge of the instance (window.FlowplanDesktop) – only on the
// window profile's own instance, only notifications on/off, every call
// checked against the main frame and the session's profile.
{
  const own = "https://flowplan.example.com";
  assert.equal(isInstancePage(`${own}/#page=1`, own), true);
  assert.equal(isInstancePage(`${own}/api/auth/login`, own), true);
  assert.equal(isInstancePage("https://evil.example/", own), false);
  assert.equal(isInstancePage("https://flowplan.example.com.evil.example/", own), false);
  assert.equal(isInstancePage("http://flowplan.example.com/", own), false, "another scheme is another origin");
  assert.equal(isInstancePage(page("setup.html"), own), false, "file: pages have the other bridge");
  assert.equal(isInstancePage(`${own}/`, undefined), false, "no profile, no instance");
  assert.equal(isInstancePage(undefined, own), false);
  assert.equal(isInstancePage("javascript:alert(1)", own), false);
  const preload = readFileSync(join(root, "preload.js"), "utf8");
  assert.match(preload, /else if \(instance && \(location\.protocol === "https:" \|\| location\.protocol === "http:"\) && location\.origin === instance\)\s*contextBridge\.exposeInMainWorld\("FlowplanDesktop"/);
  const instanceBridge = preload.slice(preload.indexOf('exposeInMainWorld("FlowplanDesktop"'));
  assert.deepEqual([...instanceBridge.matchAll(/"flowplan:([a-z-]+)"/g)].map((m) => m[1]).sort(), ["notifications-enabled", "notifications-refresh", "notifications-set-enabled"], "notifications alone");
  const main = readFileSync(join(root, "main.js"), "utf8");
  assert.deepEqual([...main.matchAll(/handle\("flowplan:([a-z-]+)",[^\n]*\{ instance: true \}\);/g)].map((m) => m[1]).sort(), ["notifications-enabled", "notifications-refresh", "notifications-set-enabled"], "only these channels answer the instance");
  assert.match(main, /if \(!frame \|\| frame\.parent\) return false;/, "the main frame only");
  assert.match(main, /isInstancePage\(frame\.url, owner\.server\)/, "of the session's own profile");
  assert.match(main, /additionalArguments: profile \? \[`--flowplan-instance=\$\{profile\.server\}`/);
  console.log("✔ Kleine Brücke nur auf der eigenen Instanz");
}

// E16: notifications ask only the profile's own instance with its own session
// and a click opens only an address of that instance.
{
  const own = "https://flowplan.example.com";
  assert.equal(notifications.targetUrl("/#page=a&row=b", own), `${own}/#page=a&row=b`);
  for (const url of ["https://evil.example/", "//evil.example/", "javascript:alert(1)", "file:///etc/passwd", `https://x:y@flowplan.example.com/`, "http://flowplan.example.com/"])
    assert.equal(notifications.targetUrl(url, own), `${own}/`, url);
  const notifier = readFileSync(join(root, "notifier.js"), "utf8");
  assert.match(notifier, /new URL\("\/api\/notifications", profile\.server\)/, "the profile's own instance");
  assert.match(notifier, /deps\.sessionFor\(profile\)\.fetch\(/, "with the profile's own session");
  assert.match(notifier, /redirect: "error"/, "no redirects elsewhere");
  assert.doesNotMatch(notifier, /require\("node:(fs|child_process)"\)|shell\./, "no files, no shell");
  const main = readFileSync(join(root, "main.js"), "utf8");
  assert.match(main, /const target = notificationRules\.targetUrl\(url, profile\.server\);/, "a click is checked");
  assert.match(main, /win\.loadURL\(target && sameOriginAs\(target, origin\) \? target : origin\)/, "and checked again before loading");
  // Nothing from the server is trusted unchecked.
  const feed = notifications.cleanFeed({ unread: "9", notifications: [{ id: "a", text: { toString: () => "x" }, url: ["/"], push: 1 }] });
  assert.deepEqual(feed, { unread: 0, notifications: [{ id: "a", text: "", detail: "", url: "", createdAt: null, read: false, push: false }] });
  console.log("✔ Mitteilungen nur von der eigenen Instanz");
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

// E14: profiles – one session per profile, only the active profile's
// instance in the window, nothing from config.json trusted unchecked.
{
  const work = "https://flowplan.company.example";
  const own = "https://notes.example";
  // An older config with one address becomes the first profile and keeps the
  // default session (its sign-in and offline copy stay).
  const migrated = profiles.loadProfiles({ server: work, window: { width: 900 } });
  assert.deepEqual(migrated, { profiles: [{ id: "main", name: "flowplan.company.example", server: work, legacy: true }], activeProfile: "main" });
  assert.equal(profiles.partitionFor(migrated.profiles[0]), null, "the migrated profile uses the default session");
  assert.deepEqual(profiles.loadProfiles({}), { profiles: [], activeProfile: null });
  assert.deepEqual(profiles.loadProfiles({ server: "javascript:alert(1)" }).profiles, [], "only http(s) addresses");
  assert.deepEqual(profiles.loadProfiles({ server: `${work}/path` }).profiles, [], "only an origin, as saved by the app");
  // New profiles get their own persistent partition, derived from the id.
  let state = migrated;
  let added;
  ({ state, profile: added } = profiles.addProfile(state, { name: "  Privat\n ", server: own }, "abc123"));
  assert.equal(added.name, "Privat", "one line, trimmed");
  assert.equal(state.activeProfile, "abc123", "a new profile becomes active");
  assert.equal(profiles.partitionFor(added), "persist:profile-abc123");
  ({ state } = profiles.addProfile(state, { name: "", server: own }, "abc123"));
  assert.equal(new Set(state.profiles.map((p) => p.id)).size, 3, "ids stay unique");
  assert.equal(state.profiles[2].name, "notes.example", "no name: the host");
  const partitions = state.profiles.map((p) => profiles.partitionFor(p));
  assert.equal(new Set(partitions).size, partitions.length, "no two profiles share a session – also on the same instance");
  // config.json is checked again: a partition or legacy flag cannot be
  // smuggled in, ids are plain, and only one profile owns the default session.
  const loaded = profiles.loadProfiles({
    profiles: [
      { id: "a1", name: "A", server: work, legacy: true },
      { id: "b2", name: "B", server: own, legacy: true, partition: "persist:profile-a1" },
      { id: "../x", name: "C", server: own },
      { id: "a1", name: "Duplicate", server: own },
      { id: "c3", name: "D", server: "file:///etc/passwd" },
      { id: "d4", name: "E\u0000\u2028x", server: own },
      null,
    ],
    activeProfile: "nope",
  });
  assert.deepEqual(loaded.profiles.map((p) => p.id), ["a1", "b2", "d4"]);
  assert.equal(profiles.partitionFor(loaded.profiles[0]), null);
  assert.equal(profiles.partitionFor(loaded.profiles[1]), "persist:profile-b2", "the partition comes from the id, not the file");
  assert.equal(loaded.profiles[2].name, "E x", "no control characters in menus");
  assert.equal(loaded.activeProfile, "a1", "an unknown active profile falls back to the first");
  assert.throws(() => profiles.partitionFor({ id: "../../x" }));
  assert.throws(() => profiles.addProfile(state, { name: "x", server: "file:///etc/passwd" }));
  assert.equal(profiles.cleanName("x".repeat(500), own).length, 60);
  // Navigation stays with the active profile's instance: the other profile's
  // address – and its identity provider – go to the browser.
  const active = profiles.activeOf(state);
  const optionsFor = (profile, hosts = new Set()) => ({ server: profile.server, pagesDir, identityHosts: hosts });
  const workHosts = new Set(["login.idp.example"]);
  assert.equal(allowedInWindow(`${own}/x`, optionsFor(active)), true);
  assert.equal(allowedInWindow(`${work}/x`, optionsFor(active)), false, "another profile's instance is not in this window");
  assert.equal(allowedInWindow("https://login.idp.example/authorize", optionsFor(active)), false, "identity hosts stay with their profile");
  assert.equal(allowedInWindow("https://login.idp.example/authorize", optionsFor(migrated.profiles[0], workHosts)), true);
  assert.equal(permissionAllowed("notifications", {}, false), false, "a session outside its active profile gets no permissions");
  // Switching, removing and the command line only reach saved profiles.
  assert.equal(profiles.nextProfile(state).id, "main", "next wraps around");
  assert.equal(profiles.profileFromArgs(state, ["app", "--profile=abc123"]).id, "abc123");
  assert.equal(profiles.profileFromArgs(state, ["app", "--profile=privat"]).id, "abc123", "by name too");
  assert.equal(profiles.profileFromArgs(state, ["app", `--profile=${own}`]), null, "never a new address");
  assert.equal(profiles.profileFromArgs(state, ["app"]), null);
  const removedId = state.activeProfile;
  const removed = profiles.removeProfile(state, removedId);
  assert.equal(removed.profiles.length, 2);
  assert.equal(removed.activeProfile, "abc123", "the active one moves to its neighbour");
  assert.ok(!removed.profiles.some((p) => p.id === removedId));
  assert.deepEqual(profiles.removeProfile({ profiles: [added], activeProfile: added.id }, added.id), { profiles: [], activeProfile: null });
  assert.throws(() => profiles.renameProfile(state, "unknown", "x"));
  assert.equal(profiles.renameProfile(state, "main", "Arbeit").profiles[0].name, "Arbeit");
  // What is written back: no unknown fields, the active address mirrored
  // for older versions.
  assert.deepEqual(profiles.toConfig(loaded), {
    profiles: [
      { id: "a1", name: "A", server: work, legacy: true },
      { id: "b2", name: "B", server: own },
      { id: "d4", name: "E x", server: own },
    ],
    activeProfile: "a1",
    server: work,
  });
  assert.equal(profiles.profileLabel({ name: "Arbeit", server: work }), "Arbeit – flowplan.company.example");
  // main.js: every window gets the partition of its profile, navigation and
  // permissions ask the window's profile, a switch forgets pending sign-ins,
  // and the profile channels go through the guarded handle() like the rest.
  const main = readFileSync(join(root, "main.js"), "utf8");
  assert.match(main, /partition \? \{ partition \} : \{\}/);
  assert.match(main, /allowedInWindow\(url, \{ server: origin\(\)/);
  assert.match(main, /owner\.id === state\.activeProfile && sameOriginAs\(wc\.getURL\(\), owner\.server\)/);
  assert.match(main, /signIn\.reset\(\)/);
  for (const channel of ["get-profiles", "add-profile", "rename-profile", "remove-profile", "switch-profile", "show-profiles", "new-profile"])
    assert.match(main, new RegExp(`handle\\("flowplan:${channel}"`), channel);
  assert.doesNotMatch(main, /flowplan:set-server/, "addresses only come in as checked profiles");
  console.log("✔ Profile getrennt");
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
  assert.equal(strings.t("menu.nextProfile"), "Nächstes Profil");
  assert.equal(strings.t("profiles.removeConfirm", "Arbeit"), "Profil „Arbeit“ entfernen?");
  assert.equal(strings.t("updates.available", "1.2.3"), "Flowplan 1.2.3 ist verfügbar");
  strings.setLocale("fr");
  assert.equal(strings.t("setup.connect"), "Se connecter");
  assert.equal(strings.t("menu.manageProfiles"), "Gérer les profils…");
  strings.setLocale("xx");
  assert.equal(strings.t("setup.connect"), "Connect");
  assert.equal(strings.t("missing.key"), "missing.key");
  // The pages ask only for words that exist.
  for (const name of ["setup.html", "offline.html", "sign-in.html", "profiles.html"]) {
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
  assert.match(ci, /test:profiles/, "CI runs the profiles test");
  assert.match(ci, /test:notifications/, "CI runs the notifications test");
  console.log("✔ CI prüft Electron und Tests");
}
