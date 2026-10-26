// A screen region for quick capture ("Bildschirmausschnitt"), attached as
// a PNG to what is captured.
//
// - macOS: the system's own tool, `screencapture -i -x` (drag a region,
//   Space for a window, Esc cancels; no sound) into a file in the app's
//   user data folder, read and deleted at once. It needs the screen
//   recording permission (System Settings → Privacy & Security → Screen &
//   System Audio Recording); without it the capture window says so and
//   opens that page.
// - Windows and Linux: Electron's desktopCapturer takes the screen under
//   the pointer, a frameless window over that screen shows it (pages/
//   region.html) and the person drags the region (Esc cancels, Enter takes
//   the whole screen). Under Wayland the desktop asks first (portal) and
//   may offer a window instead of a screen; what it hands over is used.
//
// The decisions (arguments, the rectangle, the permission) are plain
// functions without Electron, for test/features.mjs.
const path = require("node:path");
const { randomUUID } = require("node:crypto");

const MIN_SIZE = 4;
const screencaptureArgs = (file) => ["-i", "-x", "-t", "png", file];
// The privacy page of System Settings for screen recording.
const SCREEN_SETTINGS_URL = "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture";
const MICROPHONE_SETTINGS_URL = "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone";

// systemPreferences.getMediaAccessStatus → may we start, or guide the person.
function permissionVerdict(status) {
  if (status === "granted" || status === "not-determined" || status === "unknown") return "ok";
  return "denied";
}
// Two corners of a drag (CSS pixels of the overlay) → a rectangle inside
// the screen, or null when it is too small to mean anything.
function regionFromDrag(a, b, size) {
  const clamp = (v, max) => Math.max(0, Math.min(max, Number(v) || 0));
  const x1 = clamp(Math.min(a.x, b.x), size.width),
    y1 = clamp(Math.min(a.y, b.y), size.height),
    x2 = clamp(Math.max(a.x, b.x), size.width),
    y2 = clamp(Math.max(a.y, b.y), size.height);
  if (x2 - x1 < MIN_SIZE || y2 - y1 < MIN_SIZE) return null;
  return { x: Math.round(x1), y: Math.round(y1), width: Math.round(x2 - x1), height: Math.round(y2 - y1) };
}
// The rectangle in the image's own pixels (the screenshot is taken at the
// display's scale factor).
function imageRect(rect, imageSize, screenSize) {
  const fx = imageSize.width / screenSize.width,
    fy = imageSize.height / screenSize.height;
  const x = Math.max(0, Math.floor(rect.x * fx)),
    y = Math.max(0, Math.floor(rect.y * fy));
  return { x, y, width: Math.min(imageSize.width - x, Math.ceil(rect.width * fx)), height: Math.min(imageSize.height - y, Math.ceil(rect.height * fy)) };
}
const fileName = (date = new Date()) => {
  const pad = (n) => String(n).padStart(2, "0");
  return `Bildschirm ${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}.${pad(date.getMinutes())}.${pad(date.getSeconds())}.png`;
};

// deps: app, preload, locale(), t; returns { capture() → { name, type, bytes } | null }.
function setupScreenCapture(deps) {
  const { BrowserWindow, desktopCapturer, screen, systemPreferences, shell } = require("electron");
  const fs = require("node:fs");
  const { execFile } = require("node:child_process");
  let overlay = null;
  let pending = null;

  async function mac() {
    const status = systemPreferences.getMediaAccessStatus("screen");
    if (permissionVerdict(status) !== "ok") {
      const error = new Error("screen-permission");
      error.kind = "screen-permission";
      throw error;
    }
    const dir = path.join(deps.app.getPath("userData"), "capture-tmp");
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const file = path.join(dir, `${randomUUID()}.png`);
    try {
      await new Promise((done) => execFile("/usr/sbin/screencapture", screencaptureArgs(file), { timeout: 120_000 }, () => done()));
      // Esc: no file, nothing to attach.
      if (!fs.existsSync(file)) return null;
      const bytes = fs.readFileSync(file);
      return bytes.length ? { name: fileName(), type: "image/png", bytes } : null;
    } finally {
      fs.rmSync(file, { force: true });
    }
  }

  // The overlay's answer (pages/region.html): a rectangle or null.
  function finish(rect) {
    const done = pending;
    pending = null;
    if (overlay && !overlay.isDestroyed()) overlay.destroy();
    overlay = null;
    done?.(rect);
  }
  async function others() {
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const { width, height } = display.size;
    const scale = display.scaleFactor || 1;
    const sources = await desktopCapturer.getSources({ types: ["screen"], thumbnailSize: { width: Math.round(width * scale), height: Math.round(height * scale) } });
    const source = sources.find((s) => String(s.display_id) === String(display.id)) || sources[0];
    if (!source || source.thumbnail.isEmpty()) {
      const error = new Error("screen-unavailable");
      error.kind = "screen-unavailable";
      throw error;
    }
    const image = source.thumbnail;
    overlay = new BrowserWindow({
      ...display.bounds,
      frame: false,
      resizable: false,
      movable: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      fullscreenable: false,
      show: false,
      backgroundColor: "#000000",
      webPreferences: { preload: deps.preload, contextIsolation: true, sandbox: true, nodeIntegration: false },
    });
    overlay.setAlwaysOnTop(true, "screen-saver");
    overlay.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    overlay.webContents.on("will-navigate", (event) => event.preventDefault());
    overlay.on("closed", () => finish(null));
    const rect = await new Promise((resolve) => {
      pending = resolve;
      overlay.webContents.once("did-finish-load", () => {
        overlay.show();
        overlay.focus();
        deps.app.emit("flowplan-region", overlay);
      });
      void overlay.loadFile(path.join(__dirname, "pages", "region.html"), { query: { lang: deps.locale() } });
      overlay.webContents.once("did-finish-load", () => overlay.webContents.send("flowplan:region-image", image.toDataURL()));
    });
    if (!rect) return null;
    const region = rect === "all" ? { x: 0, y: 0, width, height } : regionFromDrag({ x: rect.x, y: rect.y }, { x: rect.x + rect.width, y: rect.y + rect.height }, { width, height });
    if (!region) return null;
    const cropped = image.crop(imageRect(region, image.getSize(), { width, height }));
    return { name: fileName(), type: "image/png", bytes: cropped.toPNG() };
  }

  return {
    // Only the overlay window answers (main.js checks the sender too).
    window: () => overlay,
    answer: (rect) => finish(rect),
    async capture() {
      if (pending) return null;
      return process.platform === "darwin" ? mac() : others();
    },
    openSettings: (what) => void shell.openExternal(what === "microphone" ? MICROPHONE_SETTINGS_URL : SCREEN_SETTINGS_URL),
    dispose: () => finish(null),
  };
}

module.exports = { screencaptureArgs, permissionVerdict, regionFromDrag, imageRect, fileName, SCREEN_SETTINGS_URL, MICROPHONE_SETTINGS_URL, setupScreenCapture };
