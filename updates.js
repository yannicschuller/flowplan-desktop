// Updates of the desktop app (the window around Flowplan – Flowplan itself is
// updated on the server). electron-updater reads the latest release of
// github.com/yannicschuller/flowplan-desktop: at start, every six hours and
// from the menu. Windows and Linux (AppImage) download in the background and
// install on the next start, or right away from a dialog. macOS can only
// replace a signed app; unsigned builds point to the download page instead
// (build/update.json, written by the release workflow). FLOWPLAN_UPDATE_URL
// points to another update source – https only (guards.js), because whoever
// serves updates serves the whole app; the dialogs name the source.
const path = require("node:path");
const fs = require("node:fs");
const { updateFeedUrl } = require("./guards");
const { t } = require("./strings");

// Electron only when needed: test/security.mjs loads this file with Node alone.
const electron = () => require("electron");
const DOWNLOAD_PAGE = "https://flowplan.org/download";
const RELEASES = "github.com/yannicschuller/flowplan-desktop";
const SIX_HOURS = 6 * 60 * 60 * 1000;

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

let updater = null;
let manual = false;
let offered = "";
const window = () => electron().BrowserWindow.getFocusedWindow() || electron().BrowserWindow.getAllWindows()[0];

function setupUpdates() {
  const { app, dialog, shell } = electron();
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
  updater.on("update-available", (info) => {
    if (canInstall() || offered === info.version) return;
    // Cannot replace itself: show where the new version is.
    offered = info.version;
    void dialog
      .showMessageBox(window(), {
        type: "info",
        buttons: [t("updates.download"), t("updates.later")],
        defaultId: 0,
        cancelId: 1,
        message: t("updates.available", info.version),
        detail: `${t("updates.availableDetail", app.getVersion())}\n\n${sourceLine()}`,
      })
      .then(({ response }) => response === 0 && shell.openExternal(DOWNLOAD_PAGE));
  });
  updater.on("update-not-available", () => {
    if (!manual) return;
    manual = false;
    void dialog.showMessageBox(window(), {
      type: "info",
      message: t("updates.upToDate"),
      detail: `${t("updates.version", app.getVersion())}\n\n${sourceLine()}`,
    });
  });
  updater.on("update-downloaded", (info) => {
    manual = false;
    void dialog
      .showMessageBox(window(), {
        type: "info",
        buttons: [t("updates.restartNow"), t("updates.onNextStart")],
        defaultId: 0,
        cancelId: 1,
        message: t("updates.ready", info.version),
        detail: `${t("updates.readyDetail")}\n\n${sourceLine()}`,
      })
      .then(({ response }) => response === 0 && updater.quitAndInstall());
  });
  updater.on("error", (error) => {
    // Offline or GitHub unreachable: quietly try again later, except when asked.
    if (!manual) return;
    manual = false;
    void dialog.showMessageBox(window(), {
      type: "warning",
      message: t("updates.failed"),
      detail: `${t("updates.failedDetail", error?.message || error, DOWNLOAD_PAGE)}\n\n${sourceLine()}`,
    });
  });
  const check = () => updater.checkForUpdates().catch(() => {});
  setTimeout(check, 15_000);
  setInterval(check, SIX_HOURS);
}

// "Nach Updates suchen …" in the menu: with an answer either way.
function checkForUpdatesNow() {
  const { dialog } = electron();
  if (!updater) {
    void dialog.showMessageBox(window(), {
      type: "info",
      message: t("updates.onlyInstalled"),
      detail: t("updates.onlyInstalledDetail", DOWNLOAD_PAGE),
    });
    return;
  }
  manual = true;
  offered = "";
  void updater.checkForUpdates().catch(() => {});
}

module.exports = { setupUpdates, checkForUpdatesNow, feed, DOWNLOAD_PAGE };
