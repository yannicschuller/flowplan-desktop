// Notifications without push: first the decisions of notifications.js with
// Node alone (settings, "Do Not Disturb", waiting, what is new, where a click
// leads), then the running app against a small stand-in instance that serves
// GET /api/notifications – a new notification is shown (Linux CI has no
// notification server: the app reports what it showed through an app event),
// the badge follows the unread count, a click opens its page on the instance
// only, "Do Not Disturb" and the switch work, the bridge window.FlowplanDesktop
// exists on the instance alone and a restart shows nothing twice. No running
// Flowplan is needed. Usage: node test/notifications.mjs (Linux: xvfb-run)
import { _electron as electron } from "playwright";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import assert from "node:assert/strict";

const require = createRequire(import.meta.url);
const rules = require("../notifications.js");

// Settings, "Do Not Disturb" and the profiles that are asked.
{
  assert.deepEqual(rules.settingsOf({}), { enabled: true, allProfiles: false, dnd: null, dndUntil: null }, "on, active profile only");
  assert.deepEqual(rules.settingsOf({ notifications: { enabled: false, allProfiles: true } }), { enabled: false, allProfiles: true, dnd: null, dndUntil: null });
  assert.equal(rules.settingsOf({ notifications: { enabled: "no" } }).enabled, true, "only false switches off");
  assert.equal(rules.settingsOf({ notifications: { dnd: "forever", dndUntil: 9e15 } }).dnd, null, "only known choices");
  assert.equal(rules.settingsOf({ notifications: { dnd: "hour", dndUntil: "x" } }).dndUntil, null);
  const now = new Date(2026, 9, 22, 21, 30).getTime();
  assert.equal(rules.dndUntil("hour", now), now + 3600000);
  assert.equal(rules.dndUntil("tomorrow", now), new Date(2026, 9, 23, 8, 0).getTime(), "until 8 o'clock tomorrow");
  assert.equal(rules.dndUntil("tomorrow", new Date(2026, 11, 31, 23, 0).getTime()), new Date(2027, 0, 1, 8, 0).getTime(), "across the year");
  assert.equal(rules.dndUntil("off", now), null);
  const quiet = rules.settingsOf({ notifications: { dnd: "hour", dndUntil: now + 1000 } });
  assert.equal(rules.isQuiet(quiet, now), true);
  assert.equal(rules.isQuiet(quiet, now + 1000), false, "ends by itself");
  assert.equal(rules.dndChoice(quiet, now), "hour");
  assert.equal(rules.dndChoice(quiet, now + 2000), "off");
  const state = { profiles: [{ id: "a" }, { id: "b" }], activeProfile: "b" };
  assert.deepEqual(rules.profilesToWatch(state, rules.settingsOf({})).map((p) => p.id), ["b"]);
  assert.deepEqual(rules.profilesToWatch(state, rules.settingsOf({ notifications: { allProfiles: true } })).map((p) => p.id), ["a", "b"]);
  assert.deepEqual(rules.profilesToWatch(state, rules.settingsOf({ notifications: { enabled: false, allProfiles: true } })), []);
  assert.deepEqual(rules.profilesToWatch({ profiles: [], activeProfile: null }, rules.settingsOf({})), []);
  console.log("✔ Einstellungen und Nicht stören");
}

// How long to wait.
{
  assert.equal(rules.outcomeOf(200), "ok");
  assert.equal(rules.outcomeOf(401), "signed-out");
  assert.equal(rules.outcomeOf(403), "signed-out");
  assert.equal(rules.outcomeOf(404), "missing", "an older instance");
  assert.equal(rules.outcomeOf(502), "error");
  assert.equal(rules.nextDelay("ok"), 60000);
  assert.equal(rules.nextDelay("error", 1), 120000, "doubling after errors");
  assert.equal(rules.nextDelay("error", 3), 480000);
  assert.equal(rules.nextDelay("error", 50), rules.MAX_DELAY, "at most 15 minutes");
  assert.equal(rules.nextDelay("signed-out"), 5 * 60000);
  assert.equal(rules.nextDelay("missing"), 30 * 60000);
  console.log("✔ Abstände und Backoff");
}

