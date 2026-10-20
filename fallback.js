// What the window shows when a page of the instance fails to load. Offline
// use (Settings → Data → Offline use) stores the app under "/" in the
// instance's service worker, so a failed page of the instance first goes to
// "/" – the worker answers it from the device copy when there is one. Only
// when "/" itself fails (no copy, offline use off) the app's own offline
// page appears.
function fallbackFor(failedUrl, origin) {
  let url;
  try {
    url = new URL(failedUrl);
  } catch {
    return "offline-page";
  }
  if (!origin || url.origin !== origin) return "offline-page";
  return url.pathname === "/" ? "offline-page" : "start";
}
module.exports = { fallbackFor };
