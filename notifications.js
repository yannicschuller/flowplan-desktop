// Notifications without push: Electron has no push service, so the app asks
// the instance itself (GET /api/notifications, with the profile's session)
// and shows new ones as system notifications, with the unread count on the
// app icon. This file holds the decisions – settings, "Do Not Disturb", how
// long to wait, which notifications are new, where a click may lead – as
// plain functions without Electron, so test/security.mjs and
// test/notifications.mjs can run them with Node alone. notifier.js does the
// asking, showing and badge.
const { sameOrigin } = require("./guards");

const SECOND = 1000;
const MINUTE = 60 * SECOND;
// Every minute while it works; longer after errors (doubling up to 15
// minutes), every 5 minutes while signed out and every 30 minutes against an
// instance without the endpoint (Flowplan 0.6.0 and older).
const BASE_DELAY = MINUTE;
const MAX_DELAY = 15 * MINUTE;
const SIGNED_OUT_DELAY = 5 * MINUTE;
const MISSING_DELAY = 30 * MINUTE;
// Ids remembered per profile (the server answers with at most 50).
const SEEN_MAX = 100;
// More new ones at once become one summary.
const SHOW_MAX = 3;
const DND_CHOICES = ["hour", "tomorrow"];

// config.json → { enabled, allProfiles, dnd, dndUntil }. On by default, the
// active profile only.
function settingsOf(config = {}) {
  const saved = config && typeof config.notifications === "object" && config.notifications ? config.notifications : {};
  const until = Number(saved.dndUntil);
  const dnd = DND_CHOICES.includes(saved.dnd) && Number.isFinite(until) && until > 0 ? saved.dnd : null;
  return {
    enabled: saved.enabled !== false,
    allProfiles: saved.allProfiles === true,
    dnd,
    dndUntil: dnd ? until : null,
  };
}
// "Do Not Disturb": one hour, or until 8 o'clock tomorrow (local time).
function dndUntil(choice, now = Date.now()) {
  if (choice === "hour") return now + 60 * MINUTE;
  if (choice === "tomorrow") {
    const next = new Date(now);
    next.setDate(next.getDate() + 1);
    next.setHours(8, 0, 0, 0);
    return next.getTime();
  }
  return null;
}
const isQuiet = (settings, now = Date.now()) => !!settings.dndUntil && now < settings.dndUntil;
// The choice the menu shows: "off" once the time has passed.
const dndChoice = (settings, now = Date.now()) => (isQuiet(settings, now) ? settings.dnd : "off");

// Which profiles are asked: none when switched off, otherwise the active one
// or all of them.
function profilesToWatch(state, settings) {
  if (!settings.enabled) return [];
  if (settings.allProfiles) return state.profiles.slice();
  const active = state.profiles.find((p) => p.id === state.activeProfile);
  return active ? [active] : [];
}

// What an answer means for the next question.
function outcomeOf(status) {
  if (status >= 200 && status < 300) return "ok";
  if (status === 401 || status === 403) return "signed-out";
  if (status === 404) return "missing";
  return "error";
}
function nextDelay(outcome, failures = 0) {
  if (outcome === "ok") return BASE_DELAY;
  if (outcome === "signed-out") return SIGNED_OUT_DELAY;
  if (outcome === "missing") return MISSING_DELAY;
  return Math.min(MAX_DELAY, BASE_DELAY * 2 ** Math.max(0, Math.min(10, failures)));
}

