// Two bridges, each only where it belongs. The preload is attached to the
// window, so it checks where it runs; the main process checks the sender of
// every call once more (main.js, guards.js).
//
// - window.flowplanDesktop: the app's own pages (setup, profiles, offline,
//   sign-in) on file: – the profiles and the sign-in.
// - window.FlowplanDesktop: the pages of the window profile's own instance
//   (its origin comes from main.js as --flowplan-instance=…) – a tiny bridge so
//   Settings → Notifications can show that the app handles notifications and
//   switch them on or off. Nothing else: the web app runs without extra
//   rights, and other sites (an identity provider, links) get no bridge.
const { contextBridge, ipcRenderer } = require("electron");

const argument = (name) => {
  const prefix = `--${name}=`;
  const found = process.argv.find((a) => a.startsWith(prefix));
  return found ? found.slice(prefix.length) : "";
};
const instance = argument("flowplan-instance");

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
  });
else if (instance && (location.protocol === "https:" || location.protocol === "http:") && location.origin === instance)
  contextBridge.exposeInMainWorld("FlowplanDesktop", {
    platform: "desktop",
    version: argument("flowplan-version"),
    notifications: {
      enabled: () => ipcRenderer.invoke("flowplan:notifications-enabled"),
      setEnabled: (on) => ipcRenderer.invoke("flowplan:notifications-set-enabled", on === true),
      refresh: () => void ipcRenderer.invoke("flowplan:notifications-refresh").catch(() => {}),
    },
  });
