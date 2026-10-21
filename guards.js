// What the window lets through: which pages may use the preload bridge, which
// addresses may open inside the window, which permissions the instance gets
// and which update source counts. Plain functions without Electron, so
// test/security.mjs can run them with Node alone.
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const LOOPBACK = ["localhost", "127.0.0.1", "[::1]"];

// file:///…/pages/ – the app's own pages (setup, offline, sign-in).
function pagesUrl(pagesDir) {
  const href = pathToFileURL(pagesDir).href;
  return href.endsWith("/") ? href : `${href}/`;
}
// Only a page from the app's own pages directory may call the bridge
// (ipcMain handlers check the sender frame with this).
function isOwnPage(url, pagesDir) {
  if (typeof url !== "string" || !url.startsWith("file:")) return false;
  let target;
  try {
    target = new URL(url);
  } catch {
    return false;
  }
  // Compare the normalised address: "..", "%2e%2e" and the like fall away.
  const base = new URL(pagesUrl(pagesDir));
  return target.protocol === "file:" && target.pathname.startsWith(base.pathname) && target.pathname.length > base.pathname.length;
}
function sameOrigin(url, origin) {
  if (!origin) return false;
  try {
    return new URL(url).origin === origin;
  } catch {
    return false;
  }
}
// Whether a navigation may stay in the window: the app's own pages, the
// instance itself (its sign-in flow included) and the identity provider the
// instance's sign-in redirected to – everything else opens in the browser.
function allowedInWindow(url, { server, pagesDir, identityHosts = new Set() }) {
  if (isOwnPage(url, pagesDir)) return true;
  if (sameOrigin(url, server)) return true;
  try {
    return identityHosts.has(new URL(url).host);
  } catch {
    return false;
  }
}
// The instance's sign-in (/api/auth/…) is the only place that may hand over
// to another host: redirects from there (and onwards) are remembered.
function isSignInRedirect(url, server) {
  return sameOrigin(url, server) && /\/api\/auth\//.test(url);
}
// Permissions for the instance: notifications, clipboard, fullscreen and the
// microphone alone (voice notes) – never camera or screen.
const PLAIN_PERMISSIONS = ["notifications", "clipboard-read", "clipboard-sanitized-write", "fullscreen"];
function permissionAllowed(permission, details, fromInstance) {
  if (!fromInstance) return false;
  if (PLAIN_PERMISSIONS.includes(permission)) return true;
  if (permission === "media") {
    const types = details && details.mediaTypes;
    return Array.isArray(types) && types.length === 1 && types[0] === "audio";
  }
  return false;
}
// FLOWPLAN_UPDATE_URL: only https (http only for loopback addresses, used by
// test/update.mjs) – an update source is trusted with the whole app.
function updateFeedUrl(value) {
  if (!value) return null;
  let url;
  try {
    url = new URL(String(value));
  } catch {
    return null;
  }
  if (url.protocol === "https:") return url.href;
  if (url.protocol === "http:" && LOOPBACK.includes(url.hostname)) return url.href;
  return null;
}
// What the health check of an address says about it.
//   ok          – a Flowplan instance
//   proxy-auth  – something in front asks for a sign-in first (401/403/407)
//   error       – a server error (5xx, 404 …)
//   html        – a web page, but not Flowplan
//   other       – no Flowplan
function classifyHealth({ status, contentType = "", data }) {
  const flowplan =
    data?.service === "flowplan" ||
    (data && typeof data.checks === "object" && data.checks !== null && "database" in data.checks && "searchBacklog" in data);
  if (flowplan) return "ok";
  if ([401, 403, 407].includes(status)) return "proxy-auth";
  if (status >= 400) return "error";
  if (/text\/html/i.test(contentType)) return "html";
  return "other";
}
module.exports = {
  pagesUrl,
  isOwnPage,
  sameOrigin,
  allowedInWindow,
  isSignInRedirect,
  permissionAllowed,
  updateFeedUrl,
  classifyHealth,
  defaultPagesDir: path.join(__dirname, "pages"),
};
