// Flowplan for macOS, Windows and Linux: a window around a Flowplan instance.
// Everything runs on the server; the app remembers the address, the window
// and offers native menus, links in the browser, an offline page (when the
// service worker of offline use has no copy, fallback.js) and updates
// of itself (updates.js). Its own words come in the system language
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
} = require("electron");
const path = require("node:path");
const { setupUpdates, checkForUpdatesNow } = require("./updates");
const { setupBrowserSignIn } = require("./sign-in");
const { fallbackFor } = require("./fallback");
const strings = require("./strings");
const { isOwnPage, allowedInWindow, isSignInRedirect, permissionAllowed, classifyHealth, defaultPagesDir, sameOrigin: sameOriginAs } = require("./guards");
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
  fs.writeFileSync(configFile(), JSON.stringify(next, null, 2));
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

let win = null;
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
const server = () => readConfig().server;
const preload = path.join(__dirname, "preload.js");
const signIn = setupBrowserSignIn({ server, getWindow: () => win, preload, locale: strings.locale });
const suggestedServer = () => server() || presetServer() || DEFAULT_SERVER;
const page = (name) => path.join(defaultPagesDir, name);
// The app's own pages get the language in their address.
const loadPage = (name, query = {}) => win.loadFile(page(name), { query: { ...query, lang: strings.locale() } });
const sameOrigin = (url) => sameOriginAs(url, server());
function openServer() {
  const origin = server();
  if (!win) return;
  if (!origin) return loadPage("setup.html", { server: suggestedServer() });
  win.loadURL(origin).catch(() => {});
}
function createWindow() {
  const state = readConfig().window || {};
  win = new BrowserWindow({
    width: state.width || 1320,
    height: state.height || 860,
    x: state.x,
    y: state.y,
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
    },
  });
  if (state.maximized) win.maximize();
  win.once("ready-to-show", () => win.show());
  const saveState = () => {
    if (!win || win.isDestroyed()) return;
    const maximized = win.isMaximized();
    writeConfig({
      window: maximized
        ? { ...(readConfig().window || {}), maximized }
        : { ...win.getBounds(), maximized },
    });
  };
  win.on("close", saveState);
  // Links to other sites open in the default browser; sign-in pages of the
  // identity provider stay in the window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (signIn.intercept(url)) return { action: "deny" };
    if (!sameOrigin(url) && /^(https?:|mailto:)/i.test(url))
      void shell.openExternal(url);
    else if (sameOrigin(url)) win.loadURL(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, url) => {
    // Passkeys and SSO: sign in through the system browser (sign-in.js).
    if (signIn.intercept(url)) return event.preventDefault();
    // In the window: the app's own pages, the instance (its /api/auth/… sign-in
    // included) and the identity provider its sign-in redirected to. Any
    // other address – also one that merely contains /api/auth/ – goes to the
    // browser.
    if (allowedInWindow(url, { server: server(), pagesDir: defaultPagesDir, identityHosts })) return;
    event.preventDefault();
    if (/^https?:/i.test(url)) void shell.openExternal(url);
  });
  win.webContents.on("did-fail-load", (_e, code, description, url, isMain) => {
    if (!isMain || code === -3) return; // -3: navigation replaced
    // Offline copies open from the service worker under "/" (fallback.js).
    if (fallbackFor(url, server()) === "start") return void win.loadURL(server()).catch(() => {});
    loadPage("offline.html", { server: server() || "", error: description || String(code) });
  });
  openServer();
}
// Hosts seen during sign-in are allowed in the window afterwards.
const identityHosts = new Set();
function trackSignIn() {
  session.defaultSession.webRequest.onBeforeRedirect((details) => {
    if (details.resourceType !== "mainFrame") return;
    let from, next;
    try {
      from = new URL(details.url);
      next = new URL(details.redirectURL);
    } catch {
      return;
    }
    if (next.origin === server()) return;
    // From the instance's sign-in to the provider, and from one host of the
    // provider to the next (login.example → account.example).
    if (isSignInRedirect(details.url, server()) || identityHosts.has(from.host)) identityHosts.add(next.host);
  });
}
async function chooseServer() {
  if (!win) return;
  loadPage("setup.html", { server: suggestedServer() });
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
              { label: t("menu.changeServer"), click: chooseServer },
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
              { label: t("menu.changeServer"), click: chooseServer },
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

// The bridge (preload.js) answers only the app's own pages: every call is
// checked against the frame it comes from. The instance's pages – or
// anything injected there – cannot read or change the server address.
function handle(channel, fn) {
  ipcMain.handle(channel, (event, ...args) => {
    const from = event.senderFrame?.url;
    if (!isOwnPage(from, defaultPagesDir)) throw new Error(`${channel}: not available to ${from || "unknown frame"}`);
    return fn(event, ...args);
  });
}
handle("flowplan:get-server", () => server() || "");
handle("flowplan:set-server", async (_event, input) => {
  const origin = normalizeServer(input);
  try {
    await checkServer(origin);
  } catch (e) {
    throw new Error(t("server.notFound", origin, e.message));
  }
  writeConfig({ server: origin });
  openServer();
  return origin;
});
handle("flowplan:retry", () => openServer());
handle("flowplan:change-server", () => chooseServer());
handle("flowplan:sign-in-paste", (_event, text) => signIn.paste(text));
handle("flowplan:sign-in-cancel", () => signIn.cancel());

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", (_event, argv) => {
    signIn.secondInstance(argv);
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });
  // The instance shows its desktop sign-in (passkeys, SSO in the browser).
  app.userAgentFallback = `${app.userAgentFallback} FlowplanDesktop/${app.getVersion()}`;
  app.whenReady().then(() => {
    strings.setLocale(app.getLocale());
    session.defaultSession.setSpellCheckerLanguages?.(["de-DE", "en-US", "fr-FR"]);
    // The instance gets notifications, clipboard, fullscreen and the
    // microphone alone (voice notes) – no camera, no screen.
    session.defaultSession.setPermissionRequestHandler((wc, permission, done, details) => {
      done(permissionAllowed(permission, details, sameOrigin(wc.getURL())));
    });
    trackSignIn();
    buildMenu();
    createWindow();
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
