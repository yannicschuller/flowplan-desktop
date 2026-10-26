// "Zuletzt erfasst": the last captures of a profile (title, target, time,
// where it is) for the capture window and the tray, and "Rückgängig" right
// after saving – for ten seconds, through the instance (POST
// /api/capture/undo: a record to the trash, appended blocks removed while
// unchanged). A capture still in the offline queue is undone by taking it
// out of the queue. Kept with the queue (capture-store.js, encrypted).
//
// Plain functions without Electron, for test/features.mjs.
const MAX_HISTORY = 20;
const UNDO_MS = 10_000;

const clip = (value, max) => (typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max) : "");
// entry: { id, title, target, at, url?, pageId?, rowId?, undo?, queued? }
function addEntry(history, entry, max = MAX_HISTORY) {
  const clean = {
    id: String(entry.id),
    title: clip(entry.title, 120) || "…",
    target: clip(entry.target, 80),
    at: Number.isFinite(entry.at) ? entry.at : Date.now(),
    ...(entry.url ? { url: String(entry.url) } : {}),
    ...(entry.undo ? { undo: entry.undo } : {}),
    ...(entry.queued ? { queued: true } : {}),
  };
  return [clean, ...history.filter((e) => e.id !== clean.id)].slice(0, max);
}
// The queued capture was sent: it now has its place (and can be opened).
function settle(history, id, { url, undo } = {}) {
  return history.map((e) => (e.id === id ? { ...e, queued: false, ...(url ? { url } : {}), ...(undo ? { undo } : {}) } : e));
}
const canUndo = (entry, now = Date.now(), windowMs = UNDO_MS) => !!entry && !entry.undone && (entry.queued || !!entry.undo) && now - entry.at <= windowMs;
const markUndone = (history, id) => history.map((e) => (e.id === id ? { ...e, undone: true, undo: undefined, url: undefined } : e)).filter((e) => !(e.id === id && e.queued));
// For the window and the tray: newest first, without undone ones.
const visible = (history, max = MAX_HISTORY) => history.filter((e) => !e.undone).slice(0, max);

module.exports = { MAX_HISTORY, UNDO_MS, addEntry, settle, canUndo, markUndone, visible };
