// Two bridges, each only where it belongs. The preload is attached to the
// window, so it checks where it runs; the main process checks the sender of
// every call once more (main.js, guards.js).
//
// - window.flowplanDesktop: the app's own pages (setup, profiles, offline,
//   sign-in, settings, quick capture, the screen region overlay, the update
//   toast and the quick capture hint) on file: – the profiles, the sign-in,
//   the settings, quick capture and the toasts' buttons. The capture and
//   region channels answer only their own window (main.js).
// - window.FlowplanDesktop: the pages of the window profile's own instance
//   (its origin comes from main.js as --flowplan-instance=…) – a tiny bridge:
//   Settings → Notifications can show that the app handles notifications
//   and switch them on or off; the text menu of the editor gets spelling
//   suggestions (from the spell checker here, nothing leaves the page) and
//   can add a word to the dictionary; the page menu can open a page of the
//   instance in a window of its own. On a Mac with Apple Intelligence (and
//   the setting on, device-ai.js) it also has `ai`: Apple's on-device model,
//   whose prompts and answers never leave the Mac. Nothing else: the web app
//   runs without extra rights, and other sites (an identity provider, links)
//   get no bridge.
//
// Files dropped on an instance page that the page itself does not take
// (it calls preventDefault for its own drop zones) go to the app – only real
// drops by the person (isTrusted), only files from the disk – which asks
// where to put them (files.js).
const { contextBridge, ipcRenderer, webFrame, webUtils } = require("electron");

