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

// A page of the instance that loaded, but as an error page that is not
// Flowplan's own (#373): the reverse proxy's "404 page not found" (Traefik,
// Pangolin) or its 502 while Flowplan is away. Such a page has no way back
// – no sign-in, no profiles –, so the window treats it like a failed load:
// the start page (the service worker's copy, or Flowplan again), and for
// the start page itself the app's offline page with "Try again" and
// "Profiles". Every answer of Flowplan names its build (X-Flowplan-Build);
// instances older than that are recognised by their HTML error pages, which
// link back themselves. `answer`: what the main frame's response said, as
// far as the app saw it ({ flowplan, contentType }); null when unknown.
// Returns null (leave the page), "start" or "offline-page".
function errorPageFallback({ url, origin, status, answer }) {
  if (!origin || !Number.isFinite(status) || status < 400) return null;
  let target;
  try {
    target = new URL(url);
  } catch {
    return null;
  }
  if (target.origin !== origin) return null;
  if (answer?.flowplan) return null;
  const html = /^text\/html\b/i.test(answer?.contentType || "");
  // Flowplan's start page never answers with an error of its own without
  // its build; other addresses may be an older instance's own HTML page.
  if (target.pathname !== "/" && status < 500 && (!answer || html)) return null;
  return fallbackFor(url, origin);
}
module.exports = { fallbackFor, errorPageFallback };
