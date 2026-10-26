// Flowplan for macOS, Windows and Linux: a window around a Flowplan instance.
// Everything runs on the server; the app remembers the instances (profiles,
// profiles.js), the window and offers native menus, links in the browser, an
// offline page (when the service worker of offline use has no copy,
// fallback.js), updates of itself (updates.js) and system notifications with
// the unread count on the icon (notifier.js, notifications.js – Electron has
// no Web Push). Around that: a right-click menu with spelling suggestions
// (context-menu.js), quick capture from anywhere (capture.js), a tray or
// menu bar icon (tray.js), flowplan:// links to pages (deep-links.js), pages
// in windows of their own (page-windows.js), files dropped on the app
// (files.js), launch at login (autostart.js), printing and PDFs (print.js)
// and the settings for all of it (settings.js, pages/settings.html). What
// the app asks an instance itself goes through instance-api.js with the
// profile's own session. Its own words come in the system language
// (strings.js); what the window lets through is decided in guards.js.
const {
  app,
  BrowserWindow,
  Menu,
  shell,
  ipcMain,
  session,
  dialog,
  nativeTheme,
  net,
  Notification,
  globalShortcut,
} = require("electron");
const path = require("node:path");
const updates = require("./updates");
const { setupBrowserSignIn } = require("./sign-in");
const { fallbackFor } = require("./fallback");
const strings = require("./strings");
const { isOwnPage, isInstancePage, allowedInWindow, isSignInRedirect, permissionAllowed, classifyHealth, defaultPagesDir, sameOrigin: sameOriginAs, instancePageUrl, opensOwnWindow, externalUrl, dictionaryWord } = require("./guards");
const profiles = require("./profiles");
const { setupNotifier } = require("./notifier");
const notificationRules = require("./notifications");
const { setupHandoff } = require("./handoff");
const appSettings = require("./settings");
const contextMenu = require("./context-menu");
const { createInstanceApi, pageAddress } = require("./instance-api");
const { setupCapture } = require("./capture");
const { setupTray } = require("./tray");
const deepLinks = require("./deep-links");
const pageWindowRules = require("./page-windows");
const fileRules = require("./files");
const autostart = require("./autostart");
const printing = require("./print");
const fs = require("node:fs");

const { t } = strings;
const isMac = process.platform === "darwin";
const configFile = () => path.join(app.getPath("userData"), "config.json");
function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(configFile(), "utf8"));
  } catch {
    return {};
  }
}
function writeConfig(patch) {
  const next = { ...readConfig(), ...patch };
  fs.mkdirSync(path.dirname(configFile()), { recursive: true });
  // Written next to it and renamed: a crash or a reader never sees half a
  // file (and with it no profiles).
  const temporary = `${configFile()}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(next, null, 2));
  fs.renameSync(temporary, configFile());
  return next;
}
// The app's own settings (settings.js), checked every time they are read.
const settings = () => appSettings.settingsOf(readConfig());
// Addresses are https (or http only for local development).
function normalizeServer(input) {
  let value = String(input || "").trim();
  if (!value) throw new Error(t("server.empty"));
  if (!/^https?:\/\//i.test(value)) value = `https://${value}`;
  const url = new URL(value);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !local) throw new Error(t("server.httpsOnly"));
  return url.origin;
}
// Only a Flowplan instance is accepted: its health check names the service
// (older versions are recognised by the fields of their answer), and the
// address must not redirect to another site. The message tells apart an
// unreachable address, a proxy that wants a sign-in first, a server error, a
// web page that is something else and no Flowplan at all.
async function checkServer(origin) {
  let response;
  try {
    response = await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(8000) });
  } catch (e) {
    const reason = e?.cause?.code || e?.code || e?.name || "network";
    throw new Error(t("server.unreachable", reason));
  }
  if (new URL(response.url).origin !== origin) throw new Error(t("server.redirects", new URL(response.url).origin));
  const data = await response.json().catch(() => null);
  const verdict = classifyHealth({ status: response.status, contentType: response.headers.get("content-type") || "", data });
  if (verdict === "ok") return true;
  if (verdict === "proxy-auth") throw new Error(t("server.proxyAuth", response.status));
  if (verdict === "error") throw new Error(t("server.status", response.status));
  if (verdict === "html") throw new Error(t("server.html"));
  throw new Error(t("server.notFlowplan"));
}

// The saved instances and the active one (profiles.js). Read once the app is
// ready (the user data folder may come from --user-data-dir).
let state = { profiles: [], activeProfile: null };
// Notifications of the watched profiles (notifier.js), set up once ready.
let notifier = null;
// Quick capture (capture.js) and the tray icon (tray.js), set up once ready.
let capture = null;
let tray = null;
let ready = false;
let quitting = false;
function saveProfiles(next) {
  const before = state.activeProfile;
  state = next;
  writeConfig(profiles.toConfig(state));
  refreshProfileMenus();
  notifier?.reconcile();
  tray?.refresh({ reload: before !== state.activeProfile });
}
const activeProfile = () => profiles.activeOf(state);
// The main window belongs to one profile: its session, its instance. A new
// profile gets a new window (the session of a window cannot change).
let win = null;
let winProfile = null;
// Suggested on the setup page: the public instance, or for managed
// installations --server=<url> or the environment variable FLOWPLAN_SERVER.
// The first start always asks; only the confirmed address is remembered.
const DEFAULT_SERVER = "https://app.flowplan.org";
function presetServer() {
  const arg = process.argv.find((a) => a.startsWith("--server="));
  const value = arg ? arg.slice("--server=".length) : process.env.FLOWPLAN_SERVER;
  if (!value) return undefined;
  try {
    return normalizeServer(value);
  } catch {
    return undefined;
  }
}
const server = () => activeProfile()?.server;
const preload = path.join(__dirname, "preload.js");
const signIn = setupBrowserSignIn({ server, getWindow: () => win, preload, locale: strings.locale });
const page = (name) => path.join(defaultPagesDir, name);
// The app's own pages get the language in their address.
const loadPage = (name, query = {}, w = win) => w.loadFile(page(name), { query: { ...query, lang: strings.locale() } });
// The instance's start page, or `target` when it is an address of the same
// instance (a clicked notification, checked by notifications.targetUrl).
function openServer(target) {
  const origin = server();
  if (!win) return;
  if (!origin) return loadPage("setup.html", { server: presetServer() || DEFAULT_SERVER });
  win.loadURL(target && sameOriginAs(target, origin) ? target : origin).catch(() => {});
}
// Windows and Linux menus treat "&" as a mnemonic marker.
const menuText = (text) => (isMac ? text : text.replace(/&/g, "&&"));

