// Where quick capture saves: the inbox (default), a database the person may
// add records to, today's journal entry (appended) or a page (appended as a
// block) – the list from the instance (GET /api/capture/targets), checked
// here; recently used targets first, remembered per profile in config.json
// (`captureRecent`: ids only, no titles).
//
// Pages of end-to-end encrypted spaces are never in the list: the instance
// cannot write into them, and the capture window has no keys (it is not the
// web app) – the instance leaves them out and counts them, the window says
// why.
//
// Plain functions without Electron, for test/features.mjs.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_TARGETS = 300;
const MAX_RECENT = 8;
const KINDS = ["database", "document", "journal"];

const text = (value, max) => (typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max) : "");
const isTargetId = (value) => value === "inbox" || (typeof value === "string" && UUID.test(value));

// The instance's answer → { inbox, targets, encryptedExcluded, voice, suggest, … }.
function normalizeTargets(data) {
  const inbox = data && data.inbox && UUID.test(data.inbox.id) ? { id: data.inbox.id, name: text(data.inbox.name, 80) } : null;
  const seen = new Set();
  const targets = [];
  for (const t of Array.isArray(data?.targets) ? data.targets : []) {
    if (!t || !UUID.test(t.id) || !KINDS.includes(t.kind) || t.encrypted || t.locked || seen.has(t.id)) continue;
    seen.add(t.id);
    const entry = { id: t.id.toLowerCase(), kind: t.kind, name: text(t.name, 80) || "…", space: text(t.space, 40), workspace: text(t.workspace, 40) };
    if (t.kind === "database") {
      entry.fills = { date: text(t.fills?.date, 60) || null, tags: t.fills?.tags === true, person: text(t.fills?.person, 60) || null };
      entry.templates = (Array.isArray(t.templates) ? t.templates : []).filter((r) => r && UUID.test(r.id)).slice(0, 20).map((r) => ({ id: r.id, name: text(r.name, 60) || "…", default: r.default === true }));
    }
    targets.push(entry);
    if (targets.length >= MAX_TARGETS) break;
  }
  const suggest = data?.suggest && typeof data.suggest === "object" ? { server: data.suggest.server === true, device: data.suggest.device === true, prefer: data.suggest.prefer === "device" ? "device" : "server" } : null;
  return {
    inbox,
    targets,
    encryptedExcluded: Number.isInteger(data?.encryptedExcluded) && data.encryptedExcluded > 0 ? data.encryptedExcluded : 0,
    voice: data?.voice === true,
    suggest: suggest && (suggest.server || suggest.device) ? suggest : null,
    maxFiles: Number.isInteger(data?.maxFiles) ? Math.min(data.maxFiles, 10) : 10,
    maxUploadMb: Number.isFinite(data?.maxUploadMb) ? data.maxUploadMb : 50,
  };
}

// The picker's list: the inbox, then the recently used, then the rest by
// name (databases, journals, pages). `recent`: ids, newest first.
function orderTargets(list, recent = []) {
  const byId = new Map(list.targets.map((t) => [t.id, t]));
  const inbox = { id: "inbox", kind: "inbox", name: list.inbox ? list.inbox.name : "", pageId: list.inbox ? list.inbox.id : null };
  const recentEntries = recent.filter((id) => id !== "inbox" && byId.has(id)).map((id) => ({ ...byId.get(id), recent: true }));
  const rank = { database: 0, journal: 1, document: 2 };
  const rest = list.targets
    .filter((t) => !recent.includes(t.id) && t.id !== list.inbox?.id)
    .sort((a, b) => rank[a.kind] - rank[b.kind] || a.name.localeCompare(b.name));
  return [inbox, ...recentEntries, ...rest];
}
// Typing in the picker: every word in the name, space or workspace.
function filterTargets(ordered, query) {
  const words = String(query || "")
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length) return ordered;
  return ordered.filter((t) => {
    const hay = `${t.name} ${t.space || ""} ${t.workspace || ""}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}
// config.captureRecent after using `targetId` with a profile.
function rememberTarget(recentByProfile, profileId, targetId, max = MAX_RECENT) {
  const all = recentByProfile && typeof recentByProfile === "object" ? recentByProfile : {};
  if (!isTargetId(targetId)) return all;
  const list = (Array.isArray(all[profileId]) ? all[profileId] : []).filter((id) => isTargetId(id) && id !== targetId);
  return { ...all, [profileId]: [targetId, ...list].slice(0, max) };
}
const recentOf = (recentByProfile, profileId) => (Array.isArray(recentByProfile?.[profileId]) ? recentByProfile[profileId].filter(isTargetId).slice(0, MAX_RECENT) : []);
// The last one used, if it still exists; otherwise the inbox.
function initialTarget(ordered, recent) {
  const last = recent[0];
  return ordered.find((t) => t.id === last) ? last : "inbox";
}
// The page a target writes to (for transcribing a voice note into it).
const pageOf = (ordered, targetId) => (targetId === "inbox" ? ordered.find((t) => t.id === "inbox")?.pageId || null : UUID.test(targetId) ? targetId : null);

module.exports = { isTargetId, normalizeTargets, orderTargets, filterTargets, rememberTarget, recentOf, initialTarget, pageOf, MAX_RECENT };
