// What the window lets through: which pages may use the preload bridges, which
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
// A page of the profile's own instance (http/https, same origin). The small
// bridge window.FlowplanDesktop (notifications on/off) exists only there, and
// main.js checks every call from it with this once more.
function isInstancePage(url, origin) {
  if (typeof url !== "string" || !/^https?:/i.test(url)) return false;
  return sameOrigin(url, origin);
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
// The capture window's own session: the microphone alone (a voice note),
// only for the capture page itself – nothing else, never a camera or screen.
function capturePermissionAllowed(permission, details, fromCaptureWindow) {
  if (!fromCaptureWindow) return false;
  if (permission !== "media") return false;
  const types = details && details.mediaTypes;
  return Array.isArray(types) && types.length === 1 && types[0] === "audio";
}
// Channels of one window of the app (the capture window, the screen region
// overlay): only that window's own page may call them.
function fromWindow(sender, senderUrl, window, pagesDir) {
  return !!window && !window.isDestroyed?.() && sender === window.webContents && isOwnPage(senderUrl, pagesDir);
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
// The address of an instance: an https origin (http only for loopback
// addresses, local tests), nothing else – no path, no credentials.
function instanceOrigin(value) {
  let url;
  try {
    url = new URL(String(value));
  } catch {
    return null;
  }
  if (url.username || url.password) return null;
  if (url.protocol === "https:") return url.origin;
  if (url.protocol === "http:" && LOOPBACK.includes(url.hostname)) return url.origin;
  return null;
}
// What the app hands to the system browser or mail program: http(s) and
// mailto only – never file:, javascript:, a custom scheme or the like.
function externalUrl(value) {
  if (typeof value !== "string" || !value || value.length > 8000) return null;
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol === "mailto:") return url.href;
  if ((url.protocol === "https:" || url.protocol === "http:") && !url.username && !url.password) return url.href;
  return null;
}
// A page of the profile's instance that may open in a window of its own
// (or be remembered for one): same origin, no credentials, no endpoint.
function instancePageUrl(value, origin) {
  if (!origin || typeof value !== "string" || value.length > 4000) return null;
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.origin !== origin || url.username || url.password || url.pathname.startsWith("/api/")) return null;
  return url.href;
}
// Shift-click (new-window), middle- or Ctrl-click (background-tab) and
// window.open (foreground-tab) ask for another window; a plain link does not.
const OWN_WINDOW_DISPOSITIONS = ["new-window", "background-tab", "foreground-tab"];
const opensOwnWindow = (disposition) => OWN_WINDOW_DISPOSITIONS.includes(disposition);
// A word for the spell checker's own dictionary (from the right-click menu
// or the web app's text menu): one word, letters with apostrophes or
// hyphens inside, at most 64 characters.
function dictionaryWord(value) {
  return typeof value === "string" && /^\p{L}[\p{L}\p{M}'’-]{0,63}$/u.test(value) && !/['’-]$/.test(value);
}
module.exports = {
  instanceOrigin,
  externalUrl,
  instancePageUrl,
  opensOwnWindow,
  dictionaryWord,
  pagesUrl,
  isOwnPage,
  sameOrigin,
  isInstancePage,
  allowedInWindow,
  isSignInRedirect,
  permissionAllowed,
  capturePermissionAllowed,
  fromWindow,
  updateFeedUrl,
  classifyHealth,
  defaultPagesDir: path.join(__dirname, "pages"),
};