// Every session of a profile gets the same rules once: spell checking, the
// permissions of its own instance and the identity hosts of its sign-in.
// Which profile a session belongs to is looked up at the time of a request,
// so a session never acts for another profile's instance.
const sessionOwner = new WeakMap(); // session → profile id (or null)
const prepared = new WeakSet();
const preparedSessions = new Set(); // for a change of the spell checker's languages
// Hosts seen during a profile's sign-in are allowed in its window afterwards.
const identityHosts = new Map(); // profile id → Set of hosts
const hostsOf = (id) => {
  if (!identityHosts.has(id)) identityHosts.set(id, new Set());
  return identityHosts.get(id);
};
const ownerOf = (ses) => profiles.findProfile(state, sessionOwner.get(ses));
function prepareSession(ses) {
  if (prepared.has(ses)) return;
  prepared.add(ses);
  preparedSessions.add(ses);
  ses.setSpellCheckerLanguages?.(settings().spellLanguages);
  // The instance gets notifications, clipboard, fullscreen and the
  // microphone alone (voice notes) – no camera, no screen – and only the
  // instance of the active profile that owns this session.
  ses.setPermissionRequestHandler((wc, permission, done, details) => {
    const owner = ownerOf(ses);
    const fromInstance = !!owner && owner.id === state.activeProfile && sameOriginAs(wc.getURL(), owner.server);
    done(permissionAllowed(permission, details, fromInstance));
  });
  ses.webRequest.onBeforeRedirect((details) => {
    if (details.resourceType !== "mainFrame") return;
    const owner = ownerOf(ses);
    if (!owner) return;
    let from, next;
    try {
      from = new URL(details.url);
      next = new URL(details.redirectURL);
    } catch {
      return;
    }
    if (next.origin === owner.server) return;
    // From the instance's sign-in to the provider, and from one host of the
    // provider to the next (login.example → account.example).
    const hosts = hostsOf(owner.id);
    if (isSignInRedirect(details.url, owner.server) || hosts.has(from.host)) hosts.add(next.host);
  });
}
function sessionFor(profile) {
  const partition = profiles.partitionFor(profile);
  return partition ? session.fromPartition(partition) : session.defaultSession;
}
function setSpellLanguages(list) {
  changeSettings({ spellLanguages: list });
}
// The instance of a profile, asked with that profile's session
// (instance-api.js). Kept a few minutes, so its workspaces are asked once.
const apis = new Map(); // profile id → { api, server, at }
function apiFor(profile) {
  const cached = apis.get(profile.id);
  if (cached && cached.server === profile.server && Date.now() - cached.at < 10 * 60_000) return cached.api;
  const ses = sessionFor(profile);
  const api = createInstanceApi({ origin: profile.server, fetch: (url, init) => ses.fetch(url, init) });
  apis.set(profile.id, { api, server: profile.server, at: Date.now() });
  return api;
}

// ---- Windows ----

