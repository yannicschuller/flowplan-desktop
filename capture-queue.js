// The offline queue of quick capture: what was captured while the instance
// could not be reached waits here (capture-store.js keeps it, encrypted) and
// is sent once the connection is back – on its own, with growing pauses
// between attempts, right away when the computer wakes or goes online.
//
// Every capture has its own Idempotency-Key from the moment it is made, and
// every attempt sends exactly the same request (the same body, the same
// multipart boundary): when an answer got lost after the instance saved
// it, the next attempt gets the stored answer instead of a second record.
//
// What the instance refuses for good (a page that is gone, a file too
// large) stays in the queue marked "needs attention" – the text is never
// thrown away; the capture window shows it to copy or discard.
//
// Plain functions without Electron, for test/features.mjs.
const { randomUUID } = require("node:crypto");

const MAX_ITEMS = 200;
// Files of queued captures, all together (base64 in the store).
const MAX_QUEUED_BYTES = 60 * 1024 * 1024;
// Pauses between attempts: 5 s, 15 s, 30 s, 1, 2, 5, 10 minutes, then every 15.
const BACKOFF = [5_000, 15_000, 30_000, 60_000, 120_000, 300_000, 600_000, 900_000];
const backoff = (attempts) => BACKOFF[Math.min(Math.max(0, attempts - 1), BACKOFF.length - 1)];

// payload: { fields: {…}, files: [{ name, type, data (base64) }] }
function newItem(payload, { profileId, now = Date.now(), title = "", target = "" } = {}) {
  return {
    id: randomUUID(),
    key: randomUUID(),
    // The multipart boundary, fixed: a retry is byte for byte the same.
    boundary: `----flowplan${randomUUID().replace(/-/g, "")}`,
    profileId,
    createdAt: now,
    attempts: 0,
    nextAt: now,
    title: String(title).slice(0, 120),
    target: String(target).slice(0, 80),
    payload,
  };
}
const sizeOf = (item) => (item.payload?.files || []).reduce((sum, f) => sum + (typeof f.data === "string" ? f.data.length : 0), 0);

// Adds an item; refuses (throws "queue-full") beyond the limits rather than
// dropping an older capture.
function enqueue(queue, item) {
  if (queue.length >= MAX_ITEMS) throw Object.assign(new Error("queue-full"), { kind: "queue-full" });
  if (queue.reduce((sum, i) => sum + sizeOf(i), 0) + sizeOf(item) > MAX_QUEUED_BYTES) throw Object.assign(new Error("queue-full"), { kind: "queue-full" });
  return [...queue, item];
}
// What is due now, oldest first; never those that need attention.
const dueItems = (queue, now = Date.now()) => queue.filter((i) => !i.failed && i.nextAt <= now).sort((a, b) => a.createdAt - b.createdAt);
// Back online or awake: everything waiting is due at once.
const wakeUp = (queue, now = Date.now()) => queue.map((i) => (i.failed ? i : { ...i, nextAt: Math.min(i.nextAt, now) }));

// An ApiError kind (instance-api.js) → try again later, or not at all.
//   offline, server (5xx, a broken answer), signed-out (until signed in),
//   in-progress (409 of an Idempotency-Key still running), rate limits: again.
//   rejected, too-large, no-inbox: needs attention.
function retryable(error) {
  const kind = error && error.kind;
  if (["offline", "server", "signed-out", "in-progress"].includes(kind)) return true;
  if (kind === "rejected" && [408, 425, 429].includes(error.status)) return true;
  return false;
}
function afterFailure(queue, id, error, now = Date.now()) {
  return queue.map((i) => {
    if (i.id !== id) return i;
    const attempts = i.attempts + 1;
    const message = String(error?.detail || error?.kind || error?.message || "error").slice(0, 300);
    if (!retryable(error)) return { ...i, attempts, failed: true, lastError: message };
    return { ...i, attempts, nextAt: now + backoff(attempts), lastError: message };
  });
}
const remove = (queue, id) => queue.filter((i) => i.id !== id);
// Sends what is due, one after the other; `send(item)` resolves with the
// instance's answer or throws an ApiError. Returns the new queue and what
// was sent. Stops at the first connection error (the rest would fail too).
async function drain(queue, send, { now = () => Date.now(), onSent = () => {} } = {}) {
  let current = queue;
  const sent = [];
  for (const item of dueItems(queue, now())) {
    try {
      const result = await send(item);
      current = remove(current, item.id);
      sent.push({ item, result });
      onSent(item, result);
    } catch (error) {
      current = afterFailure(current, item.id, error, now());
      if (error && error.kind === "offline") break;
    }
  }
  return { queue: current, sent };
}
// What the window, the tray and the settings show.
function summary(queue) {
  return { waiting: queue.filter((i) => !i.failed).length, failed: queue.filter((i) => i.failed).length };
}

module.exports = { MAX_ITEMS, MAX_QUEUED_BYTES, BACKOFF, backoff, newItem, enqueue, dueItems, wakeUp, retryable, afterFailure, remove, drain, summary };