// What is remembered per profile (config.json notificationState.<id>):
// the newest server time seen, the ids already known, and whether the first
// answer came (it only marks what is there as known – a new profile or a
// fresh installation does not show old notifications).
function profileStateOf(saved) {
  const value = saved && typeof saved === "object" ? saved : {};
  const since = typeof value.since === "string" && !Number.isNaN(Date.parse(value.since)) ? value.since : null;
  const seen = Array.isArray(value.seen) ? value.seen.filter((id) => typeof id === "string" && id.length <= 100).slice(0, SEEN_MAX) : [];
  return { since, seen, primed: value.primed === true };
}
const text = (value, max) => (typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max) : "");
// The server's answer, checked: only the fields used, only strings and flags.
function cleanFeed(data) {
  const list = data && Array.isArray(data.notifications) ? data.notifications : [];
  const notifications = list
    .filter((n) => n && typeof n.id === "string" && n.id && n.id.length <= 100)
    .slice(0, 100)
    .map((n) => ({
      id: n.id,
      text: text(n.text, 300),
      detail: text(n.detail, 120),
      url: typeof n.url === "string" ? n.url.slice(0, 2000) : "",
      createdAt: typeof n.createdAt === "string" && !Number.isNaN(Date.parse(n.createdAt)) ? n.createdAt : null,
      read: n.read === true,
      push: n.push === true,
    }));
  const unread = data ? data.unread : 0;
  return { notifications, unread: Number.isInteger(unread) && unread >= 0 ? unread : 0 };
}
// The new ones of an answer (unread, push on for their kind, not seen
// before; oldest first) and the state to remember.
function takeNew(previous, data) {
  const prev = profileStateOf(previous);
  const feed = cleanFeed(data);
  const known = new Set(prev.seen);
  const unseen = feed.notifications.filter((n) => !known.has(n.id));
  const fresh = prev.primed
    ? unseen.filter((n) => !n.read && n.push).sort((a, b) => Date.parse(a.createdAt || 0) - Date.parse(b.createdAt || 0))
    : [];
  let since = prev.since;
  for (const n of feed.notifications) if (n.createdAt && (!since || Date.parse(n.createdAt) > Date.parse(since))) since = n.createdAt;
  const state = { since, seen: [...unseen.map((n) => n.id), ...prev.seen].slice(0, SEEN_MAX), primed: true };
  const changed = !prev.primed || unseen.length > 0 || since !== prev.since;
  return { state, fresh, unread: feed.unread, changed };
}

// The system notifications for new ones: the inbox line as title, the
// record (and with several profiles the profile) below. More than three at
// once become one that opens the inbox.
function present(fresh, { profileName = "", showProfile = false, t = (key, ...args) => [key, ...args].join(" ") } = {}) {
  const suffix = showProfile && profileName ? profileName : "";
  if (fresh.length > SHOW_MAX)
    return [{ id: fresh[fresh.length - 1].id, title: t("notifications.many", fresh.length), body: suffix, url: "/#inbox" }];
  return fresh.map((n) => ({
    id: n.id,
    title: n.text || "Flowplan",
    body: [n.detail, suffix].filter(Boolean).join(" · "),
    url: n.url,
  }));
}

// Where a click leads: an address of the profile's own instance only –
// anything else (another site, javascript:, a broken value) opens the
// instance's start page.
function targetUrl(url, origin) {
  if (!origin) return null;
  try {
    const target = new URL(String(url || "/"), origin);
    if ((target.protocol === "https:" || target.protocol === "http:") && sameOrigin(target.href, origin) && !target.username && !target.password)
      return target.href;
  } catch {}
  return new URL("/", origin).href;
}

// The number on the icon: the unread notifications of the watched profiles.
function badgeCount(unread, watched) {
  let total = 0;
  for (const p of watched) {
    const n = unread.get(p.id);
    if (Number.isInteger(n) && n > 0) total += n;
  }
  return total;
}

module.exports = {
  BASE_DELAY,
  MAX_DELAY,
  SIGNED_OUT_DELAY,
  MISSING_DELAY,
  SEEN_MAX,
  SHOW_MAX,
  settingsOf,
  dndUntil,
  isQuiet,
  dndChoice,
  profilesToWatch,
  outcomeOf,
  nextDelay,
  profileStateOf,
  cleanFeed,
  takeNew,
  present,
  targetUrl,
  badgeCount,
};