// Every window of a profile – the main window and pages in windows of their
// own – is made the same way and follows the same rules.
const windowProfile = new WeakMap(); // BrowserWindow → profile id
function makeWindow(profile, { bounds = {}, title = "Flowplan" } = {}) {
  const partition = profiles.partitionFor(profile);
  const ses = sessionFor(profile);
  sessionOwner.set(ses, profile ? profile.id : null);
  prepareSession(ses);
  const w = new BrowserWindow({
    width: bounds.width || 1320,
    height: bounds.height || 860,
    x: bounds.x,
    y: bounds.y,
    minWidth: 380,
    minHeight: 500,
    title,
    show: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#16151b" : "#fcfbf8",
    autoHideMenuBar: !isMac,
    webPreferences: {
      preload,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: true,
      ...(partition ? { partition } : {}),
      // The preload offers window.FlowplanDesktop on this instance alone.
      additionalArguments: profile ? [`--flowplan-instance=${profile.server}`, `--flowplan-version=${app.getVersion()}`] : [],
    },
  });
  windowProfile.set(w, profile ? profile.id : null);
  return w;
}
// The rules of a window: what may open in it, what goes to the browser, its
// title, the right-click menu, Handoff, files dropped on it.
function wireWindow(w, profileId, { primary }) {
  // The instance of this window's profile – checked at every navigation, so
  // only the active profile's origin stays inside the window.
  const origin = () => (profileId ? profiles.findProfile(state, profileId)?.server : undefined);
  const sameOrigin = (url) => sameOriginAs(url, origin());
  // With more than one profile the title names the profile.
  w.webContents.on("page-title-updated", (event, title) => {
    const own = profiles.findProfile(state, profileId);
    if (!own || state.profiles.length < 2) return;
    event.preventDefault();
    w.setTitle(`${title} – ${own.name}`);
  });
  // Links to other sites open in the default browser; sign-in pages of the
  // identity provider stay in the window. A page of the instance asked for
  // in another window (Shift-, middle- or Ctrl-click, window.open) gets a
  // window of its own.
  w.webContents.setWindowOpenHandler(({ url, disposition }) => {
    if (signIn.intercept(url)) return { action: "deny" };
    const own = instancePageUrl(url, origin());
    if (own && opensOwnWindow(disposition)) openPageWindow(profileId, own);
    else if (!sameOrigin(url) && /^(https?:|mailto:)/i.test(url))
      void shell.openExternal(url);
    else if (sameOrigin(url)) w.loadURL(url);
    return { action: "deny" };
  });
  w.webContents.on("will-navigate", (event, url) => {
    // Passkeys and SSO: sign in through the system browser (sign-in.js).
    if ((win === w || !primary) && profileId === state.activeProfile && signIn.intercept(url)) return event.preventDefault();
    // In the window: the app's own pages, the profile's instance (its
    // /api/auth/… sign-in included) and the identity provider its sign-in
    // redirected to. Any other address – also one that merely contains
    // /api/auth/, also another profile's instance – goes to the browser.
    if (allowedInWindow(url, { server: origin(), pagesDir: defaultPagesDir, identityHosts: profileId ? hostsOf(profileId) : new Set() })) return;
    event.preventDefault();
    if (/^https?:/i.test(url)) void shell.openExternal(url);
  });
  w.webContents.on("did-fail-load", (_e, code, description, url, isMain) => {
    if (!isMain || code === -3) return; // -3: navigation replaced
    if (primary && win !== w) return;
    // Offline copies open from the service worker under "/" (fallback.js).
    if (fallbackFor(url, origin()) === "start") return void w.loadURL(origin()).catch(() => {});
    loadPage("offline.html", { server: origin() || "", error: description || String(code) }, w);
  });
  contextMenu.attach(w, {
    t,
    dev: !app.isPackaged,
    settings,
    setSpellLanguages,
    origin,
    openWindow: (url) => openPageWindow(profileId, url),
    openExternal: (url) => void shell.openExternal(url),
  });
  handoff.track(w, origin);
}
function saveWindowState(w) {
  if (!w || w.isDestroyed()) return;
  const maximized = w.isMaximized();
  writeConfig({
    window: maximized ? { ...(readConfig().window || {}), maximized } : { ...w.getBounds(), maximized },
  });
}
function createWindow(profile = activeProfile(), target, { hidden = false } = {}) {
  const profileId = profile ? profile.id : null;
  const windowState = readConfig().window || {};
  const w = makeWindow(profile, { bounds: windowState });
  win = w;
  winProfile = profileId;
  if (windowState.maximized) w.maximize();
  w.once("ready-to-show", () => {
    // Started hidden at login (Windows and Linux without a tray icon):
    // minimised, not in front.
    if (hidden) {
      w.showInactive();
      w.minimize();
    } else w.show();
    // Windows: the dot on the taskbar button belongs to the window.
    if (win === w) notifier?.applyBadge(true);
    if (win === w) updates.refresh();
  });
  w.on("close", () => saveWindowState(w));
  w.on("closed", () => {
    if (win === w) win = null;
  });
  wireWindow(w, profileId, { primary: true });
  openServer(target);
  restorePageWindows(profileId);
  return w;
}
// Another profile: a new window in its session where the old one was; the
// old one goes once the new one shows (no blank screen in between). Pages in
// windows of their own belong to their profile: they close (and are
// remembered) and the new profile's come back.
function replaceWindow(profile, target) {
  const old = win && !win.isDestroyed() ? win : null;
  if (old) saveWindowState(old);
  signIn.reset();
  closePageWindows((id) => id !== (profile ? profile.id : null));
  const next = createWindow(profile, target);
  if (!old) return next;
  let gone = false;
  const close = () => {
    if (gone || old.isDestroyed()) return;
    gone = true;
    if (old.isFullScreen()) next.setFullScreen(true);
    old.destroy();
  };
  next.once("ready-to-show", close);
  setTimeout(close, 4000);
  return next;
}
function switchProfile(id) {
  const profile = profiles.findProfile(state, id);
  if (!profile) return;
  if (state.activeProfile !== id) saveProfiles({ ...state, activeProfile: id });
  if (win && !win.isDestroyed() && winProfile === id) {
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
    return openServer();
  }
  if (win && !win.isDestroyed()) replaceWindow(profile);
  else {
    closePageWindows((other) => other !== id);
    createWindow(profile);
  }
}
// A clicked notification: to the front, to its profile, to its page – an
// address of that profile's instance only (notifications.targetUrl).
function openFromNotification(id, url) {
  const profile = profiles.findProfile(state, id);
  if (!profile) return;
  const target = notificationRules.targetUrl(url, profile.server);
  // macOS: also out of "Hide Flowplan".
  if (isMac) app.focus({ steal: true });
  if (state.activeProfile !== id) saveProfiles({ ...state, activeProfile: id });
  if (win && !win.isDestroyed() && winProfile === id) {
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
    return openServer(target);
  }
  const next = win && !win.isDestroyed() ? replaceWindow(profile, target) : createWindow(profile, target);
  next.once("ready-to-show", () => next.focus());
}
// The main window back to the front (tray, second start, Dock), or a new one.
function showMainWindow() {
  if (isMac) app.focus({ steal: true });
  if (!win || win.isDestroyed()) return createWindow();
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  return win;
}
// Handoff (macOS, handoff.js): the window offers its page to the iPad and
// iPhone; their pages open here like a clicked notification – on the profile
// of their instance, at an address of that instance only.
const handoff = setupHandoff({
  app,
  profiles: () => state.profiles,
  open: openFromNotification,
  openExternal: (url) => void shell.openExternal(url),
});
// The profile whose window is in front: its notifications show in the
// inbox there, so no system notification pops up for them.
function focusedProfile() {
  const focused = BrowserWindow.getFocusedWindow();
  if (!focused || focused.isDestroyed() || !focused.isVisible() || focused.isMinimized()) return null;
  const id = windowProfile.get(focused);
  return id === undefined ? null : id;
}
// The window a command of the menu works on: the one in front, or the main window.
function frontWindow() {
  const focused = BrowserWindow.getFocusedWindow();
  if (focused && windowProfile.has(focused)) return focused;
  return win && !win.isDestroyed() ? win : null;
}

// ---- Pages in windows of their own (page-windows.js) ----

const pageWindows = new Map(); // BrowserWindow → { profileId, keep, url }
function savePageWindows(profileId) {
  if (quitting) return;
  const list = [...pageWindows]
    .filter(([w, entry]) => entry.profileId === profileId && !entry.keep && !w.isDestroyed())
    // A window still loading counts with the page it was opened for.
    .map(([w, entry]) => ({ url: w.webContents.getURL() || entry.url, bounds: w.getNormalBounds() }));
  writeConfig({ pageWindows: pageWindowRules.withPageWindows(readConfig(), state, profileId, list) });
}
function openPageWindow(profileId, url, bounds) {
  const profile = profiles.findProfile(state, profileId);
  const target = profile && instancePageUrl(url, profile.server);
  if (!target) return null;
  // A page cannot open windows without end.
  if ([...pageWindows.values()].filter((e) => e.profileId === profileId && !e.keep).length >= pageWindowRules.MAX_PAGE_WINDOWS) return null;
  // Next to the window in front, a little offset.
  let place = bounds;
  if (!place) {
    const from = frontWindow();
    if (from) {
      const b = from.getBounds();
      place = { x: b.x + 32, y: b.y + 32, width: Math.min(b.width, 1100), height: Math.min(b.height, 820) };
    }
  }
  const w = makeWindow(profile, { bounds: place || { width: 1100, height: 820 } });
  pageWindows.set(w, { profileId, keep: false, url: target });
  wireWindow(w, profileId, { primary: false });
  let timer = null;
  const save = () => {
    clearTimeout(timer);
    timer = setTimeout(() => savePageWindows(profileId), 600);
  };
  w.on("resize", save);
  w.on("move", save);
  w.webContents.on("did-navigate", save);
  w.webContents.on("did-navigate-in-page", save);
  w.once("ready-to-show", () => w.show());
  w.on("closed", () => {
    clearTimeout(timer);
    const entry = pageWindows.get(w);
    pageWindows.delete(w);
    if (entry && !entry.keep) savePageWindows(profileId);
  });
  w.loadURL(target).catch(() => {});
  savePageWindows(profileId);
  app.emit("flowplan-page-window", { profileId, url: target, window: w });
  return w;
}
// The remembered windows of a profile, unless already open.
function restorePageWindows(profileId) {
  const profile = profiles.findProfile(state, profileId);
  if (!profile) return;
  const open = new Set([...pageWindows].filter(([, e]) => e.profileId === profileId).map(([w]) => (w.isDestroyed() ? "" : w.webContents.getURL())));
  for (const saved of pageWindowRules.savedPageWindows(readConfig(), profile)) if (!open.has(saved.url)) openPageWindow(profileId, saved.url, saved.bounds);
}
// Closes page windows (of the profiles `which` picks) and keeps them in mind.
function closePageWindows(which) {
  for (const [w, entry] of pageWindows) {
    if (!which(entry.profileId) || w.isDestroyed()) continue;
    entry.keep = true;
    w.close();
  }
}