const argument = (name) => {
  const prefix = `--${name}=`;
  const found = process.argv.find((a) => a.startsWith(prefix));
  return found ? found.slice(prefix.length) : "";
};
const instance = argument("flowplan-instance");
const WORD = /^\p{L}[\p{L}\p{M}'’-]{0,63}$/u;

if (location.protocol === "file:")
  contextBridge.exposeInMainWorld("flowplanDesktop", {
    platform: process.platform,
    getServer: () => ipcRenderer.invoke("flowplan:get-server"),
    getProfiles: () => ipcRenderer.invoke("flowplan:get-profiles"),
    addProfile: (name, server) => ipcRenderer.invoke("flowplan:add-profile", { name, server }),
    renameProfile: (id, name) => ipcRenderer.invoke("flowplan:rename-profile", id, name),
    removeProfile: (id) => ipcRenderer.invoke("flowplan:remove-profile", id),
    switchProfile: (id) => ipcRenderer.invoke("flowplan:switch-profile", id),
    showProfiles: () => ipcRenderer.invoke("flowplan:show-profiles"),
    newProfile: () => ipcRenderer.invoke("flowplan:new-profile"),
    retry: () => ipcRenderer.invoke("flowplan:retry"),
    pasteSignIn: (text) => ipcRenderer.invoke("flowplan:sign-in-paste", text),
    cancelSignIn: () => ipcRenderer.invoke("flowplan:sign-in-cancel"),
    settings: {
      get: () => ipcRenderer.invoke("flowplan:settings-get"),
      set: (patch) => ipcRenderer.invoke("flowplan:settings-set", patch),
      checkUpdates: () => ipcRenderer.invoke("flowplan:check-updates"),
      aiStatus: () => ipcRenderer.invoke("flowplan:ai-status"),
      // Quick actions need the instance's targets; the queue can be sent now.
      captureTargets: () => ipcRenderer.invoke("flowplan:settings-capture-targets"),
      tryCapture: (actionId) => ipcRenderer.invoke("flowplan:settings-capture-try", actionId ? String(actionId) : ""),
      sendQueue: () => ipcRenderer.invoke("flowplan:settings-send-queue"),
    },
    // Quick capture (capture.js): main.js answers these only to the capture window.
    capture: {
      info: (refresh) => ipcRenderer.invoke("flowplan:capture-info", refresh === true),
      save: (input) => ipcRenderer.invoke("flowplan:capture-save", input),
      preview: (input) => ipcRenderer.invoke("flowplan:capture-preview", input),
      close: () => ipcRenderer.invoke("flowplan:capture-close"),
      undo: (id) => ipcRenderer.invoke("flowplan:capture-undo", String(id)),
      open: (id) => ipcRenderer.invoke("flowplan:capture-open", String(id)),
      clipboard: () => ipcRenderer.invoke("flowplan:capture-clipboard"),
      link: (url) => ipcRenderer.invoke("flowplan:capture-link", String(url)),
      screen: () => ipcRenderer.invoke("flowplan:capture-screen"),
      microphone: () => ipcRenderer.invoke("flowplan:capture-microphone"),
      audio: (bytes, type, targetId) => ipcRenderer.invoke("flowplan:capture-audio", bytes instanceof Uint8Array ? bytes : new Uint8Array(0), String(type), String(targetId)),
      // Real drops only (the page checks isTrusted): paths of files from the disk.
      dropFiles: (files) => ipcRenderer.invoke("flowplan:capture-drop", [...(files || [])].map((file) => { try { return webUtils.getPathForFile(file); } catch { return ""; } }).filter(Boolean)),
      pickFiles: () => ipcRenderer.invoke("flowplan:capture-pick"),
      removeAttachment: (id) => ipcRenderer.invoke("flowplan:capture-remove", String(id)),
      suggest: (input) => ipcRenderer.invoke("flowplan:capture-suggest", input),
      attention: () => ipcRenderer.invoke("flowplan:capture-attention"),
      discard: (id) => ipcRenderer.invoke("flowplan:capture-discard", String(id)),
      retry: () => ipcRenderer.invoke("flowplan:capture-retry"),
      openSettings: (what) => ipcRenderer.invoke("flowplan:capture-open-settings", String(what)),
      onPreset: (callback) => void ipcRenderer.on("flowplan:capture-preset", (_event, preset) => callback(preset)),
      onState: (callback) => void ipcRenderer.on("flowplan:capture-state", (_event, state) => callback(state)),
    },
    // The screen region overlay (screen-capture.js): its picture, the region.
    region: {
      onImage: (callback) => void ipcRenderer.on("flowplan:region-image", (_event, url) => callback(url)),
      done: (rect) => ipcRenderer.invoke("flowplan:region-done", rect),
    },
    // The setup step "So soll Flowplan auf diesem Computer laufen" (onboarding.js).
    setup: {
      defaults: () => ipcRenderer.invoke("flowplan:setup-defaults"),
      apply: (choices) => ipcRenderer.invoke("flowplan:setup-apply", choices),
      tryCapture: () => ipcRenderer.invoke("flowplan:setup-try"),
      finish: () => ipcRenderer.invoke("flowplan:setup-finish"),
    },
    // The one-time hint about quick capture (hint.js).
    hint: {
      info: () => ipcRenderer.invoke("flowplan:hint-info"),
      act: (id) => ipcRenderer.invoke("flowplan:hint-action", String(id)),
    },
    update: {
      state: () => ipcRenderer.invoke("flowplan:update-state"),
      act: (id) => ipcRenderer.invoke("flowplan:update-action", String(id)),
      onState: (callback) => void ipcRenderer.on("flowplan:update-state", (_event, view) => callback(view)),
    },
  });
else if (instance && (location.protocol === "https:" || location.protocol === "http:") && location.origin === instance) {
  const bridge = {
    platform: "desktop",
    version: argument("flowplan-version"),
    notifications: {
      enabled: () => ipcRenderer.invoke("flowplan:notifications-enabled"),
      setEnabled: (on) => ipcRenderer.invoke("flowplan:notifications-set-enabled", on === true),
      refresh: () => void ipcRenderer.invoke("flowplan:notifications-refresh").catch(() => {}),
    },
    // The spell checker of this window (its languages from the settings).
    spelling: {
      check: (word) => {
        const value = String(word || "");
        if (!WORD.test(value) || !webFrame.isWordMisspelled(value)) return { misspelled: false, suggestions: [] };
        return { misspelled: true, suggestions: webFrame.getWordSuggestions(value).slice(0, 6) };
      },
      addWord: (word) => ipcRenderer.invoke("flowplan:spelling-add-word", String(word || "")),
    },
    // A page of this instance in a window of its own.
    openWindow: (url) => void ipcRenderer.invoke("flowplan:open-window", String(url || "")).catch(() => {}),
  };
  // Apple's on-device model: main.js says whether it is there (a Mac build
  // with the helper, the setting on, this instance's main frame). Without
  // it, window.FlowplanDesktop has no `ai` at all.
  let ai = false;
  try {
    ai = ipcRenderer.sendSync("flowplan:ai-present") === true;
  } catch {}
  if (!ai) contextBridge.exposeInMainWorld("FlowplanDesktop", bridge);
  else {
    // Chunks of a stream, for the callback of the request with that id.
    // They arrive apart from the answer, which says how many there were:
    // the stream resolves once all of them came (or after two seconds).
    const streams = new Map();
    ipcRenderer.on("flowplan:ai-chunk", (_event, id, text) => {
      const entry = streams.get(id);
      if (!entry || typeof text !== "string") return;
      entry.received++;
      try {
        entry.onChunk?.(text);
      } catch {}
      if (entry.received >= entry.expected) entry.finish?.();
    });
    const raw = {
      availability: () => ipcRenderer.invoke("flowplan:ai-availability"),
      generate: (request) => ipcRenderer.invoke("flowplan:ai-generate", request),
      stream: async (request, onChunk) => {
        const id = typeof request?.id === "string" ? request.id : "";
        const entry = { onChunk, received: 0, expected: Infinity, finish: null };
        streams.set(id, entry);
        try {
          const answer = await ipcRenderer.invoke("flowplan:ai-stream", request);
          const expected = Number.isInteger(answer?.chunks) ? answer.chunks : 0;
          if (entry.received < expected)
            await new Promise((done) => {
              entry.expected = expected;
              entry.finish = done;
              setTimeout(done, 2000);
            });
          return answer;
        } finally {
          if (streams.get(id) === entry) streams.delete(id);
        }
      },
      cancel: (id) => void ipcRenderer.invoke("flowplan:ai-cancel", String(id ?? "")).catch(() => {}),
    };
    // Errors that cross the context bridge lose their properties, so the
    // bridge with `ai` is made in the page's world: there an answer
    // { error: { code, message } } becomes an Error with its code
    // (unavailable, context-too-long, guardrail, cancelled, busy, error).
    contextBridge.executeInMainWorld({
      func: (bridge, raw) => {
        const failure = (error) => Object.assign(new Error(String(error?.message || "error")), { code: String(error?.code || "error") });
        const unwrap = (promise) =>
          Promise.resolve(promise).then(
            (answer) => {
              if (answer && answer.error) throw failure(answer.error);
              return answer ? answer.value : undefined;
            },
            (error) => {
              throw failure({ code: "error", message: error?.message });
            },
          );
        const ai = Object.freeze({
          version: 1,
          availability: () => unwrap(raw.availability()),
          generate: (request) => unwrap(raw.generate(request)),
          stream: (request, onChunk) => unwrap(raw.stream(request, typeof onChunk === "function" ? onChunk : null)),
          cancel: (id) => void raw.cancel(id),
        });
        const parts = {};
        for (const [key, value] of Object.entries(bridge)) parts[key] = value && typeof value === "object" ? Object.freeze(value) : value;
        Object.defineProperty(window, "FlowplanDesktop", { value: Object.freeze({ ...parts, ai }), enumerable: true });
      },
      args: [bridge, raw],
    });
  }
  // Bubbling, on the window: the page's own handlers ran before.
  window.addEventListener("dragover", (event) => {
    if (event.defaultPrevented || !event.isTrusted || !event.dataTransfer || ![...event.dataTransfer.types].includes("Files")) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  });
  window.addEventListener("drop", (event) => {
    if (event.defaultPrevented || !event.isTrusted || !event.dataTransfer) return;
    const paths = [...event.dataTransfer.files].map((file) => webUtils.getPathForFile(file)).filter(Boolean);
    if (!paths.length) return;
    // No navigation to the file: the app takes it.
    event.preventDefault();
    void ipcRenderer.invoke("flowplan:drop-files", paths).catch(() => {});
  });
}
