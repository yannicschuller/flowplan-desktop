// Flowplan for macOS, Windows and Linux: a window around a Flowplan instance.
// Everything runs on the server; the app remembers the instances (profiles,
// profiles.js), the window and offers native menus, links in the browser, an
// offline page (when the service worker of offline use has no copy,
// fallback.js), updates of itself (updates.js) and system notifications with
// the unread count on the icon (notifier.js, notifications.js – Electron has
// no Web Push). Its own words come in the system language (strings.js); what
// the window lets through is decided in guards.js.
const {
  app,
  BrowserWindow,
  Menu,
  shell,
  ipcMain,
  session,
  dialog,
  nativeTheme,
} = require("electron");
const path = require("node:path");
const { setupUpdates, checkForUpdatesNow } = require("./updates");
const { setupBrowserSignIn } = require("./sign-in");
const { fallbackFor } = require("./fallback");
const strings = require("./strings");
const { isOwnPage, isInstancePage, allowedInWindow, isSignInRedirect, permissionAllowed, classifyHealth, defaultPagesDir, sameOrigin: sameOriginAs } = require("./guards");
const profiles = require("./profiles");
const { setupNotifier } = require("./notifier");
const notificationRules = require("./notifications");
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
function saveProfiles(next) {
  state = next;
  writeConfig(profiles.toConfig(state));
  refreshProfileMenus();
  notifier?.reconcile();
}
const activeProfile = () => profiles.activeOf(state);
// The window belongs to one profile: its session, its instance. A new
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
const loadPage = (name, query = {}) => win.loadFile(page(name), { query: { ...query, lang: strings.locale() } });
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
  ses.setSpellCheckerLanguages?.(["de-DE", "en-US", "fr-FR"]);
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

function saveWindowState(w) {
  if (!w || w.isDestroyed()) return;
  const maximized = w.isMaximized();
  writeConfig({
    window: maximized ? { ...(readConfig().window || {}), maximized } : { ...w.getBounds(), maximized },
  });
}
function createWindow(profile = activeProfile(), target) {
  const partition = profiles.partitionFor(profile);
  const ses = sessionFor(profile);
  const profileId = profile ? profile.id : null;
  sessionOwner.set(ses, profileId);
  prepareSession(ses);
  // The instance of this window's profile – checked at every navigation, so
  // only the active profile's origin stays inside the window.
  const origin = () => (profileId ? profiles.findProfile(state, profileId)?.server : undefined);
  const sameOrigin = (url) => sameOriginAs(url, origin());
  const windowState = readConfig().window || {};
  const w = new BrowserWindow({
    width: windowState.width || 1320,
    height: windowState.height || 860,
    x: windowState.x,
    y: windowState.y,
    minWidth: 380,
    minHeight: 500,
    title: "Flowplan",
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
  win = w;
  winProfile = profileId;
  if (windowState.maximized) w.maximize();
  w.once("ready-to-show", () => {
    w.show();
    // Windows: the dot on the taskbar button belongs to the window.
    if (win === w) notifier?.applyBadge(true);
  });
  w.on("close", () => saveWindowState(w));
  w.on("closed", () => {
    if (win === w) win = null;
  });
  // With more than one profile the title names the profile.
  w.webContents.on("page-title-updated", (event, title) => {
    const own = profiles.findProfile(state, profileId);
    if (!own || state.profiles.length < 2) return;
    event.preventDefault();
    w.setTitle(`${title} – ${own.name}`);
  });
  // Links to other sites open in the default browser; sign-in pages of the
  // identity provider stay in the window.
  w.webContents.setWindowOpenHandler(({ url }) => {
    if (signIn.intercept(url)) return { action: "deny" };
    if (!sameOrigin(url) && /^(https?:|mailto:)/i.test(url))
      void shell.openExternal(url);
    else if (sameOrigin(url)) w.loadURL(url);
    return { action: "deny" };
  });
  w.webContents.on("will-navigate", (event, url) => {
    // Passkeys and SSO: sign in through the system browser (sign-in.js).
    if (win === w && signIn.intercept(url)) return event.preventDefault();
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
    if (win !== w) return;
    // Offline copies open from the service worker under "/" (fallback.js).
    if (fallbackFor(url, origin()) === "start") return void w.loadURL(origin()).catch(() => {});
    loadPage("offline.html", { server: origin() || "", error: description || String(code) });
  });
  openServer(target);
  return w;
}
// Another profile: a new window in its session where the old one was; the
// old one goes once the new one shows (no blank screen in between).
function replaceWindow(profile, target) {
  const old = win && !win.isDestroyed() ? win : null;
  if (old) saveWindowState(old);
  signIn.reset();
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
    win.focus();
    return openServer();
  }
  replaceWindow(profile);
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
// The window's profile while it is in front: its notifications show in the
// inbox there, so no system notification pops up for them.
function focusedProfile() {
  if (!win || win.isDestroyed() || !win.isVisible() || win.isMinimized() || !win.isFocused()) return null;
  return winProfile;
}
function showProfiles() {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.focus();
  loadPage("profiles.html");
}
function showAddProfile() {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.focus();
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
  saveProfiles(profiles.removeProfile(state, id));
  identityHosts.delete(id);
  notifier?.forgetProfile(id);
  if (wasActive || winProfile === id) replaceWindow(activeProfile());
  await forgetSession(profile);
  return true;
}

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
function buildMenu() {
  const nav = (fn) => () => win && fn(win.webContents);
  const template = [
    ...(isMac
      ? [
          {
            label: "Flowplan",
            submenu: [
              { role: "about", label: t("menu.about") },
              { label: t("menu.checkUpdates"), click: checkForUpdatesNow },
              { type: "separator" },
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
        ]
      : [
          {
            label: t("menu.file"),
            submenu: [
              { label: t("menu.profiles"), submenu: profileMenu() },
              { label: t("menu.notifications"), submenu: notificationMenu() },
              { label: t("menu.checkUpdates"), click: checkForUpdatesNow },
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
        ...(isMac ? [{ type: "separator" }, { role: "front", label: t("menu.front") }] : [{ role: "close", label: t("menu.close") }]),
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// The bridges (preload.js): every call is checked against the frame it comes
// from. Most channels answer only the app's own pages – the instance's pages,
// or anything injected there, cannot read or change the profiles. The few
// `instance` channels (notifications on/off) answer only the main frame of a
// page of the instance whose profile owns the calling session.
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
handle("flowplan:notifications-enabled", () => !!notifier && notifier.settings().enabled, { instance: true });
handle("flowplan:notifications-set-enabled", (_event, on) => !!notifier && notifier.setEnabled(on === true), { instance: true });
handle("flowplan:notifications-refresh", (event) => notifier?.refresh(ownerOf(event.sender.session)?.id), { instance: true });

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", (_event, argv) => {
    signIn.secondInstance(argv);
    // --profile=<id> from the jump list or a script: a saved profile only.
    const wanted = profiles.profileFromArgs(state, argv);
    if (wanted) return switchProfile(wanted.id);
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
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
    refreshProfileMenus();
    createWindow();
    notifier.start();
    signIn.ready();
    setupUpdates();
    app.on("activate", () => {
      if (!BrowserWindow.getAllWindows().length) createWindow();
    });
  });
  app.on("window-all-closed", () => {
    if (!isMac) app.quit();
  });
}
process.on("unhandledRejection", (error) => {
  if (app.isReady())
    dialog.showErrorBox("Flowplan", String(error?.message || error));
});
