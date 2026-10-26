// Updates of the desktop app (the window around Flowplan – Flowplan itself is
// updated on the server). electron-updater reads the latest release of
// github.com/yannicschuller/flowplan-desktop: at start, every six hours and
// from the menu. Windows and Linux (AppImage) download in the background and
// install when the app quits, or right away with "Restart to Update". macOS
// can only replace a signed app; unsigned builds point to the download page
// instead (build/update.json, written by the release workflow).
// FLOWPLAN_UPDATE_URL points to another update source – https only
// (guards.js), because whoever serves updates serves the whole app; what
// the app shows names the source.
//
// Nothing pops up in the middle of work: no dialog, no window that takes the
// focus. A small toast in the corner of the window (pages/update.html in a
// WebContentsView that never takes the focus by itself) shows the download
// with percent, size and speed, the progress also shows on the Dock icon or
// taskbar button, and once the update is ready the toast, the app menu and
// the tray offer "Restart to Update" – otherwise it installs on quit. A
// check from the menu answers in the same toast. reduce() and view() decide
// what is shown – plain functions, run by test/security.mjs and
// test/features.mjs with Node alone.
const path = require("node:path");
const fs = require("node:fs");
const { updateFeedUrl } = require("./guards");
const strings = require("./strings");

const { t } = strings;
// Electron only when needed: test/security.mjs loads this file with Node alone.
const electron = () => require("electron");
const DOWNLOAD_PAGE = "https://flowplan.org/download";
const RELEASES = "github.com/yannicschuller/flowplan-desktop";
const SIX_HOURS = 6 * 60 * 60 * 1000;
const TOAST = { width: 380, height: 132, margin: 16 };

function buildInfo() {
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, "build", "update.json"), "utf8"));
  } catch {
    return {};
  }
}
// The app replaces itself: Windows, AppImage, and macOS when signed.
function canInstall() {
  if (process.platform === "darwin") return buildInfo().macSigned === true;
  if (process.platform === "linux") return !!process.env.APPIMAGE;
  return true;
}
// Where updates come from: the release feed, or an https mirror named in
// FLOWPLAN_UPDATE_URL. Anything else in that variable is ignored and said so.
function feed(env = process.env) {
  const wanted = env.FLOWPLAN_UPDATE_URL;
  const url = updateFeedUrl(wanted);
  if (url) return { url, label: url, ignored: null };
  return { url: null, label: t("updates.sourceGithub", RELEASES), ignored: wanted || null };
}
const sourceLine = () => t("updates.source", feed().label);

