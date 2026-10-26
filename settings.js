// The app's own settings beyond profiles and notifications, in one place:
// the tray / menu bar icon, launch at login, the quick capture shortcut,
// the spell checker's languages, Apple's on-device model (deviceAi) and
// the quick actions (more shortcuts for the capture window, capture-actions.js).
// They live in config.json (`settings`), are changed from the menu and from
// pages/settings.html, and are checked here –
// plain functions without Electron, so test/security.mjs and
// test/features.mjs can run them with Node alone. Whatever comes from the
// file or from the settings page is checked again: unknown keys fall away,
// wrong types fall back to the default.

// Spell checking: German, English and French, any of them (at least one).
const SPELL_LANGUAGES = ["de-DE", "en-US", "fr-FR"];
const DEFAULT_SHORTCUT = "CommandOrControl+Shift+Space";

// Electron accelerators: modifiers joined with "+", then one key. Only what
// a global shortcut can use, at least one modifier (a single key would
// swallow typing in every other app), at most 60 characters.
const MODIFIERS = ["Command", "Cmd", "Control", "Ctrl", "CommandOrControl", "CmdOrCtrl", "Alt", "Option", "AltGr", "Shift", "Super", "Meta"];
const KEY = /^([A-Z0-9]|F([1-9]|1[0-9]|2[0-4])|Space|Tab|Backspace|Delete|Insert|Return|Enter|Up|Down|Left|Right|Home|End|PageUp|PageDown|Escape|Esc|Plus|[)!@#$%^&*(:;<=>?_~{}|"',./\\`[\]-])$/;
function isShortcut(value) {
  if (typeof value !== "string" || !value || value.length > 60) return false;
  const parts = value.split("+");
  // "Plus" is the key for "+"; a trailing "+" would leave an empty part.
  if (parts.some((part) => !part)) return false;
  const key = parts.pop();
  if (!parts.length || !KEY.test(key)) return false;
  const seen = new Set();
  for (const part of parts) {
    if (!MODIFIERS.includes(part) || seen.has(part)) return false;
    seen.add(part);
  }
  // Shift alone is no modifier for a shortcut (it only types capitals).
  return !(parts.length === 1 && parts[0] === "Shift");
}

// The tray / menu bar icon is on by default on macOS (the menu bar), off on
// Windows and Linux (behaves differently on every Linux desktop, and with
// it closing the window keeps the app running).
function defaults(platform = process.platform) {
  return {
    tray: platform === "darwin",
    launchAtLogin: false,
    startHidden: false,
    captureShortcut: DEFAULT_SHORTCUT,
    spellLanguages: SPELL_LANGUAGES.slice(),
    // Apple Intelligence on this Mac (device-ai.js): optional, on by default
    // where the helper exists – it only starts when a page asks. Off, the
    // helper never runs and the instance has no window.FlowplanDesktop.ai.
    deviceAi: true,
    // Quick actions (capture-actions.js): none until the person adds one.
    captureActions: [],
  };
}

function cleanLanguages(value, fallback) {
  if (!Array.isArray(value)) return fallback;
  const list = SPELL_LANGUAGES.filter((language) => value.includes(language));
  return list.length ? list : fallback;
}
// One value checked against its default; null for the shortcut means "off".
function cleanValue(key, value, base) {
  switch (key) {
    case "tray":
    case "launchAtLogin":
    case "startHidden":
    case "deviceAi":
      return typeof value === "boolean" ? value : base[key];
    case "captureShortcut":
      if (value === null || value === false || value === "") return null;
      return isShortcut(value) ? value : base[key];
    case "spellLanguages":
      return cleanLanguages(value, base[key]);
    case "captureActions":
      return Array.isArray(value) ? require("./capture-actions").cleanActions(value, base.captureShortcut) : base[key];
    default:
      return undefined;
  }
}
// config.json → the settings, every value checked.
function settingsOf(config = {}, platform = process.platform) {
  const base = defaults(platform);
  const saved = config && typeof config.settings === "object" && config.settings ? config.settings : {};
  const result = {};
  for (const key of Object.keys(base)) result[key] = key in saved ? cleanValue(key, saved[key], { ...base, captureShortcut: result.captureShortcut ?? base.captureShortcut }) : base[key];
  return result;
}
// A change from the menu or the settings page: only known keys with valid
// values; everything else is dropped. Returns what config.json keeps.
function applyPatch(config = {}, patch = {}, platform = process.platform) {
  const current = settingsOf(config, platform);
  const next = { ...current };
  if (patch && typeof patch === "object")
    for (const key of Object.keys(current)) {
      if (!(key in patch)) continue;
      const value = cleanValue(key, patch[key], current);
      if (value !== undefined) next[key] = value;
    }
  // Hidden at login only means something when the app starts at login.
  if (!next.launchAtLogin) next.startHidden = false;
  // A new main shortcut takes precedence over a quick action's.
  if (patch && "captureShortcut" in patch) next.captureActions = require("./capture-actions").cleanActions(next.captureActions, next.captureShortcut);
  return next;
}

// The shortcut as people read it: ⌘⇧Space on macOS, Ctrl+Shift+Space elsewhere.
function shortcutLabel(value, platform = process.platform) {
  if (!value) return "";
  const mac = platform === "darwin";
  const names = mac
    ? { CommandOrControl: "⌘", CmdOrCtrl: "⌘", Command: "⌘", Cmd: "⌘", Control: "⌃", Ctrl: "⌃", Alt: "⌥", Option: "⌥", AltGr: "⌥", Shift: "⇧", Super: "⌘", Meta: "⌘" }
    : { CommandOrControl: "Ctrl", CmdOrCtrl: "Ctrl", Command: "Super", Cmd: "Super", Control: "Ctrl", Ctrl: "Ctrl", Alt: "Alt", Option: "Alt", AltGr: "AltGr", Shift: "Shift", Super: "Super", Meta: "Super" };
  const parts = value.split("+");
  const key = parts.pop();
  const mods = parts.map((part) => names[part] || part);
  return mac ? `${mods.join("")}${key}` : [...mods, key].join("+");
}

module.exports = { SPELL_LANGUAGES, DEFAULT_SHORTCUT, isShortcut, defaults, settingsOf, applyPatch, shortcutLabel };
