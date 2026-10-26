// Quick capture from anywhere: a global shortcut (Ctrl+Shift+Space, ⇧⌘Space
// on macOS; changed or switched off in the settings) opens a small window
// above every other app – also while Flowplan's window is hidden or closed.
// Enter saves into the inbox of the active profile, Shift+Enter starts a new
// line, Esc closes (the text stays as a draft). It saves through the
// instance's own quick capture (capture.record, instance-api.js) with that
// profile's session; without a connection it says so and keeps the text.
//
// A shortcut another app already holds cannot be registered: the settings
// page, the menu and a notification say so. messageFor() turns what went
// wrong into words – plain, for test/features.mjs.
const path = require("node:path");
const { shortcutLabel } = require("./settings");

// An ApiError (instance-api.js) → a message for the capture window.
function messageFor(error, { t, host = "" }) {
  switch (error && error.kind) {
    case "offline":
      return t("capture.offline", host);
    case "signed-out":
      return t("capture.signedOut", host);
    case "no-inbox":
      return t("capture.noInbox");
    case "no-profile":
      return t("capture.noProfile");
    case "empty":
      return t("capture.empty");
    case "too-long":
    case "too-large":
      return t("capture.tooLong");
    case "rejected":
      return error.detail || t("capture.failed");
    default:
      return t("capture.failed");
  }
}

// deps: t, locale(), preload, settings(), activeProfile(), apiFor(profile),
// saved({ profile, result }) after a capture, isOnline(), notify(title,
// body), decorate(window) (the right-click menu).
function setupCapture(deps) {
  const { app, BrowserWindow, globalShortcut, nativeTheme, screen } = require("electron");
  let window = null;
  let registered = null;
  let status = "off";
  // While saving, a click elsewhere does not put the window away.
  let busy = false;

  function create() {
    window = new BrowserWindow({
      width: 560,
      height: 248,
      frame: false,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      show: false,
      title: deps.t("capture.title"),
      backgroundColor: nativeTheme.shouldUseDarkColors ? "#1f1e25" : "#ffffff",
      webPreferences: { preload: deps.preload, contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: true },
    });
    window.setAlwaysOnTop(true, "floating");
    if (process.platform === "darwin") window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    // Only its own page: nothing navigates or opens from here.
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    window.webContents.on("will-navigate", (event) => event.preventDefault());
    // Clicking elsewhere puts it away; the draft stays in the page.
    window.on("blur", () => {
      if (!busy) hide();
    });
    window.on("closed", () => (window = null));
    deps.decorate?.(window);
    void window.loadFile(path.join(__dirname, "pages", "capture.html"), { query: { lang: deps.locale(), platform: process.platform } });
  }
  // On the screen with the pointer, in its upper third.
  function place() {
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const area = display.workArea;
    const [width, height] = window.getSize();
    window.setPosition(Math.round(area.x + (area.width - width) / 2), Math.round(area.y + area.height / 4));
  }
  function show() {
    if (!window || window.isDestroyed()) create();
    place();
    const reveal = () => {
      if (process.platform === "darwin") app.focus({ steal: true });
      window.show();
      window.focus();
      window.webContents.focus();
      app.emit("flowplan-capture-shown", window);
    };
    if (window.webContents.isLoading()) window.webContents.once("did-finish-load", reveal);
    else reveal();
  }
  function hide() {
    if (!window || window.isDestroyed() || !window.isVisible()) return;
    window.hide();
    // macOS: back to the app that was in front, unless Flowplan's own window is.
    if (process.platform === "darwin" && !BrowserWindow.getAllWindows().some((w) => w !== window && w.isVisible() && !w.isMinimized())) app.hide();
  }

  // The shortcut from the settings; a taken one is reported, not forced.
  function register(accelerator = deps.settings().captureShortcut) {
    if (registered) {
      try {
        globalShortcut.unregister(registered);
      } catch {}
      registered = null;
    }
    if (!accelerator) {
      status = "off";
    } else {
      let ok = false;
      try {
        ok = globalShortcut.register(accelerator, show);
      } catch {
        ok = false;
      }
      status = ok ? "ok" : "conflict";
      if (ok) registered = accelerator;
    }
    app.emit("flowplan-shortcut", { status, accelerator });
    return status;
  }
  // A new shortcut from the settings page: kept only when it could be
  // registered; otherwise the previous one stays.
  function trySet(accelerator) {
    const previous = registered;
    const result = register(accelerator);
    if (result === "conflict" && previous) register(previous);
    return result === "conflict" ? "conflict" : result;
  }

  async function save(input) {
    const profile = deps.activeProfile();
    const host = profile ? new URL(profile.server).host : "";
    try {
      if (!profile) {
        const error = new Error("no-profile");
        error.kind = "no-profile";
        throw error;
      }
      if (!deps.isOnline()) {
        const error = new Error("offline");
        error.kind = "offline";
        throw error;
      }
      busy = true;
      const result = await deps.api(profile).capture({ text: String(input?.text ?? ""), task: input?.task === true });
      deps.saved({ profile, result });
      app.emit("flowplan-captured", { profile: profile.id, ...result });
      // The page shows the confirmation; then the window goes.
      setTimeout(hide, 900);
      return { ok: true, message: deps.t(input?.task ? "capture.savedTask" : "capture.saved", result.title || deps.t("capture.inbox")), url: result.url };
    } catch (e) {
      const message = messageFor(e, { t: deps.t, host });
      // Put away meanwhile: the system says it, the text waits in the window.
      if (window && !window.isVisible()) deps.notify?.(deps.t("capture.title"), message);
      throw new Error(message);
    } finally {
      busy = false;
    }
  }

  return {
    show,
    hide,
    register,
    trySet,
    save,
    status: () => status,
    label: () => (registered ? shortcutLabel(registered) : ""),
    info() {
      const profile = deps.activeProfile();
      return {
        profile: profile ? profile.name : "",
        host: profile ? new URL(profile.server).host : "",
        shortcut: registered ? shortcutLabel(registered) : "",
      };
    },
    window: () => window,
    dispose() {
      if (registered) globalShortcut.unregister(registered);
      registered = null;
    },
  };
}

module.exports = { messageFor, setupCapture };
