// "Im Marketplace veröffentlichen …" in the app: the instance hands the
// template to the marketplace's submit page by postMessage (contract in
// flowplan's lib/marketplace-handover.ts): it opens
// <marketplace>/submit?handover=1 with window.open, that page says "ready"
// to window.opener, the instance answers with the package. That needs a real
// opener – the system browser has none, so the marketplace opens in a window
// of the app for this one hand-over.
//
// The page asks window.FlowplanDesktop.armMarketplaceWindow(origin) first
// (origin: the instance's configured marketplace, by default
// https://marketplace.flowplan.org), synchronously, right before
// window.open: that arms the NEXT window.open
// of that window to that origin for a few seconds. Only the main frame of
// the profile's own instance can arm (main.js checks the sender like every
// instance channel). Every other window.open – unarmed, another origin,
// after the time – stays as it was: the system browser.
//
// The marketplace window:
// - no preload (no bridge of any kind), contextIsolation, sandbox, no
//   nodeIntegration, no <webview>;
// - the session of the window that opened it – Chromium keeps an opener only
//   within one session, so a partition of its own is not possible; the
//   profile's session is persistent, so the marketplace sign-in lasts;
//   permissions are refused there (guards.permissionAllowed, not the
//   instance);
// - navigation only on the marketplace's origin and GitHub's sign-in
//   (github.com) and back; everything else, and every window.open from it,
//   goes to the system browser;
// - downloads ask where to save them (Electron's save dialog).
//
// Plain functions without Electron, for test/security.mjs and
// test/features.mjs.
const { instanceOrigin, externalUrl } = require("./guards");

const ARM_MS = 10_000;
// Where the marketplace's sign-in goes: GitHub's OAuth pages (login, two
// factors, authorize) – all on github.com.
const SIGN_IN_ORIGINS = ["https://github.com"];

// The origin a page may arm: https (http only for loopback, local tests),
// no credentials; never the instance itself.
function marketplaceOrigin(value, instance) {
  if (typeof value !== "string" || !value || value.length > 2000) return null;
  const origin = instanceOrigin(value);
  if (!origin || origin === instance) return null;
  return origin;
}
const originOf = (url) => {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
};
// window.open(url) of an armed window: the armed origin, http(s), no
// credentials.
function opensMarketplace(url, origin) {
  if (!origin || typeof url !== "string" || url.length > 8000) return false;
  let target;
  try {
    target = new URL(url);
  } catch {
    return false;
  }
  if (target.username || target.password) return false;
  if (target.protocol !== "https:" && target.protocol !== "http:") return false;
  return target.origin === origin;
}
// A navigation inside the marketplace window.
function allowedInMarketplaceWindow(url, origin) {
  const at = originOf(url);
  if (!at || !origin) return false;
  if (!/^https?:/i.test(url)) return false;
  return at === origin || SIGN_IN_ORIGINS.includes(at);
}
// What leaves the marketplace window for the system browser: http(s) and
// mailto only (guards.externalUrl).
const externalFromMarketplace = (url) => externalUrl(url);

// Armed windows per webContents id: { origin, until }, taken once.
function createArming({ now = () => Date.now(), ttl = ARM_MS } = {}) {
  const armed = new Map();
  return {
    arm(id, origin) {
      if (!origin) return false;
      armed.set(id, { origin, until: now() + ttl });
      return true;
    },
    // The origin when `url` is the armed window.open of `id` – once.
    take(id, url) {
      const entry = armed.get(id);
      if (!entry) return null;
      armed.delete(id);
      if (entry.until <= now() || !opensMarketplace(url, entry.origin)) return null;
      return entry.origin;
    },
    clear(id) {
      armed.delete(id);
    },
    size: () => armed.size,
  };
}

// The BrowserWindow options of the marketplace window (Electron's
// overrideBrowserWindowOptions): a normal window like the app's page windows.
function windowOptions({ isMac = process.platform === "darwin", dark = false, bounds } = {}) {
  const place = bounds && Number.isInteger(bounds.x) && Number.isInteger(bounds.y) ? { x: bounds.x + 32, y: bounds.y + 32 } : {};
  return {
    width: 1100,
    height: 820,
    ...place,
    minWidth: 380,
    minHeight: 500,
    title: "Flowplan Marketplace",
    show: true,
    backgroundColor: dark ? "#16151b" : "#fcfbf8",
    autoHideMenuBar: !isMac,
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      nodeIntegrationInSubFrames: false,
      nodeIntegrationInWorker: false,
      webviewTag: false,
      javascript: true,
      spellcheck: true,
      safeDialogs: true,
      navigateOnDragDrop: false,
    },
  };
}

module.exports = {
  ARM_MS,
  SIGN_IN_ORIGINS,
  marketplaceOrigin,
  opensMarketplace,
  allowedInMarketplaceWindow,
  externalFromMarketplace,
  createArming,
  windowOptions,
};