// What is new: the first answer only marks what is there, later ones show
// unread notifications with push on, each once, oldest first.
{
  const at = (s) => `2026-10-22T08:00:${String(s).padStart(2, "0")}Z`;
  const n = (id, s, extra = {}) => ({ id, text: `Text ${id}`, detail: "", url: `/#page=${id}`, createdAt: at(s), read: false, push: true, ...extra });
  let result = rules.takeNew(undefined, { unread: 2, notifications: [n("b", 2), n("a", 1)] });
  assert.deepEqual(result.fresh, [], "nothing old after a fresh start");
  assert.equal(result.unread, 2);
  assert.equal(result.state.primed, true);
  assert.equal(result.state.since, at(2));
  assert.equal(result.changed, true);
  let saved = JSON.parse(JSON.stringify(result.state));
  result = rules.takeNew(saved, { unread: 5, notifications: [n("e", 4, { read: true }), n("d", 4, { push: false }), n("c", 3), n("f", 5), n("b", 2)] });
  assert.deepEqual(result.fresh.map((x) => x.id), ["c", "f"], "unread, push on, not seen, oldest first");
  assert.equal(result.state.since, at(5));
  assert.deepEqual(result.state.seen.slice(0, 4).sort(), ["c", "d", "e", "f"]);
  saved = result.state;
  result = rules.takeNew(saved, { unread: 5, notifications: [n("f", 5)] });
  assert.deepEqual(result.fresh, [], "each once");
  assert.equal(result.changed, false, "nothing to write");
  // Garbage from the server is dropped, texts are one line and short.
  const clean = rules.cleanFeed({ unread: -3, notifications: [null, { id: 5 }, { id: "x".repeat(101) }, { id: "ok", text: "a\nb" + "c".repeat(400), push: "yes", read: 1, url: 7 }] });
  assert.equal(clean.unread, 0);
  assert.equal(clean.notifications.length, 1);
  assert.equal(clean.notifications[0].text.length, 300);
  assert.ok(!clean.notifications[0].text.includes("\n"));
  assert.equal(clean.notifications[0].push, false, "only true is true");
  assert.equal(clean.notifications[0].url, "");
  assert.deepEqual(rules.takeNew(undefined, null).fresh, []);
  assert.deepEqual(rules.profileStateOf({ since: "nonsense", seen: [1, "a"], primed: "yes" }), { since: null, seen: ["a"], primed: false });
  // The remembered ids stay bounded.
  const many = Array.from({ length: 150 }, (_, i) => n(`id${i}`, 1));
  assert.equal(rules.takeNew({ primed: true }, { notifications: many }).state.seen.length, rules.SEEN_MAX);
  console.log("✔ Neue Benachrichtigungen ohne Doppelte");
}

// What is shown and where a click leads.
{
  const t = (key, ...args) => `${key}:${args.join(",")}`;
  const item = { id: "1", text: "Anna mentioned you in “Plan”", detail: "Offer", url: "/#page=1" };
  assert.deepEqual(rules.present([item], { t }), [{ id: "1", title: "Anna mentioned you in “Plan”", body: "Offer", url: "/#page=1" }]);
  assert.equal(rules.present([item], { t, profileName: "Work", showProfile: true })[0].body, "Offer · Work", "with several profiles");
  assert.equal(rules.present([{ ...item, text: "" }], { t })[0].title, "Flowplan");
  const four = ["1", "2", "3", "4"].map((id) => ({ ...item, id }));
  assert.deepEqual(rules.present(four, { t }), [{ id: "4", title: "notifications.many:4", body: "", url: "/#inbox" }], "many become one");
  const origin = "https://flowplan.example.com";
  assert.equal(rules.targetUrl("/#page=abc&row=def", origin), `${origin}/#page=abc&row=def`);
  assert.equal(rules.targetUrl("https://evil.example/#page=1", origin), `${origin}/`, "another site: the start page");
  assert.equal(rules.targetUrl("//evil.example/x", origin), `${origin}/`);
  assert.equal(rules.targetUrl("javascript:alert(1)", origin), `${origin}/`);
  assert.equal(rules.targetUrl(`https://user:pw@flowplan.example.com/`, origin), `${origin}/`);
  assert.equal(rules.targetUrl(undefined, origin), `${origin}/`);
  assert.equal(rules.targetUrl("/x", undefined), null);
  assert.equal(rules.badgeCount(new Map([["a", 2], ["b", 3], ["c", -1]]), [{ id: "a" }, { id: "c" }]), 2, "only watched profiles");
  assert.equal(rules.badgeCount(new Map(), [{ id: "a" }]), 0);
  console.log("✔ Anzeige und Ziel eines Klicks");
}

