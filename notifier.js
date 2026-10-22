// Asks the instances for new notifications and shows them (notifications.js
// decides what is new and where a click may lead). One timer per watched
// profile – the active one, or all with "All Profiles" – that keeps running
// while the window is minimised or hidden (and on macOS after closing it,
// as long as the app stays in the Dock). Requests go only to the profile's
// own instance, with the profile's own session (its cookies, nothing new is
// stored besides the ids already seen); they pause while the computer sleeps
// or is offline.
const { app, Notification, net, powerMonitor, nativeImage } = require("electron");
const decide = require("./notifications");
const { sameOrigin } = require("./guards");

// FLOWPLAN_NOTIFICATION_INTERVAL=<seconds> (at least 2) shortens or
// lengthens every wait in proportion – for test/notifications.mjs and
// managed installations.
function intervalScale(env = process.env) {
  const seconds = Number(env.FLOWPLAN_NOTIFICATION_INTERVAL);
  return Number.isFinite(seconds) && seconds >= 2 ? (seconds * 1000) / decide.BASE_DELAY : 1;
}
// A red dot for the taskbar button on Windows (setOverlayIcon), drawn here
// so no image file is needed.
let dot = null;
function overlayDot() {
  if (dot) return dot;
  const size = 16;
  const pixels = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const distance = Math.hypot(x + 0.5 - size / 2, y + 0.5 - size / 2);
      const alpha = Math.max(0, Math.min(1, size / 2 - distance));
      const i = (y * size + x) * 4;
      // BGRA, premultiplied: #e5484d
      pixels[i] = Math.round(0x4d * alpha);
      pixels[i + 1] = Math.round(0x48 * alpha);
      pixels[i + 2] = Math.round(0xe5 * alpha);
      pixels[i + 3] = Math.round(255 * alpha);
    }
  dot = nativeImage.createFromBitmap(pixels, { width: size, height: size });
  return dot;
}

