// Launch at login (Settings, off by default), optionally hidden: macOS and
// Windows through app.setLoginItemSettings, Linux through an XDG autostart
// entry (~/.config/autostart/flowplan.desktop) that the desktop session
// starts. A hidden start opens no window (the tray icon or the Dock brings
// it); the argument --hidden says so.
//
// The decisions (what to register, the file's content and place) are plain
// functions without Electron (test/features.mjs); apply() does it.
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");

const HIDDEN_ARG = "--hidden";
const FILE_NAME = "flowplan.desktop";

// What setLoginItemSettings gets on macOS and Windows.
function loginItemOptions(settings, { platform = process.platform, execPath = process.execPath } = {}) {
  const open = settings.launchAtLogin === true;
  const hidden = open && settings.startHidden === true;
  if (platform === "darwin") return { openAtLogin: open, openAsHidden: hidden };
  if (platform === "win32") return { openAtLogin: open, path: execPath, args: hidden ? [HIDDEN_ARG] : [] };
  return null;
}
// The XDG autostart file: $XDG_CONFIG_HOME/autostart (default ~/.config).
function autostartPath(env = process.env, home = os.homedir()) {
  const base = env.XDG_CONFIG_HOME && path.isAbsolute(env.XDG_CONFIG_HOME) ? env.XDG_CONFIG_HOME : path.join(home, ".config");
  return path.join(base, "autostart", FILE_NAME);
}
// Exec= quoting of the Desktop Entry Specification: every argument in
// double quotes, with ", `, $ and \ escaped.
const quote = (arg) => `"${String(arg).replace(/([\\"`$])/g, "\\$1")}"`;
function autostartEntry({ command, args = [], hidden = false }) {
  if (!command || /[\n\r]/.test(command) || args.some((a) => /[\n\r]/.test(a))) throw new Error("invalid command");
  const exec = [command, ...args, ...(hidden ? [HIDDEN_ARG] : [])].map(quote).join(" ");
  return [
    "[Desktop Entry]",
    "Type=Application",
    "Name=Flowplan",
    "Comment=Flowplan at login",
    `Exec=${exec}`,
    "Icon=flowplan",
    "Terminal=false",
    "StartupWMClass=flowplan",
    "X-GNOME-Autostart-enabled=true",
    "",
  ].join("\n");
}
// What starts the app on Linux: the AppImage itself when it runs as one
// (the mounted path changes every start), otherwise the executable – with
// the app's folder when it runs unpackaged (development).
function linuxCommand({ env = process.env, execPath = process.execPath, packaged = true, appPath = "" } = {}) {
  if (env.APPIMAGE && path.isAbsolute(env.APPIMAGE)) return { command: env.APPIMAGE, args: [] };
  return { command: execPath, args: packaged ? [] : [appPath] };
}
// Whether this start was a hidden one at login.
function startsHidden(argv = process.argv, loginItem = {}) {
  return argv.includes(HIDDEN_ARG) || loginItem.wasOpenedAsHidden === true;
}

// Applies the settings. Returns what was done, for tests and the log.
function apply(settings, { app, platform = process.platform, env = process.env } = {}) {
  if (platform === "darwin" || platform === "win32") {
    const options = loginItemOptions(settings, { platform, execPath: process.execPath });
    app.setLoginItemSettings(options);
    return { kind: "login-item", options };
  }
  const file = autostartPath(env);
  if (!settings.launchAtLogin) {
    fs.rmSync(file, { force: true });
    return { kind: "xdg", file, removed: true };
  }
  const { command, args } = linuxCommand({ env, execPath: process.execPath, packaged: app.isPackaged, appPath: app.getAppPath() });
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, autostartEntry({ command, args, hidden: settings.startHidden === true }), { mode: 0o644 });
  return { kind: "xdg", file };
}

module.exports = { HIDDEN_ARG, loginItemOptions, autostartPath, autostartEntry, linuxCommand, startsHidden, apply };
