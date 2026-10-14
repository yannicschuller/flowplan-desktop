// Updates of the desktop app (the window around Flowplan – Flowplan itself is
// updated on the server). electron-updater reads the latest release of
// github.com/yannicschuller/flowplan-desktop: at start, every six hours and
// from the menu. Windows and Linux (AppImage) download in the background and
// install on the next start, or right away from a dialog. macOS can only
// replace a signed app; unsigned builds point to the download page instead
// (build/update.json, written by the release workflow). FLOWPLAN_UPDATE_URL
// points to another update source.
const { app, dialog, shell, BrowserWindow } = require("electron");
const path = require("node:path");
const fs = require("node:fs");

const DOWNLOAD_PAGE = "https://flowplan.org/download";
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

let updater = null;
let manual = false;
let offered = "";
const window = () => BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];

function setupUpdates() {
  // Only packaged apps update (not `npm start`).
  if (!app.isPackaged) return;
  ({ autoUpdater: updater } = require("electron-updater"));
  // Another source for updates (a mirror inside a company, or tests):
  // a folder with latest*.yml and the files, e.g. https://example.com/flowplan/.
  if (process.env.FLOWPLAN_UPDATE_URL) updater.setFeedURL({ provider: "generic", url: process.env.FLOWPLAN_UPDATE_URL });
  updater.autoDownload = canInstall();
  updater.autoInstallOnAppQuit = canInstall();
  updater.on("update-available", (info) => {
    if (canInstall() || offered === info.version) return;
    // Cannot replace itself: show where the new version is.
    offered = info.version;
    void dialog
      .showMessageBox(window(), {
        type: "info",
        buttons: ["Herunterladen", "Später"],
        defaultId: 0,
        cancelId: 1,
        message: `Flowplan ${info.version} ist verfügbar`,
        detail: `Du nutzt Version ${app.getVersion()}. Lade die neue Version herunter und ersetze die App damit.`,
      })
      .then(({ response }) => response === 0 && shell.openExternal(DOWNLOAD_PAGE));
  });
  updater.on("update-not-available", () => {
    if (!manual) return;
    manual = false;
    void dialog.showMessageBox(window(), { type: "info", message: "Flowplan ist auf dem neuesten Stand", detail: `Version ${app.getVersion()}` });
  });
  updater.on("update-downloaded", (info) => {
    manual = false;
    void dialog
      .showMessageBox(window(), {
        type: "info",
        buttons: ["Jetzt neu starten", "Beim nächsten Start"],
        defaultId: 0,
        cancelId: 1,
        message: `Flowplan ${info.version} ist bereit`,
        detail: "Das Update wird beim nächsten Start installiert – oder jetzt sofort.",
      })
      .then(({ response }) => response === 0 && updater.quitAndInstall());
  });
  updater.on("error", (error) => {
    // Offline or GitHub unreachable: quietly try again later, except when asked.
    if (!manual) return;
    manual = false;
    void dialog.showMessageBox(window(), {
      type: "warning",
      message: "Nach Updates suchen hat nicht geklappt",
      detail: `${error?.message || error}\n\nDie neueste Version gibt es auch unter ${DOWNLOAD_PAGE}.`,
    });
  });
  const check = () => updater.checkForUpdates().catch(() => {});
  setTimeout(check, 15_000);
  setInterval(check, SIX_HOURS);
}

// "Nach Updates suchen …" in the menu: with an answer either way.
function checkForUpdatesNow() {
  if (!updater) {
    void dialog.showMessageBox(window(), {
      type: "info",
      message: "Updates gibt es nur in der installierten App",
      detail: `Die neueste Version gibt es unter ${DOWNLOAD_PAGE}.`,
    });
    return;
  }
  manual = true;
  offered = "";
  void updater.checkForUpdates().catch(() => {});
}

module.exports = { setupUpdates, checkForUpdatesNow, DOWNLOAD_PAGE };