function showProfiles() {
  const w = showMainWindow();
  if (!w) return;
  loadPage("profiles.html");
}
function showAddProfile() {
  const w = showMainWindow();
  if (!w) return;
  loadPage("setup.html", { add: "1" });
}
// Signs the profile out of its instance (best effort) and removes what its
// session stored on this computer: cookies, the offline copy, caches.
async function forgetSession(profile) {
  const ses = sessionFor(profile);
  try {
    await ses.fetch(`${profile.server}/api/auth/logout`, {
      method: "POST",
      headers: { Origin: profile.server },
      signal: AbortSignal.timeout(3000),
    });
  } catch {}
  await ses.clearStorageData().catch(() => {});
  await ses.clearCache().catch(() => {});
}
async function removeProfileAsk(id) {
  const profile = profiles.findProfile(state, id);
  if (!profile) return false;
  const options = {
    type: "warning",
    buttons: [t("profiles.remove"), t("profiles.cancel")],
    defaultId: 1,
    cancelId: 1,
    message: t("profiles.removeConfirm", profile.name),
    detail: t("profiles.removeDetail", new URL(profile.server).host),
  };
  const { response } = await (win ? dialog.showMessageBox(win, options) : dialog.showMessageBox(options));
  if (response !== 0) return false;
  const wasActive = state.activeProfile === id;
  closePageWindows((other) => other === id);
  saveProfiles(profiles.removeProfile(state, id));
  writeConfig({ pageWindows: pageWindowRules.withPageWindows(readConfig(), state, null, []) });
  identityHosts.delete(id);
  apis.delete(id);
  notifier?.forgetProfile(id);
  if (wasActive || winProfile === id) replaceWindow(activeProfile());
  await forgetSession(profile);
  return true;
}

// ---- Settings (settings.js, pages/settings.html) ----