// deps: getState() → profiles, sessionFor(profile), readConfig(),
// writeConfig(patch), t(key, …), open(profileId, url) for a click,
// focusedProfile() → the profile whose window is in front (no popups for
// it: the inbox is in view), getWindow() and changed() (rebuild the menu).
function setupNotifier(deps) {
  const scale = intervalScale();
  const watchers = new Map(); // profile id → { timer, failures, busy, last }
  const unread = new Map(); // profile id → unread count
  const alive = new Set(); // shown notifications, kept until closed (GC)
  let started = false;
  let suspended = false;
  let dndTimer = null;
  let badge = -1;

  const settings = () => decide.settingsOf(deps.readConfig());
  const watched = () => (suspended ? [] : decide.profilesToWatch(deps.getState(), settings()));
  const savedStates = () => {
    const value = deps.readConfig().notificationState;
    return value && typeof value === "object" ? value : {};
  };
  function saveState(id, value) {
    deps.writeConfig({ notificationState: { ...savedStates(), [id]: value } });
  }
  function saveSettings(patch) {
    const current = settings();
    deps.writeConfig({
      notifications: { enabled: current.enabled, allProfiles: current.allProfiles, dnd: current.dnd, dndUntil: current.dndUntil, ...patch },
    });
    reconcile();
    deps.changed?.();
  }

  function schedule(id, delay) {
    const w = watchers.get(id);
    if (!w) return;
    clearTimeout(w.timer);
    w.timer = setTimeout(() => void poll(id), Math.max(0, delay));
  }
  function stop(id) {
    const w = watchers.get(id);
    if (w) clearTimeout(w.timer);
    watchers.delete(id);
  }
  // Starts and stops the timers to match the settings and profiles.
  function reconcile(delay = 0) {
    if (!started) return;
    const list = watched();
    const ids = new Set(list.map((p) => p.id));
    for (const id of [...watchers.keys()]) if (!ids.has(id)) stop(id);
    for (const id of [...unread.keys()]) if (!ids.has(id)) unread.delete(id);
    for (const p of list)
      if (!watchers.has(p.id)) {
        watchers.set(p.id, { timer: null, failures: 0, busy: false, last: 0 });
        schedule(p.id, delay);
      }
    applyBadge();
    planDndEnd();
  }

  async function poll(id) {
    const w = watchers.get(id);
    if (!w || w.busy) return;
    const profile = deps.getState().profiles.find((p) => p.id === id);
    if (!profile) return stop(id);
    if (!net.isOnline()) return schedule(id, decide.BASE_DELAY * scale);
    w.busy = true;
    w.last = Date.now();
    let outcome = "error";
    try {
      const saved = decide.profileStateOf(savedStates()[id]);
      const url = new URL("/api/notifications", profile.server);
      if (saved.primed && saved.since) url.searchParams.set("since", saved.since);
      const response = await deps.sessionFor(profile).fetch(url.href, {
        headers: { Accept: "application/json" },
        redirect: "error",
        cache: "no-store",
        signal: AbortSignal.timeout(15000),
      });
      outcome = decide.outcomeOf(response.status);
      if (response.url && !sameOrigin(response.url, profile.server)) outcome = "error";
      if (outcome === "ok") {
        const data = await response.json();
        if (watchers.get(id) === w) {
          const result = decide.takeNew(savedStates()[id], data);
          if (result.changed) saveState(id, result.state);
          unread.set(id, result.unread);
          applyBadge();
          if (result.fresh.length) show(profile, result.fresh);
        }
      } else if (outcome === "signed-out") {
        unread.delete(id);
        applyBadge();
      }
    } catch {
      outcome = "error";
    } finally {
      w.busy = false;
    }
    if (watchers.get(id) !== w) return;
    w.failures = outcome === "error" ? w.failures + 1 : 0;
    schedule(id, decide.nextDelay(outcome, w.failures) * scale);
  }

  function show(profile, fresh) {
    const current = settings();
    if (!current.enabled || decide.isQuiet(current)) return;
    if (deps.focusedProfile() === profile.id) return;
    const items = decide.present(fresh, { profileName: profile.name, showProfile: deps.getState().profiles.length > 1, t: deps.t });
    for (const item of items) {
      const open = () => deps.open(profile.id, item.url);
      if (Notification.isSupported()) {
        const note = new Notification({ title: item.title, body: item.body });
        alive.add(note);
        note.on("click", open);
        note.on("close", () => alive.delete(note));
        note.show();
        // Windows does not always report "close": keep the newest 20.
        if (alive.size > 20) alive.delete(alive.values().next().value);
      }
      // For test/notifications.mjs (Linux CI has no notification server).
      app.emit("flowplan-notification", { profile: profile.id, title: item.title, body: item.body, url: item.url, click: open });
    }
  }

  // The unread count on the icon: Dock (macOS), launcher (Linux, Unity and
  // KDE), a dot on the taskbar button with the count as description (Windows).
  function applyBadge(force = false) {
    const count = settings().enabled ? decide.badgeCount(unread, watched()) : 0;
    if (count === badge && !force) return;
    badge = count;
    try {
      app.setBadgeCount(count);
    } catch {}
    if (process.platform === "win32") {
      const w = deps.getWindow();
      if (w && !w.isDestroyed()) w.setOverlayIcon(count ? overlayDot() : null, count ? deps.t("notifications.badge", count) : "");
    }
    app.emit("flowplan-badge", count);
  }

  // When "Do Not Disturb" ends, the menu shows it.
  function planDndEnd() {
    clearTimeout(dndTimer);
    const current = settings();
    if (!decide.isQuiet(current)) return;
    dndTimer = setTimeout(() => deps.changed?.(), Math.min(current.dndUntil - Date.now() + 1000, 2 ** 31 - 1));
  }

  return {
    start() {
      if (started) return;
      started = true;
      powerMonitor.on("suspend", () => {
        suspended = true;
        reconcile();
      });
      powerMonitor.on("resume", () => {
        suspended = false;
        reconcile(5000);
      });
      reconcile(3000 * Math.min(1, scale));
    },
    reconcile,
    applyBadge,
    settings,
    // From the bridge or the menu.
    setEnabled(on) {
      saveSettings({ enabled: on === true });
      return settings().enabled;
    },
    setAllProfiles(on) {
      saveSettings({ allProfiles: on === true });
    },
    setDnd(choice) {
      const until = decide.dndUntil(choice);
      saveSettings({ dnd: until ? choice : null, dndUntil: until });
    },
    // Asks again soon – at most every 3 seconds (the page calls it after
    // every change, e.g. reading a notification).
    refresh(id) {
      const w = watchers.get(id);
      if (!w || w.busy) return;
      schedule(id, Math.max(0, w.last + 3000 - Date.now()));
    },
    forgetProfile(id) {
      const states = { ...savedStates() };
      delete states[id];
      deps.writeConfig({ notificationState: states });
      stop(id);
      unread.delete(id);
      reconcile();
    },
  };
}

module.exports = { setupNotifier, intervalScale };
