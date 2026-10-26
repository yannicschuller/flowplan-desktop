// Links of the form flowplan://… open the app. Two kinds:
//
//   flowplan://sign-in?…   the hand-off of a sign-in in the browser (sign-in.js)
//   flowplan://open?…      a page of an instance:
//     flowplan://open?instance=https://flowplan.example.com&page=<id>[&row=<id>][&thread=<id>]
//     flowplan://open?url=https://flowplan.example.com/#page=<id>
//     flowplan://open/flowplan.example.com?page=<id>     (the path form, https)
//
// A link opens in the profile of its instance (the active profile when it
// points there, otherwise the first one); a link to an instance without a
// profile asks first whether to add it – the app never navigates to an
// origin the person did not agree to. Only http(s) origins of an instance
// (https, or http on loopback addresses – guards.instanceOrigin) and pages
// of it (no /api/, no credentials) come out of here. Plain functions without
// Electron, checked by test/security.mjs and test/features.mjs.
const { instanceOrigin, instancePageUrl } = require("./guards");

const SCHEME = "flowplan:";
const MAX_LENGTH = 4000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseLink(value) {
  if (typeof value !== "string" || value.length > MAX_LENGTH) return null;
  let link;
  try {
    link = new URL(value);
  } catch {
    return null;
  }
  if (link.protocol !== SCHEME) return null;
  if (link.hostname === "sign-in") return { kind: "sign-in" };
  if (link.hostname !== "open") return null;
  const params = link.searchParams;
  // url=: an address of an instance, as copied from the browser.
  if (params.has("url")) {
    const origin = instanceOrigin(params.get("url"));
    const url = origin && instancePageUrl(params.get("url"), origin);
    return url ? { kind: "open", origin, url } : null;
  }
  // instance= or the path form flowplan://open/<host>.
  let origin = null;
  if (params.has("instance")) origin = instanceOrigin(params.get("instance"));
  else {
    const host = decodeURIComponent(link.pathname.replace(/^\/+/, "").split("/")[0] || "");
    if (host && /^[a-z0-9.-]+(:\d{1,5})?$/i.test(host)) origin = instanceOrigin(`https://${host}`);
  }
  if (!origin) return null;
  const hash = new URLSearchParams();
  for (const key of ["page", "row", "thread"]) {
    const id = params.get(key);
    if (id === null) continue;
    if (!UUID.test(id)) return null;
    hash.set(key, id.toLowerCase());
  }
  // A row or thread needs its page.
  if (!hash.has("page") && [...hash.keys()].length) return null;
  const url = hash.has("page") ? `${origin}/#${hash}` : `${origin}/`;
  return { kind: "open", origin, url };
}

// Which profile opens a link: { profileId, url } for a known instance,
// { unknown: origin, url } for an instance without a profile.
function linkTarget(link, state) {
  if (!link || link.kind !== "open") return null;
  const profiles = (state && state.profiles) || [];
  const active = profiles.find((p) => p.id === state.activeProfile && p.server === link.origin);
  const profile = active || profiles.find((p) => p.server === link.origin);
  if (profile) return { profileId: profile.id, url: link.url };
  return { unknown: link.origin, url: link.url };
}

// The links among command line arguments (Windows and Linux start a second
// instance with the link as argument).
const linksFromArgs = (argv = []) => argv.filter((a) => typeof a === "string" && a.toLowerCase().startsWith("flowplan://"));

// The link for a page, as the server's "Open in desktop app" builds it.
function pageLink(origin, pageId, rowId) {
  const params = new URLSearchParams({ instance: origin, page: pageId });
  if (rowId) params.set("row", rowId);
  return `flowplan://open?${params}`;
}

module.exports = { parseLink, linkTarget, linksFromArgs, pageLink };
