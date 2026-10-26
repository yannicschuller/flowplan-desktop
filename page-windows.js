// Pages in windows of their own: from the Window menu, a Shift-, middle- or
// Ctrl-click on a link of the instance, the right-click menu of a link, or
// the web app asking through window.FlowplanDesktop.openWindow (the page
// menu's "Open in new window"). Such a window keeps the session of its
// profile and the same rules as the main window (main.js). Which windows were
// open, with their size and place, is remembered per profile in config.json
// (`pageWindows`) and restored when the profile opens again.
//
// Plain functions without Electron (test/security.mjs, test/features.mjs):
// what comes from the file is checked again – only pages of the profile's
// own instance (guards.instancePageUrl), sizes that fit on a screen.
const { instancePageUrl } = require("./guards");

const MAX_PAGE_WINDOWS = 12;
const MIN = { width: 380, height: 300 };
const MAX_SIZE = 20000;

function cleanBounds(bounds) {
  if (!bounds || typeof bounds !== "object") return null;
  const n = (v) => (Number.isInteger(v) && Math.abs(v) <= MAX_SIZE ? v : null);
  const width = n(bounds.width);
  const height = n(bounds.height);
  if (width === null || height === null || width < MIN.width || height < MIN.height) return null;
  const x = n(bounds.x);
  const y = n(bounds.y);
  return x === null || y === null ? { width, height } : { x, y, width, height };
}
// The remembered windows of a profile, checked.
function savedPageWindows(config, profile) {
  if (!profile) return [];
  const all = config && typeof config.pageWindows === "object" && config.pageWindows ? config.pageWindows : {};
  const list = Array.isArray(all[profile.id]) ? all[profile.id] : [];
  const result = [];
  for (const entry of list) {
    const url = entry && instancePageUrl(entry.url, profile.server);
    if (!url) continue;
    result.push({ url, bounds: cleanBounds(entry.bounds) });
    if (result.length >= MAX_PAGE_WINDOWS) break;
  }
  return result;
}
// config.json's pageWindows with this profile's list replaced; profiles
// that no longer exist fall away.
function withPageWindows(config, state, profileId, list) {
  const all = config && typeof config.pageWindows === "object" && config.pageWindows ? config.pageWindows : {};
  const ids = new Set((state?.profiles || []).map((p) => p.id));
  const next = {};
  for (const [id, value] of Object.entries(all)) if (ids.has(id) && Array.isArray(value)) next[id] = value.slice(0, MAX_PAGE_WINDOWS);
  const profile = (state?.profiles || []).find((p) => p.id === profileId);
  if (profile) {
    const clean = (list || [])
      .map((entry) => ({ url: instancePageUrl(entry && entry.url, profile.server), bounds: cleanBounds(entry && entry.bounds) }))
      .filter((entry) => entry.url)
      .slice(0, MAX_PAGE_WINDOWS);
    if (clean.length) next[profileId] = clean;
    else delete next[profileId];
  }
  return next;
}

module.exports = { MAX_PAGE_WINDOWS, cleanBounds, savedPageWindows, withPageWindows };
