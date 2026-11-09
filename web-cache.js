// The browser cache of a profile's session (#182): what the window keeps of
// the instance's pages between starts – HTTP cache and compiled scripts.
// After an update of the instance or of this app an old copy there could
// keep running in the window (Firefox showed the same until its cache was
// cleared). Cleared here, and only these two: cookies (the sign-in), the
// service worker and its offline copy (Cache Storage), IndexedDB and local
// storage stay.
//
// - once after an update of this app (a new Chromium as well), at the start
//   before a window loads (`clearOnStart`, config.webCacheVersion);
// - when the instance's page asks for it before loading itself again past
//   an outdated copy (window.FlowplanDesktop.clearCache, the page's
//   self-heal, flowplan lib/stale-copy.ts) – at most once a minute per
//   session.

// Whether this start clears the caches: the app's version differs from the
// one that last cleared them (also the first start with this file).
function clearOnStart(config, version) {
  return !!version && config?.webCacheVersion !== version;
}

// HTTP cache and code cache of a session; never rejects, at most `ms` long.
function clearWebCache(ses, ms = 5000) {
  const jobs = [];
  try {
    jobs.push(Promise.resolve(ses.clearCache()).catch(() => {}));
    if (typeof ses.clearCodeCaches === "function") jobs.push(Promise.resolve(ses.clearCodeCaches({})).catch(() => {}));
  } catch {}
  return Promise.race([Promise.all(jobs).then(() => true), new Promise((done) => setTimeout(() => done(false), ms))]);
}

// The page's requests: one clearing per session and minute.
function createLimiter(windowMs = 60_000, now = () => Date.now()) {
  const last = new WeakMap();
  return (key) => {
    const at = last.get(key);
    if (at !== undefined && now() - at < windowMs) return false;
    last.set(key, now());
    return true;
  };
}

module.exports = { clearOnStart, clearWebCache, createLimiter };