// The running app.
const packaged = process.env.FLOWPLAN_APP;
const executablePath = packaged || require("electron");
const at = (s) => new Date(Date.UTC(2026, 9, 22, 8, 0, s)).toISOString().replace(/\.\d+Z$/, "Z");
// An instance with a session cookie (or `open`, signed in without) and a
// list of notifications.
function instance({ open = false } = {}) {
  const list = [];
  const requests = [];
  const server = createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    if (url.pathname === "/api/health") {
      res.setHeader("Content-Type", "application/json");
      return res.end(JSON.stringify({ service: "flowplan" }));
    }
    if (url.pathname === "/set") {
      res.setHeader("Set-Cookie", "sid=ok; Path=/; HttpOnly; Max-Age=3600");
      return res.end("ok");
    }
    if (url.pathname === "/api/notifications") {
      requests.push({ since: url.searchParams.get("since"), cookie: req.headers.cookie || "" });
      res.setHeader("Content-Type", "application/json");
      if (!open && !/sid=ok/.test(req.headers.cookie || "")) {
        res.statusCode = 401;
        return res.end(JSON.stringify({ error: "Bitte melde dich an." }));
      }
      const since = url.searchParams.get("since");
      const items = list.filter((n) => !since || Date.parse(n.createdAt) >= Date.parse(since)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      return res.end(JSON.stringify({ now: new Date().toISOString(), unread: list.filter((n) => !n.read).length, notifications: items }));
    }
    res.setHeader("Content-Type", "text/html");
    res.end(`<!doctype html><title>Instance</title><h1>Instance</h1><p id="hash"></p>`);
  });
  return new Promise((done) =>
    server.listen(0, "127.0.0.1", () =>
      done({
        origin: `http://localhost:${server.address().port}`,
        list,
        requests,
        stop: () => new Promise((closed) => (server.close(closed), server.closeAllConnections())),
      }),
    ),
  );
}
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
async function until(test, message, timeout = 20000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await test()) return;
    await sleep(150);
  }
  throw new Error(`timed out: ${message}`);
}
const a = await instance();
const b = await instance({ open: true });
const dir = mkdtempSync(join(tmpdir(), "flowplan-notifications-"));
const config = () => JSON.parse(readFileSync(join(dir, "config.json"), "utf8"));
writeFileSync(
  join(dir, "config.json"),
  JSON.stringify({
    profiles: [
      { id: "work", name: "Work", server: a.origin },
      { id: "home", name: "Home", server: b.origin },
    ],
    activeProfile: "work",
  }),
);
const launch = () =>
  electron.launch({
    executablePath,
    args: [...(packaged ? [] : ["."]), `--user-data-dir=${dir}`],
    cwd: new URL("..", import.meta.url).pathname,
    env: { ...process.env, FLOWPLAN_NOTIFICATION_INTERVAL: "2" },
  });
async function instanceWindow(app) {
  await until(async () => {
    for (const page of app.windows()) if (!page.isClosed() && (await page.title().catch(() => "")) === "Instance") return true;
    return false;
  }, "the instance in the window");
  return app.windows().find((page) => !page.isClosed() && page.url().startsWith(a.origin));
}
// What the app showed and set (notifier.js reports it as app events).
const listen = (app) =>
  app.evaluate(({ app }) => {
    globalThis.shown = [];
    globalThis.badge = null;
    app.on("flowplan-notification", (n) => globalThis.shown.push(n));
    app.on("flowplan-badge", (n) => (globalThis.badge = n));
  });
