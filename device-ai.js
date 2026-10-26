// Apple's on-device model on the Mac: the helper process (native/device-ai)
// and the requests to it. No Electron here – main.js hands in the command
// (device-ai-rules.helperCommand) and the pages' requests, test/device-ai.mjs
// runs it against a stand-in helper with Node alone.
//
// The helper starts on the first request, never before (with the setting
// off, main.js never asks). One generate or stream request at a time –
// another one is "busy" – while availability is always answered. A request
// ends after TIMING.requestMs (the helper is then stopped, it may hang); a
// cancel waits TIMING.graceMs for the helper's answer, then stops it too.
// After TIMING.idleMs without a request the helper is stopped (its memory is
// the model's); after a crash it starts again on the next request, a little
// later each time (restartDelay). Processes are only ever stopped by their
// own PID.
const { spawn: nodeSpawn } = require("node:child_process");
const rules = require("./device-ai-rules");

const { AiError } = rules;
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

function createDeviceAi({ command, args = [], env = {}, spawn = nodeSpawn, timing = {}, now = Date.now, onEvent = () => {} }) {
  const times = { ...rules.TIMING, ...timing };
  let child = null;
  let starting = null;
  let buffer = "";
  let seq = 0;
  let active = null; // the generate or stream request in the helper
  let idleTimer = null;
  const pending = new Map(); // helper id → request
  const crashes = [];
  const stopped = new WeakMap(); // process stopped on purpose → error for its requests

  function signal(proc, name) {
    try {
      if (proc.pid) process.kill(proc.pid, name);
    } catch {}
  }
  // Ends a helper: stdin closed (it exits by itself), then SIGTERM and
  // SIGKILL to its PID if it is still there.
  function stopProcess(proc, error) {
    if (!proc || proc.exitCode !== null || proc.signalCode !== null) return;
    if (!stopped.has(proc)) stopped.set(proc, error);
    try {
      proc.stdin.end();
    } catch {}
    const term = setTimeout(() => signal(proc, "SIGTERM"), times.graceMs);
    const kill = setTimeout(() => signal(proc, "SIGKILL"), times.graceMs * 2);
    term.unref?.();
    kill.unref?.();
    proc.once("exit", () => {
      clearTimeout(term);
      clearTimeout(kill);
    });
    // Its requests end now, not when it is gone.
    for (const entry of [...pending.values()]) if (entry.proc === proc) settle(entry, error);
    if (child === proc) child = null;
  }

  function scheduleIdle() {
    clearTimeout(idleTimer);
    if (pending.size || !child) return;
    idleTimer = setTimeout(() => {
      if (!pending.size && child) {
        onEvent("idle", { pid: child.pid });
        stopProcess(child, new AiError("unavailable", "stopped"));
      }
    }, times.idleMs);
    idleTimer.unref?.();
  }

  function settle(entry, error, value) {
    if (entry.settled) return;
    entry.settled = true;
    pending.delete(entry.id);
    clearTimeout(entry.timer);
    clearTimeout(entry.grace);
    if (active === entry) active = null;
    if (error) entry.reject(error);
    else entry.resolve(value);
    scheduleIdle();
  }

  function onLine(proc, line) {
    const message = rules.helperMessage(line);
    const entry = message && pending.get(message.id);
    if (!entry || entry.proc !== proc) return;
    try {
      if (message.type === "availability") {
        if (entry.kind === "availability") settle(entry, null, rules.availabilityOf(message));
      } else if (message.type === "chunk") {
        if (entry.kind !== "stream" || typeof message.text !== "string" || message.text.length > rules.LIMITS.answer) return;
        try {
          entry.onChunk?.(message.text);
        } catch {}
      } else if (message.type === "done") {
        if (entry.kind === "availability") return;
        crashes.length = 0;
        settle(entry, null, rules.answerOf(message, { schema: entry.schema }));
      } else if (message.type === "error") {
        settle(entry, rules.errorOf(message));
      }
    } catch (error) {
      settle(entry, error instanceof AiError ? error : new AiError("error", String(error?.message || error)));
    }
  }

  function startProcess() {
    const proc = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, ...env }, windowsHide: true });
    child = proc;
    buffer = "";
    onEvent("spawn", { pid: proc.pid });
    proc.stdout.setEncoding("utf8");
    proc.stdout.on("data", (data) => {
      if (child !== proc) return;
      buffer += data;
      let index;
      while ((index = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 1);
        onLine(proc, line);
        if (child !== proc) return;
      }
      // A line without end: the helper is broken.
      if (buffer.length > rules.LIMITS.line) stopProcess(proc, new AiError("error", "the helper's answer is too long"));
    });
    proc.stderr.on("data", () => {});
    proc.stdin.on("error", () => {});
    let gone = false;
    const exit = (detail) => {
      if (gone) return;
      gone = true;
      const intended = stopped.get(proc);
      if (!intended) {
        crashes.push(now());
        onEvent("crash", { pid: proc.pid, detail });
      }
      for (const entry of [...pending.values()]) if (entry.proc === proc) settle(entry, intended || new AiError("error", "the helper stopped"));
      if (child === proc) child = null;
    };
    proc.on("error", (error) => exit(error.code || error.message));
    proc.on("exit", (code, sig) => exit(sig || code));
    return proc;
  }

  async function ensure() {
    if (child) return child;
    if (!starting)
      starting = (async () => {
        const delay = rules.restartDelay(crashes, now());
        if (delay === Infinity) throw new AiError("unavailable", "the helper keeps stopping");
        if (delay > 0) await sleep(delay);
        return child || startProcess();
      })().finally(() => (starting = null));
    return starting;
  }

  async function request(kind, payload, { owner = "", onChunk } = {}) {
    if (kind !== "availability" && active) throw new AiError("busy", "another request is running");
    const entry = { id: String(++seq), kind, owner, pageId: payload.id, schema: !!payload.schema, onChunk, settled: false };
    if (kind !== "availability") active = entry;
    let proc;
    try {
      proc = await ensure();
    } catch (error) {
      if (active === entry) active = null;
      throw error;
    }
    return new Promise((resolve, reject) => {
      entry.resolve = resolve;
      entry.reject = reject;
      entry.proc = proc;
      clearTimeout(idleTimer);
      if (entry.cancelled) return settle(entry, new AiError("cancelled", "cancelled"));
      if (child !== proc) return settle(entry, stopped.get(proc) || new AiError("error", "the helper stopped"));
      pending.set(entry.id, entry);
      entry.timer = setTimeout(
        () => {
          onEvent("timeout", { kind, pid: proc.pid });
          const error = new AiError("error", "timed out");
          settle(entry, error);
          // A hanging model: the helper goes, the next request starts a new one.
          if (kind !== "availability") stopProcess(proc, error);
        },
        kind === "availability" ? times.availabilityMs : times.requestMs,
      );
      try {
        proc.stdin.write(`${JSON.stringify({ ...payload, id: entry.id, type: kind })}\n`);
      } catch {
        settle(entry, new AiError("error", "the helper stopped"));
      }
    });
  }

  // A cancel from the page that started the request (its owner).
  function cancel(owner, pageId) {
    const entry = active;
    if (!entry || entry.owner !== owner || entry.pageId !== pageId || entry.settled) return false;
    entry.cancelled = true;
    if (!entry.proc || !pending.has(entry.id)) return true; // not sent yet: ends once started
    try {
      entry.proc.stdin.write(`${JSON.stringify({ id: entry.id, type: "cancel" })}\n`);
    } catch {}
    const proc = entry.proc;
    entry.grace = setTimeout(() => {
      const error = new AiError("cancelled", "cancelled");
      settle(entry, error);
      stopProcess(proc, error);
    }, times.graceMs);
    return true;
  }
  // A page that went away: its request ends.
  function cancelOwner(owner) {
    if (active && active.owner === owner) return cancel(owner, active.pageId);
    return false;
  }

  return {
    availability: () => request("availability", {}).catch(() => ({ available: false, reason: "error" })),
    generate: async (input, options) => request("generate", rules.checkRequest(input, "generate"), options),
    stream: async (input, options) => request("stream", rules.checkRequest(input, "stream"), options),
    cancel,
    cancelOwner,
    // The setting went off, or the app quits.
    stop: (error = new AiError("unavailable", "switched off")) => {
      clearTimeout(idleTimer);
      if (child) stopProcess(child, error);
    },
    status: () => ({ running: !!child, pid: child?.pid ?? null, busy: !!active, crashes: crashes.length }),
  };
}

module.exports = { createDeviceAi };
