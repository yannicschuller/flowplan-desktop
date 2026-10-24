// Handoff (macOS): the window offers the page it shows to the person's iPad
// and iPhone (and other Macs) as the activity "app.flowplan.page" with the
// page's address as webpageURL – the Flowplan app there opens it, without the
// app the device's browser does. Pages handed over from the iPad or iPhone
// (the app advertises the same type) open here on the profile of their
// instance; pages of an instance without a profile open in the browser.
//
// Handoff needs the same Apple Developer Team as the iOS app and the type in
// Info.plist (NSUserActivityTypes, package.json → build.mac.extendInfo).
// The decisions are plain functions (test/handoff.mjs runs them with Node);
// setupHandoff wires them to Electron.
const { sameOrigin } = require("./guards");

const ACTIVITY_TYPE = "app.flowplan.page";
const MAX_TITLE = 200;

const parse = (value) => {
  try {
    return new URL(String(value));
  } catch {
    return null;
  }
};
const instancePage = (url) => !!url && (url.protocol === "https:" || url.protocol === "http:") && !url.username && !url.password && !url.pathname.startsWith("/api/");

// What the window hands over: a page of its profile's instance – not its
// endpoints, not the app's own pages (setup, offline, profiles) – or null.
function pageActivity(url, server, title) {
  const page = parse(url);
  if (!server || !instancePage(page) || !sameOrigin(page.href, server)) return null;
  const name = String(title || "").trim().slice(0, MAX_TITLE) || "Flowplan";
  return { type: ACTIVITY_TYPE, userInfo: { url: page.href, title: name }, webpageURL: page.href };
}

// Where a page handed over from another device goes: { profileId, url } for
// an instance with a profile, { browser: url } for other https pages, null
// for anything else.
function continueTarget(type, userInfo, details, profiles) {
  if (type !== ACTIVITY_TYPE) return null;
  const page = parse(details?.webpageURL || userInfo?.url);
  if (!instancePage(page)) return null;
  const profile = (profiles || []).find((p) => sameOrigin(page.href, p.server));
  if (profile) return { profileId: profile.id, url: page.href };
  return page.protocol === "https:" ? { browser: page.href } : null;
}

// Wires Handoff on macOS. track(window, server) follows a window's page;
// ready() lets a page handed over while the app was starting open.
function setupHandoff({ app, profiles, open, openExternal, platform = process.platform }) {
  if (platform !== "darwin") return { track() {}, ready() {} };
  let current = "";
  // The window whose page is offered.
  let owner = null;
  let started = false;
  let waiting = null;
  const advertise = (activity, w) => {
    owner = activity ? w : null;
    const key = activity ? JSON.stringify(activity) : "";
    if (key === current) return;
    current = key;
    try {
      if (activity) app.setUserActivity(activity.type, activity.userInfo, activity.webpageURL);
      else app.invalidateCurrentActivity();
    } catch {}
  };
  const take = (target) => {
    if (target.browser) return void openExternal(target.browser);
    open(target.profileId, target.url);
  };
  app.on("will-continue-activity", (event, type) => {
    if (type === ACTIVITY_TYPE) event.preventDefault();
  });
  app.on("continue-activity", (event, type, userInfo, details) => {
    const target = continueTarget(type, userInfo, details, profiles());
    if (!target) return;
    event.preventDefault();
    if (started) take(target);
    else waiting = target;
  });
  return {
    // The page of the window in front; the app's own pages hand nothing over.
    track(w, server) {
      const update = () => {
        if (w.isDestroyed() || !w.isFocused()) return;
        advertise(pageActivity(w.webContents.getURL(), server(), w.webContents.getTitle()), w);
      };
      w.webContents.on("did-navigate", update);
      w.webContents.on("did-navigate-in-page", update);
      w.webContents.on("page-title-updated", update);
      w.on("focus", update);
      // A closed window takes its page along (not the one of a window that
      // replaced it meanwhile).
      w.on("closed", () => {
        if (owner === w) advertise(null, null);
      });
    },
    ready() {
      started = true;
      if (waiting) {
        const target = waiting;
        waiting = null;
        take(target);
      }
    },
  };
}

module.exports = { ACTIVITY_TYPE, pageActivity, continueTarget, setupHandoff };