const shown = (app) => app.evaluate(() => globalThis.shown.map(({ title, body, url, profile }) => ({ title, body, url, profile })));
const badge = (app) => app.evaluate(() => globalThis.badge);
const hide = (app) => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].hide());
const clickMenu = (app, id) => app.evaluate(({ Menu }, id) => Menu.getApplicationMenu().getMenuItemById(id).click(), id);
const menuChecked = (app, id) => app.evaluate(({ Menu }, id) => Menu.getApplicationMenu().getMenuItemById(id).checked, id);

{
  const app = await launch();
  await listen(app);
  const window = await instanceWindow(app);
  // The tiny bridge on the instance; the profiles bridge stays away.
  assert.equal(await window.evaluate(() => window.FlowplanDesktop.platform), "desktop");
  assert.match(await window.evaluate(() => window.FlowplanDesktop.version), /^\d+\.\d+\.\d+/);
  assert.equal(await window.evaluate(() => window.FlowplanDesktop.notifications.enabled()), true);
  assert.equal(await window.evaluate(() => typeof window.flowplanDesktop), "undefined");
  assert.deepEqual(await window.evaluate(() => Object.keys(window.FlowplanDesktop).sort()), ["notifications", "platform", "version"]);
  console.log("✔ Kleine Brücke nur auf der Instanz");

  // Signed out: the instance answers 401 and nothing is shown.
  await until(() => a.requests.length >= 1, "a first request");
  assert.equal(a.requests[0].cookie, "", "no cookie before signing in");
  assert.ok([null, 0].includes(await badge(app)), "no badge while signed out");

  // Signed in with one old notification: it only becomes known.
  a.list.push({ id: "old", text: "Old", detail: "", url: "/#page=old", createdAt: at(1), read: false, push: true });
  await window.evaluate(() => fetch("/set"));
  await window.evaluate(() => window.FlowplanDesktop.notifications.refresh());
  await until(async () => (await badge(app)) === 1, "the badge shows one unread");
  assert.equal(config().notificationState.work.primed, true);
  assert.equal(a.requests.at(-1).cookie, "sid=ok", "the profile's own session");
  assert.deepEqual(await shown(app), [], "old notifications are not shown");

  // New ones while the window is hidden: one shown (push on, unread), the
  // badge counts every unread one.
  await hide(app);
  a.list.push({ id: "n1", text: "Anna mentioned you in “Plan”", detail: "Offer", url: "/#page=abc", createdAt: at(2), read: false, push: true });
  a.list.push({ id: "n2", text: "Change", detail: "", url: "/#page=n2", createdAt: at(2), read: false, push: false });
  a.list.push({ id: "n3", text: "Read", detail: "", url: "/#page=n3", createdAt: at(3), read: true, push: true });
  await until(async () => (await shown(app)).length === 1 && (await badge(app)) === 3, "a notification and the badge");
  assert.deepEqual(await shown(app), [{ title: "Anna mentioned you in “Plan”", body: "Offer · Work", url: "/#page=abc", profile: "work" }], "with two profiles the profile is named");
  await until(() => a.requests.at(-1).since === at(3), "asks from the newest known on");
  console.log("✔ Neue Benachrichtigung und Badge");

  // A click brings the window back with the page.
  await app.evaluate(() => globalThis.shown[0].click());
  await until(() => window.url() === `${a.origin}/#page=abc`, "the page of the notification");
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()), true);
  // An address of another site never opens: the instance's start page does.
  await app.evaluate(({ shell }) => {
    globalThis.opened = [];
    shell.openExternal = async (url) => void globalThis.opened.push(url);
  });
  await hide(app);
  a.list.push({ id: "n4", text: "Elsewhere", detail: "", url: "https://evil.example/#page=x", createdAt: at(4), read: false, push: true });
  await until(async () => (await shown(app)).length === 2, "the second notification");
  await app.evaluate(() => globalThis.shown[1].click());
  await until(() => window.url() === `${a.origin}/`, "the start page");
  assert.deepEqual(await app.evaluate(() => globalThis.opened), []);
  console.log("✔ Klick öffnet die Seite auf der Instanz");

  // Do Not Disturb: the badge follows, nothing pops up – also not later.
  await clickMenu(app, "dnd-hour");
  assert.equal(config().notifications.dnd, "hour");
  assert.ok(config().notifications.dndUntil > Date.now() + 3500000);
  assert.equal(await menuChecked(app, "dnd-hour"), true);
  await hide(app);
  a.list.push({ id: "n5", text: "Quiet", detail: "", url: "/#page=n5", createdAt: at(5), read: false, push: true });
  await until(async () => (await badge(app)) === 5, "the badge during Do Not Disturb");
  await clickMenu(app, "dnd-off");
  assert.equal(await menuChecked(app, "dnd-off"), true);
  const asked = a.requests.length;
  await until(() => a.requests.length >= asked + 1, "another request");
  assert.equal((await shown(app)).length, 2, "nothing shown during Do Not Disturb, nor afterwards");
  console.log("✔ Nicht stören");

  // Switched off from the web app's settings: no requests, no badge.
  assert.equal(await window.evaluate(() => window.FlowplanDesktop.notifications.setEnabled(false)), false);
  assert.equal(config().notifications.enabled, false);
  assert.equal(await menuChecked(app, "notifications-enabled"), false);
  await until(async () => (await badge(app)) === 0, "the badge is cleared");
  const stopped = a.requests.length;
  await sleep(3000);
  assert.equal(a.requests.length, stopped, "no more requests");
  await clickMenu(app, "notifications-enabled");
  assert.equal(config().notifications.enabled, true);
  await until(async () => (await badge(app)) === 5, "on again");
  assert.equal(b.requests.length, 0, "only the active profile is asked");
  console.log("✔ Ein- und ausschalten");

  // All profiles: the other profile's instance is asked too, and a click
  // switches to that profile.
  await clickMenu(app, "notifications-all-profiles");
  assert.equal(config().notifications.allProfiles, true);
  await until(() => b.requests.length >= 1, "the other profile is asked");
  await hide(app);
  b.list.push({ id: "h1", text: "Home news", detail: "", url: "/#page=h1", createdAt: at(7), read: false, push: true });
  await until(async () => (await shown(app)).length === 3, "a notification of the other profile");
  assert.deepEqual((await shown(app))[2], { title: "Home news", body: "Home", url: "/#page=h1", profile: "home" });
  await until(async () => (await badge(app)) === 6, "the badge counts both profiles");
  await app.evaluate(() => globalThis.shown[2].click());
  const home = await (async () => {
    let found;
    await until(() => (found = app.windows().find((p) => !p.isClosed() && p.url() === `${b.origin}/#page=h1`)), "the other profile's page");
    return found;
  })();
  assert.equal(config().activeProfile, "home");
  assert.equal(await home.evaluate(() => window.FlowplanDesktop.platform), "desktop", "the bridge on the other instance");
  await clickMenu(app, "notifications-all-profiles");
  assert.equal(config().notifications.allProfiles, false);
  await until(async () => (await badge(app)) === 1, "only the active profile again");
  // The app's own pages have the profiles bridge, not this one.
  await clickMenu(app, "manage-profiles");
  await until(async () => (await home.evaluate(() => location.protocol).catch(() => "")) === "file:", "the profiles page");
  assert.equal(await home.evaluate(() => typeof window.FlowplanDesktop), "undefined");
  assert.equal(await home.evaluate(() => typeof window.flowplanDesktop), "object");
  // Back to the first profile for the restart.
  await home.evaluate(() => window.flowplanDesktop.switchProfile("work"));
  console.log("✔ Alle Profile, Klick wechselt das Profil");
  await app.close();
}

// After a restart nothing is shown twice; new ones still are.
{
  const app = await launch();
  await listen(app);
  await instanceWindow(app);
  await hide(app);
  const asked = a.requests.length;
  await until(() => a.requests.length >= asked + 2, "two requests after the restart");
  assert.deepEqual(await shown(app), []);
  a.list.push({ id: "n6", text: "After restart", detail: "", url: "/#page=n6", createdAt: at(6), read: false, push: true });
  await until(async () => (await shown(app)).length === 1, "a new one after the restart");
  assert.equal((await shown(app))[0].title, "After restart");
  await app.close();
  console.log("✔ Nach Neustart nichts doppelt");
}
await a.stop();
await b.stop();
