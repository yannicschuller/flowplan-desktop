// Profiles: several Flowplan instances in one app ("Work – flowplan.company.com",
// "Private – notes.me"), one of them active. Each profile has its own
// Electron session (partition persist:profile-<id>), so cookies, the offline
// copy of the service worker and everything else a page stores never mix –
// not even for two profiles on the same instance (two accounts). The single
// address older versions remembered becomes the first profile and keeps the
// default session, so its sign-in and offline copy stay.
//
// Plain functions without Electron, so test/security.mjs can run them with
// Node alone. Whatever comes from config.json is checked again here: the
// partition is derived from the id, never read from the file.
const { randomBytes } = require("node:crypto");

const ID = /^[a-z0-9]{1,32}$/;
const MAX_NAME = 60;
const MAX_PROFILES = 20;

function originOf(value) {
  try {
    const url = new URL(String(value));
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.origin;
  } catch {
    return null;
  }
}
const newId = () => randomBytes(6).toString("hex");
const hostOf = (origin) => {
  try {
    return new URL(origin).host;
  } catch {
    return String(origin || "");
  }
};
// A name for menus and the title bar: one line, no control characters, at
// most 60 characters; empty → the host of the instance.
function cleanName(name, origin) {
  const value = String(name ?? "")
    .replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_NAME)
    .trim();
  return value || hostOf(origin);
}
// The Electron partition of a profile: null for the default session (the
// profile migrated from the single address), persist:profile-<id> otherwise.
function partitionFor(profile) {
  if (!profile) return null;
  if (profile.legacy === true) return null;
  if (!ID.test(profile.id)) throw new Error(`invalid profile id: ${profile.id}`);
  return `persist:profile-${profile.id}`;
}
// What config.json holds, checked: { profiles: [...], activeProfile }. An
// old config with only { server } becomes one profile on the default session.
function loadProfiles(config = {}) {
  const profiles = [];
  const ids = new Set();
  let legacyTaken = false;
  if (Array.isArray(config.profiles)) {
    for (const entry of config.profiles) {
      if (!entry || typeof entry !== "object") continue;
      const server = originOf(entry.server);
      if (!server || entry.server !== server) continue;
      if (typeof entry.id !== "string" || !ID.test(entry.id) || ids.has(entry.id)) continue;
      // Only one profile can own the default session.
      const legacy = entry.legacy === true && !legacyTaken;
      if (legacy) legacyTaken = true;
      ids.add(entry.id);
      profiles.push({ id: entry.id, name: cleanName(entry.name, server), server, ...(legacy ? { legacy: true } : {}) });
      if (profiles.length >= MAX_PROFILES) break;
    }
  } else {
    const server = originOf(config.server);
    if (server && config.server === server) profiles.push({ id: "main", name: cleanName("", server), server, legacy: true });
  }
  const active = profiles.find((p) => p.id === config.activeProfile) || profiles[0] || null;
  return { profiles, activeProfile: active ? active.id : null };
}
// What goes back into config.json. `server` mirrors the active profile for
// older versions of the app (a downgrade still finds an instance).
function toConfig(state) {
  const active = activeOf(state);
  return {
    profiles: state.profiles.map((p) => ({ id: p.id, name: p.name, server: p.server, ...(p.legacy ? { legacy: true } : {}) })),
    activeProfile: active ? active.id : null,
    server: active ? active.server : undefined,
  };
}
const activeOf = (state) => state.profiles.find((p) => p.id === state.activeProfile) || null;
const findProfile = (state, id) => state.profiles.find((p) => p.id === id) || null;

function addProfile(state, { name, server }, id = newId()) {
  const origin = originOf(server);
  if (!origin) throw new Error(`invalid server: ${server}`);
  if (state.profiles.length >= MAX_PROFILES) throw new Error("too many profiles");
  while (findProfile(state, id)) id = newId();
  const profile = { id, name: cleanName(name, origin), server: origin };
  return { state: { profiles: [...state.profiles, profile], activeProfile: id }, profile };
}
function renameProfile(state, id, name) {
  const profile = findProfile(state, id);
  if (!profile) throw new Error(`unknown profile: ${id}`);
  return { ...state, profiles: state.profiles.map((p) => (p.id === id ? { ...p, name: cleanName(name, p.server) } : p)) };
}
// Removes a profile; the active one moves to its neighbour (or none).
function removeProfile(state, id) {
  const index = state.profiles.findIndex((p) => p.id === id);
  if (index < 0) throw new Error(`unknown profile: ${id}`);
  const profiles = state.profiles.filter((p) => p.id !== id);
  let activeProfile = state.activeProfile;
  if (activeProfile === id) activeProfile = (profiles[index] || profiles[index - 1] || null)?.id ?? null;
  return { profiles, activeProfile };
}
// The profile after the active one, around the end ("Next Profile").
function nextProfile(state) {
  if (!state.profiles.length) return null;
  const index = state.profiles.findIndex((p) => p.id === state.activeProfile);
  return state.profiles[(index + 1) % state.profiles.length];
}
// --profile=<id or name> on the command line (Windows jump list, scripts):
// only a saved profile, never a new address.
function profileFromArgs(state, argv = []) {
  const arg = argv.find((a) => typeof a === "string" && a.startsWith("--profile="));
  if (!arg) return null;
  const wanted = arg.slice("--profile=".length);
  return findProfile(state, wanted) || state.profiles.find((p) => p.name.toLowerCase() === wanted.toLowerCase()) || null;
}
// "Work – flowplan.company.com" for menus.
const profileLabel = (profile) => {
  const host = hostOf(profile.server);
  return profile.name === host ? host : `${profile.name} – ${host}`;
};

module.exports = {
  MAX_PROFILES,
  cleanName,
  partitionFor,
  loadProfiles,
  toConfig,
  activeOf,
  findProfile,
  addProfile,
  renameProfile,
  removeProfile,
  nextProfile,
  profileFromArgs,
  profileLabel,
};