let settingsWindow = null;
function showSettings() {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.show();
    return settingsWindow.focus();
  }
  settingsWindow = new BrowserWindow({
    width: 560,
    height: 760,
    minWidth: 420,
    minHeight: 420,
    title: t("settings.title"),
    show: false,
    autoHideMenuBar: true,
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#16151b" : "#fcfbf8",
    webPreferences: { preload, contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  settingsWindow.setMenuBarVisibility(false);
  settingsWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  settingsWindow.webContents.on("will-navigate", (event) => event.preventDefault());
  settingsWindow.once("ready-to-show", () => settingsWindow.show());
  settingsWindow.on("closed", () => (settingsWindow = null));
  void loadPage("settings.html", {}, settingsWindow);
}
function publicSettings(extra = {}) {
  return {
    settings: settings(),
    shortcutStatus: capture ? capture.status() : "off",
    shortcutLabel: appSettings.shortcutLabel(settings().captureShortcut),
    platform: process.platform,
    version: app.getVersion(),
    ...extra,
  };
}
// A change from the menu or the settings page: saved, then applied.
function changeSettings(patch) {
  const before = settings();
  if (patch && "captureShortcut" in patch && capture) {
    const wanted = appSettings.applyPatch(readConfig(), { captureShortcut: patch.captureShortcut }).captureShortcut;
    if (wanted !== before.captureShortcut && capture.trySet(wanted) === "conflict")
      throw new Error(t("settings.shortcutTaken", appSettings.shortcutLabel(wanted)));
  }
  const next = appSettings.applyPatch(readConfig(), patch);
  writeConfig({ settings: next });
  if (next.tray !== before.tray) tray?.apply(next.tray);
  if (next.launchAtLogin !== before.launchAtLogin || next.startHidden !== before.startHidden) applyLoginItem(next);
  if (next.spellLanguages.join() !== before.spellLanguages.join())
    for (const ses of preparedSessions) ses.setSpellCheckerLanguages?.(next.spellLanguages);
  buildMenu();
  tray?.refresh();
  app.emit("flowplan-settings", next);
  return publicSettings();
}
function applyLoginItem(value) {
  try {
    autostart.apply(value, { app });
  } catch (e) {
    console.warn(`autostart: ${e.message}`);
  }
}

// ---- Quick capture, tray, links, files ----

function notify(title, body) {
  if (Notification.isSupported()) new Notification({ title, body }).show();
  app.emit("flowplan-notice", { title, body });
}
// flowplan://open… (deep-links.js): the page in the profile of its
// instance; an instance without a profile only after asking.
const pendingLinks = [];
function handleLink(raw) {
  const link = deepLinks.parseLink(raw);
  if (!link || link.kind !== "open") return;
  if (!ready) return void pendingLinks.push(raw);
  const target = deepLinks.linkTarget(link, state);
  if (target.profileId) return openFromNotification(target.profileId, target.url);
  void askAddInstance(target.unknown, target.url);
}
async function askAddInstance(origin, url) {
  if (isMac) app.focus({ steal: true });
  const host = new URL(origin).host;
  const options = {
    type: "question",
    buttons: [t("links.add"), t("links.browser"), t("links.cancel")],
    defaultId: 2,
    cancelId: 2,
    message: t("links.unknown", host),
    detail: t("links.unknownDetail", origin),
  };
  const parent = win && !win.isDestroyed() ? win : null;
  const { response } = await (parent ? dialog.showMessageBox(parent, options) : dialog.showMessageBox(options));
  app.emit("flowplan-link-asked", { origin, response });
  if (response === 1) {
    if (externalUrl(url)) void shell.openExternal(url);
    return;
  }
  if (response !== 0) return;
  try {
    if (state.profiles.length >= profiles.MAX_PROFILES) throw new Error(t("profiles.tooMany", profiles.MAX_PROFILES));
    await checkServer(origin);
  } catch (e) {
    dialog.showErrorBox(t("links.failed"), t("server.notFound", origin, e.message));
    return;
  }
  const { state: next, profile } = profiles.addProfile(state, { name: "", server: origin });
  saveProfiles(next);
  if (win && !win.isDestroyed()) replaceWindow(profile, url);
  else createWindow(profile, url);
}

// Files handed to the app (files.js): checked, confirmed, then sent.
let fileQueue = [];
let fileTimer = null;
function takeFiles(paths) {
  fileQueue.push(...paths);
  clearTimeout(fileTimer);
  // macOS reports a drop of several files one by one.
  fileTimer = setTimeout(() => {
    const list = [...new Set(fileQueue)];
    fileQueue = [];
    if (ready) void importFiles(list);
    else pendingFiles.push(...list);
  }, 300);
}
const pendingFiles = [];
function inspectFile(file) {
  const name = path.basename(file);
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile()) return { path: file, name, error: "type" };
    const buffer = Buffer.alloc(fileRules.HEAD_BYTES);
    const fd = fs.openSync(file, "r");
    let read = 0;
    try {
      read = fs.readSync(fd, buffer, 0, buffer.length, 0);
    } finally {
      fs.closeSync(fd);
    }
    const head = buffer.subarray(0, read);
    const verdict = fileRules.classifyFile({ name, size: stat.size, head });
    return { path: file, name, size: stat.size, ...verdict };
  } catch {
    return { path: file, name, error: "missing" };
  }
}
let importing = false;
async function importFiles(paths) {
  if (importing || !paths.length) return;
  const profile = activeProfile();
  const parent = win && !win.isDestroyed() ? win : null;
  const box = (options) => (parent ? dialog.showMessageBox(parent, options) : dialog.showMessageBox(options));
  if (!profile) return void box({ type: "info", message: t("files.noProfile") });
  const checked = paths.slice(0, fileRules.MAX_FILES).map(inspectFile);
  const accepted = checked.filter((f) => !f.error);
  const refused = checked.filter((f) => f.error);
  const refusedLines = refused.map((f) => `✕ ${f.name} – ${t(`files.refused.${f.error}`)}`);
  if (paths.length > fileRules.MAX_FILES) refusedLines.push(t("files.tooMany", fileRules.MAX_FILES));
  app.emit("flowplan-files", { accepted: accepted.map((f) => f.name), refused: refused.map((f) => [f.name, f.error]) });
  if (!accepted.length) return void box({ type: "warning", message: t("files.none"), detail: refusedLines.join("\n") });
  // Where to: confirmed first, nothing is read or sent before.
  if (isMac) app.focus({ steal: true });
  const { response } = await box({
    type: "question",
    buttons: [t("files.toInbox"), t("files.asPages"), t("files.cancel")],
    defaultId: 0,
    cancelId: 2,
    message: t("files.confirm", accepted.length, profile.name),
    detail: [...accepted.map((f) => `• ${f.name}`), ...refusedLines, "", t("files.where", new URL(profile.server).host)].join("\n"),
  });
  if (response === 2) return;
  importing = true;
  parent?.setProgressBar(2);
  try {
    const files = accepted.map((f) => ({ ...f, bytes: fs.readFileSync(f.path) }));
    const api = apiFor(profile);
    const inbox = await api.inbox().catch((e) => (response === 0 ? Promise.reject(e) : null));
    let url;
    if (response === 0) {
      // One record per image or PDF; Markdown and text through the import.
      const texts = files.filter((f) => fileRules.isText(f.kind));
      for (const file of files.filter((f) => !fileRules.isText(f.kind))) {
        const stored = await api.upload(inbox.pageId, { name: file.name, type: file.mime, bytes: file.bytes });
        await api.recordWithFile(inbox.pageId, fileRules.titleOf(file.name), stored);
      }
      if (texts.length) await api.importRecords(inbox.pageId, texts.map((f) => ({ name: f.kind === "text" ? `${fileRules.titleOf(f.name)}.md` : f.name, type: "text/markdown", bytes: f.bytes })));
      url = pageAddress(profile.server, inbox.pageId);
    } else {
      // New pages: in the space of the inbox, or the first space.
      const boot = await api.bootstrap(inbox?.workspaceId);
      const workspaceId = inbox?.workspaceId || boot.workspace;
      const spaceId = (inbox && boot.pageSpaces.get(inbox.pageId)) || boot.spaces[0];
      const vault = require("./instance-api").zipStore(fileRules.vaultEntries(files));
      const result = await api.importPages(workspaceId, spaceId, vault);
      url = pageAddress(profile.server, result.rootIds[0]);
    }
    notify(t("files.done", accepted.length), t(response === 0 ? "files.doneInbox" : "files.donePages"));
    app.emit("flowplan-files-done", { target: response === 0 ? "inbox" : "pages", url });
    tray?.refresh({ reload: true });
    openFromNotification(profile.id, url);
  } catch (e) {
    const { messageFor } = require("./capture");
    dialog.showErrorBox(t("files.failed"), messageFor(e, { t, host: new URL(profile.server).host }));
  } finally {
    importing = false;
    parent?.setProgressBar(-1);
  }
}

// ---- Menus ----