// ---- What the app knows about updates, and what it shows ----
//
// phase: idle | checking | downloading | ready | manual-download (a new
// version this app cannot install itself) | up-to-date | error |
// not-installed (`npm start`). `manual` marks a check from the menu: only
// then are "up to date", "checking" and errors of a check shown.
const INITIAL = { phase: "idle", version: null, manual: false, percent: 0, transferred: 0, total: 0, bytesPerSecond: 0, error: null, dismissed: false, offered: null };
const number = (v) => (Number.isFinite(v) && v >= 0 ? v : 0);
function reduce(state = INITIAL, event = {}) {
  switch (event.type) {
    case "check":
      // A download that runs or waits stays; a check from the menu shows it again.
      if (state.phase === "downloading" || state.phase === "ready") return { ...state, manual: !!event.manual, dismissed: event.manual ? false : state.dismissed };
      return { ...state, phase: "checking", manual: !!event.manual, error: null, dismissed: false };
    case "available": {
      if (event.canInstall) return { ...state, phase: "downloading", version: event.version, percent: 0, transferred: 0, total: 0, bytesPerSecond: 0, dismissed: false };
      // Pointing to the download page: once per version, unless asked.
      const again = state.offered === event.version && !state.manual;
      return { ...state, phase: "manual-download", version: event.version, offered: event.version, dismissed: again };
    }
    case "progress":
      return {
        ...state,
        phase: "downloading",
        percent: Math.min(100, number(event.percent)),
        transferred: number(event.transferred),
        total: number(event.total),
        bytesPerSecond: number(event.bytesPerSecond),
      };
    case "downloaded":
      return { ...state, phase: "ready", version: event.version || state.version, percent: 100, manual: false, dismissed: false };
    case "not-available":
      return { ...state, phase: "up-to-date", dismissed: !state.manual };
    case "error":
      // A failed check after a finished download keeps the update.
      if (state.phase === "ready") return state;
      return { ...state, phase: "error", error: String(event.message || "").slice(0, 300), dismissed: !(state.manual || state.phase === "downloading") };
    case "not-installed":
      return { ...state, phase: "not-installed", manual: true, dismissed: false };
    case "dismiss":
      return { ...state, dismissed: true, manual: false };
    default:
      return state;
  }
}
// "12.3 MB" in the app's language.
function formatBytes(bytes, locale = "en") {
  const value = number(bytes);
  const units = ["B", "KB", "MB", "GB"];
  let i = 0;
  let n = value;
  while (n >= 1000 && i < units.length - 1) {
    n /= 1000;
    i++;
  }
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: i >= 2 ? 1 : 0 }).format(n)} ${units[i]}`;
}
// The toast's content, or null when nothing is to be shown.
function view(state, { translate = t, locale = "en", current = "" } = {}) {
  if (state.dismissed) return null;
  const base = { phase: state.phase, version: state.version, source: translate("updates.source", feed().label) };
  switch (state.phase) {
    case "checking":
      return state.manual ? { ...base, title: translate("updates.checking"), detail: "", progress: null, busy: true, actions: [] } : null;
    case "downloading": {
      const parts = [`${Math.floor(state.percent)} %`];
      if (state.total) parts.push(translate("updates.ofSize", formatBytes(state.transferred, locale), formatBytes(state.total, locale)));
      if (state.bytesPerSecond) parts.push(`${formatBytes(state.bytesPerSecond, locale)}/s`);
      return { ...base, title: translate("updates.downloading", state.version || ""), detail: parts.join(" · "), progress: state.percent / 100, actions: [{ id: "hide", label: translate("updates.hide") }] };
    }
    case "ready":
      return { ...base, title: translate("updates.ready", state.version || ""), detail: translate("updates.readyDetail"), progress: null, actions: [{ id: "restart", label: translate("updates.restartNow"), primary: true }, { id: "later", label: translate("updates.later") }] };
    case "manual-download":
      return { ...base, title: translate("updates.available", state.version || ""), detail: translate("updates.availableDetail", current), progress: null, actions: [{ id: "download", label: translate("updates.download"), primary: true }, { id: "later", label: translate("updates.later") }] };
    case "up-to-date":
      return { ...base, title: translate("updates.upToDate"), detail: translate("updates.version", current), progress: null, autoHide: 6000, actions: [{ id: "ok", label: translate("updates.ok") }] };
    case "error":
      return { ...base, title: translate("updates.failed"), detail: translate("updates.failedDetail", state.error || "", DOWNLOAD_PAGE), progress: null, actions: [{ id: "download", label: translate("updates.download") }, { id: "ok", label: translate("updates.ok"), primary: true }] };
    case "not-installed":
      return { ...base, title: translate("updates.onlyInstalled"), detail: translate("updates.onlyInstalledDetail", DOWNLOAD_PAGE), progress: null, autoHide: 8000, actions: [{ id: "download", label: translate("updates.download") }, { id: "ok", label: translate("updates.ok"), primary: true }] };
    default:
      return null;
  }
}
// The Dock / taskbar progress: 0…1 while downloading, -1 (none) otherwise.
const taskbarProgress = (state) => (state.phase === "downloading" ? Math.max(0.01, Math.min(1, state.percent / 100)) : -1);

// ---- Electron ----

let updater = null;
let state = INITIAL;
let deps = { getWindow: () => null, changed: () => {} };
let toast = null; // { view, window }
let hideTimer = null;
let progressWindow = null;

function dispatch(event) {
  const before = state;
  state = reduce(state, event);
  if (before === state) return;
  render();
  if (before.phase !== state.phase) deps.changed?.();
}
function currentView() {
  const { app } = electron();
  return view(state, { translate: t, locale: strings.locale(), current: app.getVersion() });
}
function layoutToast() {
  if (!toast || toast.window.isDestroyed()) return;
  const [width, height] = toast.window.getContentSize();
  toast.view.setBounds({ x: Math.max(0, width - TOAST.width - TOAST.margin), y: Math.max(0, height - TOAST.height - TOAST.margin), width: Math.min(TOAST.width, width), height: TOAST.height });
}
function detachToast() {
  if (!toast) return;
  if (!toast.window.isDestroyed()) {
    toast.window.contentView.removeChildView(toast.view);
    toast.window.off("resize", layoutToast);
  }
  if (!toast.view.webContents.isDestroyed()) toast.view.webContents.close();
  toast = null;
}
// The toast lives in the window in front (or the main window); it moves
// along when that window changes, e.g. after switching profiles.
function showToast(content) {
  const { WebContentsView, nativeTheme } = electron();
  const target = deps.getWindow();
  if (!target || target.isDestroyed()) return detachToast();
  if (toast && toast.window !== target) detachToast();
  if (!toast) {
    const view = new WebContentsView({
      webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, sandbox: true, nodeIntegration: false },
    });
    view.setBackgroundColor(nativeTheme.shouldUseDarkColors ? "#16151b" : "#fcfbf8");
    view.setBorderRadius?.(12);
    toast = { view, window: target, loaded: false };
    target.contentView.addChildView(view);
    target.on("resize", layoutToast);
    target.once("closed", () => {
      if (toast && toast.window === target) toast = null;
    });
    view.webContents.once("did-finish-load", () => {
      if (!toast || toast.view !== view) return;
      toast.loaded = true;
      render();
    });
    void view.webContents.loadFile(path.join(__dirname, "pages", "update.html"), { query: { lang: strings.locale() } });
  }
  layoutToast();
  if (toast.loaded) toast.view.webContents.send("flowplan:update-state", content);
}
function render() {
  const { app } = electron();
  const content = currentView();
  clearTimeout(hideTimer);
  if (content) {
    showToast(content);
    if (content.autoHide) hideTimer = setTimeout(() => dispatch({ type: "dismiss" }), content.autoHide);
  } else detachToast();
  // The progress on the Dock icon or taskbar button.
  const progress = taskbarProgress(state);
  const target = deps.getWindow();
  if (progressWindow && progressWindow !== target && !progressWindow.isDestroyed()) progressWindow.setProgressBar(-1);
  if (target && !target.isDestroyed()) {
    target.setProgressBar(progress);
    progressWindow = target;
  }
  // For test/update.mjs and test/app.mjs.
  app.emit("flowplan-update", { phase: state.phase, version: state.version, view: content });
}

function setupUpdates(options = {}) {
  deps = { ...deps, ...options };
  const { app } = electron();
  // Only packaged apps update (not `npm start`).
  if (!app.isPackaged) return;
  ({ autoUpdater: updater } = require("electron-updater"));
  // Another source for updates (a mirror inside a company, or tests):
  // a folder with latest*.yml and the files, e.g. https://example.com/flowplan/.
  const source = feed();
  if (source.ignored) console.warn(t("updates.sourceIgnored", source.ignored));
  if (source.url) updater.setFeedURL({ provider: "generic", url: source.url });
  updater.autoDownload = canInstall();
  updater.autoInstallOnAppQuit = canInstall();
  updater.on("checking-for-update", () => {});
  updater.on("update-available", (info) => dispatch({ type: "available", version: info.version, canInstall: canInstall() }));
  updater.on("download-progress", (p) => dispatch({ type: "progress", percent: p.percent, transferred: p.transferred, total: p.total, bytesPerSecond: p.bytesPerSecond }));
  updater.on("update-not-available", () => dispatch({ type: "not-available" }));
  updater.on("update-downloaded", (info) => dispatch({ type: "downloaded", version: info.version }));
  // Offline or GitHub unreachable: quietly try again later, except when asked.
  updater.on("error", (error) => dispatch({ type: "error", message: error?.message || String(error) }));
  const check = () => {
    dispatch({ type: "check", manual: false });
    ask();
  };
  setTimeout(check, 15_000);
  setInterval(check, SIX_HOURS);
}

// Asks the update source. A failed check or download arrives as the
// updater's "error" event (shown in the toast); the promises are caught so
// nothing reaches the app's last-resort error box.
function ask() {
  updater
    .checkForUpdates()
    .then((result) => result?.downloadPromise?.catch(() => {}))
    .catch(() => {});
}
// "Nach Updates suchen …" in the menu: an answer either way, in the toast.
function checkForUpdatesNow() {
  if (!updater) return dispatch({ type: "not-installed" });
  dispatch({ type: "check", manual: true });
  ask();
}
// A button of the toast (pages/update.html).
function act(id) {
  const { shell } = electron();
  if (id === "restart") return restartToUpdate();
  if (id === "download") void shell.openExternal(DOWNLOAD_PAGE);
  dispatch({ type: "dismiss" });
}
// "Restart to Update" (toast, menu, tray): only with a downloaded update.
function restartToUpdate() {
  if (!updater || state.phase !== "ready") return false;
  // The app quits; electron-updater installs and starts the new version.
  setImmediate(() => updater.quitAndInstall());
  return true;
}
// The window changed (another profile, a window came back): the toast follows.
function refresh() {
  if (currentView() || toast) render();
}

module.exports = {
  setupUpdates,
  checkForUpdatesNow,
  restartToUpdate,
  act,
  refresh,
  currentView,
  status: () => ({ phase: state.phase, version: state.version }),
  feed,
  sourceLine,
  reduce,
  view,
  formatBytes,
  taskbarProgress,
  INITIAL,
  DOWNLOAD_PAGE,
};
