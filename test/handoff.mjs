// Handoff (macOS, handoff.js): which page the window offers to the iPad and
// iPhone, where a page handed over from there opens, and the wiring – with
// a stand-in for Electron's app and windows, so Node alone runs it.
// Usage: node test/handoff.mjs
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

const require = createRequire(import.meta.url);
const { ACTIVITY_TYPE, pageActivity, continueTarget, setupHandoff } = require("../handoff.js");
const server = "https://flowplan.example.com";
const PAGE = "3f2b8c1e-7d4a-4b6e-9a1c-2e5f6a7b8c9d";

// What the window offers: pages of its instance only.
{
  assert.equal(ACTIVITY_TYPE, "app.flowplan.page", "the type the iOS app advertises and continues");
  assert.deepEqual(pageActivity(`${server}/#page=${PAGE}`, server, " Plan "), {
    type: ACTIVITY_TYPE,
    userInfo: { url: `${server}/#page=${PAGE}`, title: "Plan" },
    webpageURL: `${server}/#page=${PAGE}`,
  });
  assert.equal(pageActivity(`${server}/`, server, "").userInfo.title, "Flowplan");
  assert.equal(pageActivity(`${server}/api/export/x`, server, "x"), null, "no endpoints");
  assert.equal(pageActivity("file:///app/pages/setup.html", server, "Setup"), null, "not the app's own pages");
  assert.equal(pageActivity("https://login.example/authorize", server, "x"), null, "not the identity provider");
  assert.equal(pageActivity(`${server}/`, undefined, "x"), null, "no profile yet");
  assert.equal(pageActivity("https://user:pw@flowplan.example.com/", server, "x"), null);
  assert.equal(pageActivity(`${server}/x`, server, "a".repeat(500)).userInfo.title.length, 200);
}

// Where a page from the iPad or iPhone goes.
{
  const profiles = [
    { id: "work", server },
    { id: "home", server: "https://notes.example" },
  ];
  assert.deepEqual(continueTarget(ACTIVITY_TYPE, {}, { webpageURL: `https://notes.example/#page=${PAGE}` }, profiles), { profileId: "home", url: `https://notes.example/#page=${PAGE}` });
  // userInfo.url when the system leaves webpageURL out.
  assert.deepEqual(continueTarget(ACTIVITY_TYPE, { url: `${server}/#tasks` }, {}, profiles), { profileId: "work", url: `${server}/#tasks` });
  assert.deepEqual(continueTarget(ACTIVITY_TYPE, {}, { webpageURL: "https://other.example/#page=1" }, profiles), { browser: "https://other.example/#page=1" }, "unknown instance: the browser");
  assert.equal(continueTarget(ACTIVITY_TYPE, {}, { webpageURL: "http://other.example/" }, profiles), null, "plain http of a stranger: nothing");
  assert.equal(continueTarget(ACTIVITY_TYPE, {}, { webpageURL: "javascript:alert(1)" }, profiles), null);
  assert.equal(continueTarget(ACTIVITY_TYPE, {}, { webpageURL: "flowplan://open" }, profiles), null);
  assert.equal(continueTarget(ACTIVITY_TYPE, {}, { webpageURL: `${server}/api/auth/logout` }, profiles), null);
  assert.equal(continueTarget("com.apple.other", {}, { webpageURL: `${server}/` }, profiles), null, "other types are not ours");
  assert.equal(continueTarget(ACTIVITY_TYPE, null, undefined, profiles), null);
}

// The wiring: offers the focused window's page, takes pages handed over –
// also one that arrives while the app starts – and does nothing off macOS.
{
  const calls = [];
  const app = new EventEmitter();
  app.setUserActivity = (type, userInfo, url) => calls.push(["set", type, userInfo.url, url]);
  app.invalidateCurrentActivity = () => calls.push(["invalidate"]);
  const opened = [];
  const browser = [];
  const profiles = [{ id: "work", server }];
  const handoff = setupHandoff({ app, profiles: () => profiles, open: (id, url) => opened.push([id, url]), openExternal: (url) => browser.push(url), platform: "darwin" });

  // A page handed over before the window exists waits for it.
  const early = { defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
  app.emit("continue-activity", early, ACTIVITY_TYPE, {}, { webpageURL: `${server}/#page=${PAGE}` });
  assert.equal(early.defaultPrevented, true, "handled");
  assert.deepEqual(opened, []);
  handoff.ready();
  assert.deepEqual(opened, [["work", `${server}/#page=${PAGE}`]]);
  const will = { defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
  app.emit("will-continue-activity", will, ACTIVITY_TYPE);
  assert.equal(will.defaultPrevented, true);
  const foreign = { defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
  app.emit("continue-activity", foreign, "com.example.other", {}, {});
  assert.equal(foreign.defaultPrevented, false, "other types are left to the system");
  app.emit("continue-activity", { preventDefault() {} }, ACTIVITY_TYPE, {}, { webpageURL: "https://other.example/x" });
  assert.deepEqual(browser, ["https://other.example/x"]);

  const makeWindow = (url, focused = true) => {
    const w = new EventEmitter();
    w.webContents = new EventEmitter();
    w.webContents.getURL = () => url;
    w.webContents.getTitle = () => "Plan";
    w.isDestroyed = () => false;
    w.isFocused = () => focused;
    w.go = (next) => {
      url = next;
      w.webContents.emit("did-navigate-in-page");
    };
    return w;
  };
  const w = makeWindow(`${server}/#home`);
  handoff.track(w, () => server);
  w.emit("focus");
  w.go(`${server}/#page=${PAGE}`);
  w.webContents.emit("page-title-updated");
  assert.deepEqual(calls, [
    ["set", ACTIVITY_TYPE, `${server}/#home`, `${server}/#home`],
    ["set", ACTIVITY_TYPE, `${server}/#page=${PAGE}`, `${server}/#page=${PAGE}`],
  ], "once per page");
  // The app's own pages offer nothing.
  w.go("file:///pages/offline.html");
  assert.deepEqual(calls.at(-1), ["invalidate"]);
  // A window that replaced this one keeps its page when the old one closes.
  w.go(`${server}/#inbox`);
  const next = makeWindow(`${server}/#tasks`);
  handoff.track(next, () => server);
  next.emit("focus");
  const before = calls.length;
  w.emit("closed");
  assert.equal(calls.length, before);
  next.emit("closed");
  assert.deepEqual(calls.at(-1), ["invalidate"]);

  // Windows and Linux: nothing is registered.
  const other = new EventEmitter();
  const off = setupHandoff({ app: other, profiles: () => profiles, open() {}, openExternal() {}, platform: "linux" });
  off.track(makeWindow(`${server}/`), () => server);
  off.ready();
  assert.equal(other.listenerCount("continue-activity"), 0);
}

// The Mac app declares the type (Info.plist) and ships the file.
{
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.deepEqual(pkg.build.mac.extendInfo.NSUserActivityTypes, [ACTIVITY_TYPE]);
  assert.ok(pkg.build.files.includes("handoff.js"));
}

console.log("handoff: ok");