// Profiles in the menu, the dock (macOS) and the jump list (Windows).
function profileItems() {
  return state.profiles.map((p) => ({
    label: menuText(profiles.profileLabel(p)),
    type: "radio",
    checked: p.id === state.activeProfile,
    click: () => switchProfile(p.id),
  }));
}
function profileMenu() {
  const items = profileItems();
  return [
    ...items,
    ...(items.length ? [{ type: "separator" }] : []),
    {
      id: "next-profile",
      label: t("menu.nextProfile"),
      accelerator: "CmdOrCtrl+Shift+P",
      enabled: state.profiles.length > 1,
      click: () => {
        const next = profiles.nextProfile(state);
        if (next) switchProfile(next.id);
      },
    },
    { id: "add-profile", label: t("menu.addProfile"), click: showAddProfile },
    { id: "manage-profiles", label: t("menu.manageProfiles"), click: showProfiles },
  ];
}
// Notifications in the app menu: on/off, "Do Not Disturb" for an hour or
// until tomorrow morning, and the active or all profiles.
function notificationMenu() {
  const settings = notificationRules.settingsOf(readConfig());
  const dnd = notificationRules.dndChoice(settings);
  const until = dnd !== "off" ? new Date(settings.dndUntil).toLocaleString(strings.locale(), { weekday: "short", hour: "2-digit", minute: "2-digit" }) : "";
  return [
    {
      id: "notifications-enabled",
      label: t("menu.notificationsShow"),
      type: "checkbox",
      checked: settings.enabled,
      click: (item) => notifier?.setEnabled(item.checked),
    },
    {
      label: t("menu.doNotDisturb"),
      enabled: settings.enabled,
      submenu: [
        ...(until ? [{ label: t("menu.dndUntil", until), enabled: false }, { type: "separator" }] : []),
        { id: "dnd-off", label: t("menu.dndOff"), type: "radio", checked: dnd === "off", click: () => notifier?.setDnd("off") },
        { id: "dnd-hour", label: t("menu.dndHour"), type: "radio", checked: dnd === "hour", click: () => notifier?.setDnd("hour") },
        { id: "dnd-tomorrow", label: t("menu.dndTomorrow"), type: "radio", checked: dnd === "tomorrow", click: () => notifier?.setDnd("tomorrow") },
      ],
    },
    {
      id: "notifications-all-profiles",
      label: t("menu.notificationsAllProfiles"),
      type: "checkbox",
      checked: settings.allProfiles,
      enabled: settings.enabled,
      click: (item) => notifier?.setAllProfiles(item.checked),
    },
  ];
}
function refreshProfileMenus() {
  if (!app.isReady()) return;
  buildMenu();
  if (isMac) app.dock?.setMenu(Menu.buildFromTemplate([...profileItems(), ...(state.profiles.length ? [{ type: "separator" }] : []), { label: t("menu.addProfile"), click: showAddProfile }]));
  // The jump list starts the app with --profile=<id>; a running app gets it
  // as second instance and switches.
  if (process.platform === "win32" && app.isPackaged)
    app.setUserTasks(
      state.profiles.map((p) => ({
        program: process.execPath,
        arguments: `--profile=${p.id}`,
        iconPath: process.execPath,
        iconIndex: 0,
        title: profiles.profileLabel(p),
        description: t("profiles.openProfile", p.name),
      })),
    );
}
// "Open Page in New Window": the page of the window in front.
function pageInNewWindow() {
  const from = frontWindow();
  if (!from) return;
  const profileId = windowProfile.get(from);
  const profile = profiles.findProfile(state, profileId);
  const url = profile && instancePageUrl(from.webContents.getURL(), profile.server);
  if (url) openPageWindow(profileId, url);
}
function updateItems() {
  const status = updates.status();
  return status.phase === "ready" ? [{ id: "restart-to-update", label: t("menu.restartToUpdate", status.version || ""), click: () => updates.restartToUpdate() }] : [];
}
function buildMenu() {
  const nav = (fn) => () => {
    const w = frontWindow();
    if (w) fn(w.webContents);
  };
  const captureLabel = capture?.label() || "";
  const current = settings();
  const fileItems = [
    { id: "quick-capture", label: t("menu.quickCapture"), ...(captureLabel ? { accelerator: current.captureShortcut, registerAccelerator: false } : {}), click: () => capture?.show() },
    {
      // The global shortcut on or off (another one in the settings).
      id: "capture-shortcut",
      label: t("menu.captureShortcut", appSettings.shortcutLabel(current.captureShortcut || appSettings.DEFAULT_SHORTCUT)),
      type: "checkbox",
      checked: !!current.captureShortcut && capture?.status() === "ok",
      click: (item) => {
        try {
          changeSettings({ captureShortcut: item.checked ? current.captureShortcut || appSettings.DEFAULT_SHORTCUT : null });
        } catch (e) {
          buildMenu();
          notify(t("capture.title"), e.message);
        }
      },
    },
    { id: "page-window", label: t("menu.pageInNewWindow"), accelerator: "CmdOrCtrl+Shift+N", click: pageInNewWindow },
    { type: "separator" },
    {
      id: "print",
      label: t("menu.print"),
      accelerator: "CmdOrCtrl+P",
      click: () => {
        const w = frontWindow();
        if (w) printing.printPreview(w, { BrowserWindow, locale: app.getLocale(), title: t("print.preview") }).catch((e) => dialog.showErrorBox(t("print.failed"), e.message));
      },
    },
    {
      id: "save-pdf",
      label: t("menu.savePdf"),
      click: () => {
        const w = frontWindow();
        if (w) printing.savePdf(w, { dialog, locale: app.getLocale(), title: t("menu.savePdf") }).catch((e) => dialog.showErrorBox(t("print.failed"), e.message));
      },
    },
  ];
  const template = [
    ...(isMac
      ? [
          {
            label: "Flowplan",
            submenu: [
              { role: "about", label: t("menu.about") },
              { id: "check-updates", label: t("menu.checkUpdates"), click: updates.checkForUpdatesNow },
              ...updateItems(),
              { type: "separator" },
              { id: "settings", label: t("menu.settings"), click: showSettings },
              { label: t("menu.profiles"), submenu: profileMenu() },
              { label: t("menu.notifications"), submenu: notificationMenu() },
              { type: "separator" },
              { role: "hide", label: t("menu.hide") },
              { role: "hideOthers", label: t("menu.hideOthers") },
              { role: "unhide", label: t("menu.unhide") },
              { type: "separator" },
              { role: "quit", label: t("menu.quitMac") },
            ],
          },
          { label: t("menu.file"), submenu: fileItems },
        ]
      : [
          {
            label: t("menu.file"),
            submenu: [
              ...fileItems,
              { type: "separator" },
              { label: t("menu.profiles"), submenu: profileMenu() },
              { label: t("menu.notifications"), submenu: notificationMenu() },
              { id: "settings", label: t("menu.settings"), click: showSettings },
              { id: "check-updates", label: t("menu.checkUpdates"), click: updates.checkForUpdatesNow },
              ...updateItems(),
              { type: "separator" },
              { role: "quit", label: t("menu.quit") },
            ],
          },
        ]),
    {
      label: t("menu.edit"),
      submenu: [
        { role: "undo", label: t("menu.undo") },
        { role: "redo", label: t("menu.redo") },
        { type: "separator" },
        { role: "cut", label: t("menu.cut") },
        { role: "copy", label: t("menu.copy") },
        { role: "paste", label: t("menu.paste") },
        { role: "pasteAndMatchStyle", label: t("menu.pasteAndMatchStyle") },
        { role: "selectAll", label: t("menu.selectAll") },
        { type: "separator" },
        {
          label: t("context.spellingLanguages"),
          submenu: appSettings.SPELL_LANGUAGES.map((language) => ({
            id: `menu-spell-${language}`,
            label: t(`spelling.${language}`),
            type: "checkbox",
            checked: current.spellLanguages.includes(language),
            // Spell checking keeps one language at least.
            enabled: !(current.spellLanguages.length === 1 && current.spellLanguages[0] === language),
            click: () => setSpellLanguages(current.spellLanguages.includes(language) ? current.spellLanguages.filter((l) => l !== language) : [...current.spellLanguages, language]),
          })),
        },
      ],
    },
    {
      label: t("menu.view"),
      submenu: [
        { role: "reload", label: t("menu.reload") },
        { role: "forceReload", label: t("menu.forceReload") },
        { type: "separator" },
        { role: "resetZoom", label: t("menu.resetZoom") },
        { role: "zoomIn", label: t("menu.zoomIn") },
        { role: "zoomOut", label: t("menu.zoomOut") },
        { type: "separator" },
        { role: "togglefullscreen", label: t("menu.fullscreen") },
        { role: "toggleDevTools", label: t("menu.devTools") },
      ],
    },
    {
      label: t("menu.navigation"),
      submenu: [
        {
          label: t("menu.back"),
          accelerator: isMac ? "Cmd+[" : "Alt+Left",
          click: nav((w) => w.navigationHistory.canGoBack() && w.navigationHistory.goBack()),
        },
        {
          label: t("menu.forward"),
          accelerator: isMac ? "Cmd+]" : "Alt+Right",
          click: nav((w) => w.navigationHistory.canGoForward() && w.navigationHistory.goForward()),
        },
        {
          label: t("menu.home"),
          accelerator: "CmdOrCtrl+Shift+H",
          click: () => openServer(),
        },
        {
          label: t("menu.openInBrowser"),
          click: nav((w) => {
            const url = w.getURL();
            if (/^https?:/.test(url)) void shell.openExternal(url);
          }),
        },
      ],
    },
    {
      label: t("menu.window"),
      submenu: [
        { role: "minimize", label: t("menu.minimize") },
        { role: "zoom", label: t("menu.zoom") },
        { type: "separator" },
        { id: "window-page-window", label: t("menu.pageInNewWindow"), click: pageInNewWindow },
        ...(isMac ? [{ type: "separator" }, { role: "front", label: t("menu.front") }] : [{ role: "close", label: t("menu.close") }]),
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---- Bridges ----

// The bridges (preload.js): every call is checked against the frame it comes
// from. Most channels answer only the app's own pages – the instance's pages,
// or anything injected there, cannot read or change the profiles or the
// settings. The few `instance` channels (notifications on/off, a word for
// the dictionary, a page of the instance in its own window, files the person
// dropped) answer only the main frame of a page of the instance whose
// profile owns the calling session – and check what they get again.
function fromOwnInstance(event) {
  const frame = event.senderFrame;
  if (!frame || frame.parent) return false;
  const owner = ownerOf(event.sender.session);
  return !!owner && isInstancePage(frame.url, owner.server);
}
function handle(channel, fn, { instance = false } = {}) {
  ipcMain.handle(channel, (event, ...args) => {
    const from = event.senderFrame?.url;
    const allowed = instance ? fromOwnInstance(event) : isOwnPage(from, defaultPagesDir);
    if (!allowed) throw new Error(`${channel}: not available to ${from || "unknown frame"}`);
    return fn(event, ...args);
  });
}
const publicProfiles = () => ({
  profiles: state.profiles.map(({ id, name, server }) => ({ id, name, server })),
  active: state.activeProfile,
});
handle("flowplan:get-server", () => server() || "");
handle("flowplan:get-profiles", () => publicProfiles());
handle("flowplan:add-profile", async (_event, input) => {
  const origin = normalizeServer(input?.server);
  try {
    await checkServer(origin);
  } catch (e) {
    throw new Error(t("server.notFound", origin, e.message));
  }
  if (state.profiles.length >= profiles.MAX_PROFILES) throw new Error(t("profiles.tooMany", profiles.MAX_PROFILES));
  const { state: next, profile } = profiles.addProfile(state, { name: input?.name, server: origin });
  saveProfiles(next);
  replaceWindow(profile);
  return profile.id;
});
handle("flowplan:rename-profile", (_event, id, name) => {
  saveProfiles(profiles.renameProfile(state, String(id), name));
  return publicProfiles();
});
handle("flowplan:remove-profile", async (_event, id) => {
  await removeProfileAsk(String(id));
  return publicProfiles();
});
handle("flowplan:switch-profile", (_event, id) => switchProfile(String(id)));
handle("flowplan:show-profiles", () => showProfiles());
handle("flowplan:new-profile", () => showAddProfile());
handle("flowplan:retry", () => openServer());
handle("flowplan:sign-in-paste", (_event, text) => signIn.paste(text));
handle("flowplan:sign-in-cancel", () => signIn.cancel());
handle("flowplan:settings-get", () => publicSettings());
handle("flowplan:settings-set", (_event, patch) => changeSettings(patch && typeof patch === "object" ? patch : {}));
handle("flowplan:check-updates", () => void updates.checkForUpdatesNow());
handle("flowplan:capture-info", () => capture?.info() || {});
handle("flowplan:capture-save", (_event, input) => {
  if (!capture) throw new Error(t("capture.failed"));
  return capture.save({ text: typeof input?.text === "string" ? input.text : "", task: input?.task === true });
});
handle("flowplan:capture-close", () => capture?.hide());
handle("flowplan:update-state", () => updates.currentView());
handle("flowplan:update-action", (_event, id) => updates.act(String(id)));
handle("flowplan:notifications-enabled", () => !!notifier && notifier.settings().enabled, { instance: true });
handle("flowplan:notifications-set-enabled", (_event, on) => !!notifier && notifier.setEnabled(on === true), { instance: true });
handle("flowplan:notifications-refresh", (event) => notifier?.refresh(ownerOf(event.sender.session)?.id), { instance: true });
handle("flowplan:spelling-add-word", (event, word) => dictionaryWord(word) && event.sender.session.addWordToSpellCheckerDictionary(word), { instance: true });
handle("flowplan:open-window", (event, url) => void openPageWindow(ownerOf(event.sender.session)?.id, url), { instance: true });
handle("flowplan:drop-files", (event, paths) => void takeFiles(fileRules.droppedPaths(paths)), { instance: true });

// ---- Start ----

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", (_event, argv, workingDirectory) => {
    signIn.secondInstance(argv);
    // flowplan://open… links and files ("Open with", the taskbar icon).
    const links = deepLinks.linksFromArgs(argv);
    for (const link of links) handleLink(link);
    const files = fileRules.filesFromArgs(argv, { cwd: workingDirectory, skip: [process.execPath] });
    if (files.length) takeFiles(files);
    // --profile=<id> from the jump list or a script: a saved profile only.
    const wanted = profiles.profileFromArgs(state, argv);
    if (wanted) return switchProfile(wanted.id);
    if (links.length || files.length) return;
    showMainWindow();
  });
  // macOS delivers links and files as events, also before the app is ready.
  app.on("open-url", (event, link) => {
    if (deepLinks.parseLink(link)?.kind !== "open") return;
    event.preventDefault();
    handleLink(link);
  });
  app.on("open-file", (event, file) => {
    event.preventDefault();
    takeFiles([file]);
  });
  // The instance shows its desktop sign-in (passkeys, SSO in the browser).
  app.userAgentFallback = `${app.userAgentFallback} FlowplanDesktop/${app.getVersion()}`;
  // Windows shows notifications only for an app with this id (the installer
  // gives the shortcut the same).
  if (process.platform === "win32") app.setAppUserModelId("app.flowplan.desktop");
  app.whenReady().then(() => {
    strings.setLocale(app.getLocale());
    // A single address of an older version becomes the first profile.
    const config = readConfig();
    state = profiles.loadProfiles(config);
    const wanted = profiles.profileFromArgs(state, process.argv);
    if (wanted) state = { ...state, activeProfile: wanted.id };
    if (state.profiles.length && (!Array.isArray(config.profiles) || wanted)) writeConfig(profiles.toConfig(state));
    prepareSession(session.defaultSession);
    notifier = setupNotifier({
      getState: () => state,
      sessionFor,
      readConfig,
      writeConfig,
      t,
      open: openFromNotification,
      focusedProfile,
      getWindow: () => win,
      changed: refreshProfileMenus,
    });
    capture = setupCapture({
      t,
      locale: strings.locale,
      preload,
      settings,
      activeProfile,
      api: apiFor,
      isOnline: () => net.isOnline(),
      notify,
      saved: () => tray?.refresh({ reload: true }),
      // Spelling suggestions in the capture window too.
      decorate: (w) => contextMenu.attach(w, { t, dev: !app.isPackaged, settings, setSpellLanguages, origin: () => undefined, openWindow: () => {}, openExternal: (url) => void shell.openExternal(url) }),
    });
    tray = setupTray({
      t,
      data: () => ({
        unread: notifier?.unreadTotal() || 0,
        profiles: state.profiles.map((p) => ({ id: p.id, label: profiles.profileLabel(p) })),
        active: state.activeProfile,
        captureLabel: capture?.label() ? settings().captureShortcut : "",
        updateReady: updates.status().phase === "ready" ? updates.status().version || " " : null,
      }),
      loadTasks: () => {
        const profile = activeProfile();
        if (!profile) return Promise.reject(Object.assign(new Error("no-profile"), { kind: "no-profile" }));
        return apiFor(profile).todayTasks();
      },
      actions: {
        capture: () => capture.show(),
        openTask: (task) => openFromNotification(state.activeProfile, pageAddress(server(), task.pageId, task.rowId)),
        openTasks: () => openFromNotification(state.activeProfile, `${server()}/#tasks`),
        openInbox: () => openFromNotification(state.activeProfile, `${server()}/#inbox`),
        open: () => showMainWindow(),
        profile: (id) => switchProfile(id),
        update: () => updates.restartToUpdate(),
        settings: showSettings,
        quit: () => app.quit(),
      },
    });
    app.on("flowplan-badge", () => tray?.refresh());
    capture.register();
    const current = settings();
    tray.apply(current.tray);
    // A shortcut another app holds: said once, without stopping anything.
    if (capture.status() === "conflict") notify(t("capture.title"), t("settings.shortcutTaken", appSettings.shortcutLabel(current.captureShortcut)));
    // Launch at login follows the setting (the file or login item may have
    // been removed by hand: written again at every start).
    if (current.launchAtLogin) applyLoginItem(current);
    refreshProfileMenus();
    // Started hidden at login: macOS keeps only the Dock (and menu bar)
    // icon; Windows and Linux with the tray icon no window, without it a
    // minimised one.
    const hidden = current.launchAtLogin && current.startHidden && autostart.startsHidden(process.argv, isMac ? app.getLoginItemSettings() : {});
    if (!hidden || (!isMac && !current.tray)) createWindow(undefined, undefined, { hidden });
    handoff.ready();
    notifier.start();
    signIn.ready();
    updates.setupUpdates({ getWindow: frontWindow, changed: () => (buildMenu(), tray?.refresh()) });
    ready = true;
    // Links and files that came with the start.
    for (const link of [...deepLinks.linksFromArgs(process.argv), ...pendingLinks.splice(0)]) handleLink(link);
    const startFiles = [...fileRules.filesFromArgs(process.argv, { cwd: process.cwd(), skip: [process.execPath] }), ...pendingFiles.splice(0)];
    if (startFiles.length) takeFiles(startFiles);
    app.on("activate", () => {
      if (!win || win.isDestroyed()) createWindow();
    });
    // The update toast follows the window in front.
    app.on("browser-window-focus", () => {
      updates.refresh();
      // Back at the computer: today's tasks may have changed.
      tray?.refresh({ reload: "soft" });
    });
  });
  app.on("before-quit", () => {
    quitting = true;
  });
  app.on("will-quit", () => globalShortcut.unregisterAll());
  app.on("window-all-closed", () => {
    // Windows and Linux: closing the last window quits – unless the tray
    // icon keeps the app (and its notifications and quick capture) running.
    if (!isMac && !tray?.active()) app.quit();
  });
}
process.on("unhandledRejection", (error) => {
  if (app.isReady())
    dialog.showErrorBox("Flowplan", String(error?.message || error));
});
