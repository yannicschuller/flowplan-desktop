// First-run setup and the one-time hint for quick capture.
//
// - After the first instance is added and signed in, the setup page shows
//   one more step, "So soll Flowplan auf diesem Computer laufen": quick
//   capture with its shortcut (change it, try it, a taken one is reported),
//   the tray or menu bar icon, launch at login and the start in the
//   background (only with launch at login). The switches start as the
//   settings' defaults of this system, every one can be skipped, and they
//   are the settings themselves (settings.js) – no second store; the step
//   says they can be changed later under Settings.
// - People who used the app before this version and never captured get one
//   small hint in the corner of the window, "Neu: Schnell erfassen mit
//   {shortcut} – Einstellungen" – never again once closed, used or after
//   the first capture.
//
// What happened is kept in config.json (`onboarding`). Plain functions
// without Electron, for test/features.mjs.
const { defaults } = require("./settings");

const KEYS = ["setupPending", "setupDone", "hintShown", "hintDismissed", "captureUsed"];
function stateOf(config = {}) {
  const raw = config && typeof config.onboarding === "object" && config.onboarding ? config.onboarding : {};
  const out = {};
  for (const key of KEYS) out[key] = raw[key] === true;
  return out;
}
const withState = (config, patch) => ({ ...stateOf(config), ...patch });

// What the setup step's switches start with on this system.
function setupDefaults(platform = process.platform) {
  const base = defaults(platform);
  return { capture: !!base.captureShortcut, captureShortcut: base.captureShortcut, tray: base.tray, launchAtLogin: base.launchAtLogin, startHidden: base.startHidden };
}
// The step's choices as a settings patch (the shortcut off when unchecked).
function setupPatch(choices, current) {
  const patch = {};
  if (typeof choices?.tray === "boolean") patch.tray = choices.tray;
  if (typeof choices?.launchAtLogin === "boolean") patch.launchAtLogin = choices.launchAtLogin;
  if (typeof choices?.startHidden === "boolean") patch.startHidden = choices.launchAtLogin === true && choices.startHidden;
  if (choices?.capture === false) patch.captureShortcut = null;
  else if (choices?.capture === true && !current?.captureShortcut) patch.captureShortcut = defaults().captureShortcut;
  return patch;
}

// The first instance was just added: the step comes once it is signed in.
function afterFirstProfile(config, profilesBefore) {
  if (profilesBefore > 0) return stateOf(config);
  return withState(config, { setupPending: true });
}
const showSetupStep = (config) => stateOf(config).setupPending && !stateOf(config).setupDone;
// The step is finished (or skipped): it does not come back, nor does the hint.
const setupFinished = (config) => withState(config, { setupPending: false, setupDone: true, hintDismissed: true });

// The hint: profiles from before, quick capture on, never used, not closed.
function showHint(config, settings) {
  const state = stateOf(config);
  const hasProfiles = Array.isArray(config?.profiles) ? config.profiles.length > 0 : !!config?.server;
  if (!hasProfiles || !settings?.captureShortcut) return false;
  return !state.setupPending && !state.setupDone && !state.hintDismissed && !state.captureUsed;
}
const hintDismissed = (config) => withState(config, { hintDismissed: true });
const captureUsed = (config) => withState(config, { captureUsed: true, hintDismissed: true });

module.exports = { stateOf, setupDefaults, setupPatch, afterFirstProfile, showSetupStep, setupFinished, showHint, hintDismissed, captureUsed };
