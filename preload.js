// Two bridges, each only where it belongs. The preload is attached to the
// window, so it checks where it runs; the main process checks the sender of
// every call once more (main.js, guards.js).
//
// - window.flowplanDesktop: the app's own pages (setup, profiles, offline,
//   sign-in, settings, quick capture, the update toast) on file: – the
//   profiles, the sign-in, the settings, saving a quick capture and the
//   update's buttons.
// - window.FlowplanDesktop: the pages of the window profile's own instance
//   (its origin comes from main.js as --flowplan-instance=…) – a tiny bridge:
//   Settings → Notifications can show that the app handles notifications
//   and switch them on or off; the text menu of the editor gets spelling
//   suggestions (from the spell checker here, nothing leaves the page) and
//   can add a word to the dictionary; the page menu can open a page of the
//   instance in a window of its own. Nothing else: the web app runs without
//   extra rights, and other sites (an identity provider, links) get no bridge.
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
    },
    capture: {
      info: () => ipcRenderer.invoke("flowplan:capture-info"),
      save: (text, task) => ipcRenderer.invoke("flowplan:capture-save", { text: String(text), task: task === true }),
      close: () => ipcRenderer.invoke("flowplan:capture-close"),
    },
    update: {
      state: () => ipcRenderer.invoke("flowplan:update-state"),
      act: (id) => ipcRenderer.invoke("flowplan:update-action", String(id)),
      onState: (callback) => void ipcRenderer.on("flowplan:update-state", (_event, view) => callback(view)),
    },
  });
else if (instance && (location.protocol === "https:" || location.protocol === "http:") && location.origin === instance) {
  contextBridge.exposeInMainWorld("FlowplanDesktop", {
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
  });
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
