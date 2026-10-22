// Only the app's own pages (setup, profiles, offline, sign-in) get this
// bridge; the Flowplan web app runs without extra rights. The preload is
// attached to the window, so it checks where it runs: the bridge exists only
// on file: pages – and the main process checks the sender of every call once
// more (main.js, guards.js).
const { contextBridge, ipcRenderer } = require("electron");

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
