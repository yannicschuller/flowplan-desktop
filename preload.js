// Only the app's own pages (server setup, offline, sign-in) get this bridge;
// the Flowplan web app runs without extra rights. The preload is attached to
// the window, so it checks where it runs: the bridge exists only on file:
// pages – and the main process checks the sender of every call once more
// (main.js, guards.js).
const { contextBridge, ipcRenderer } = require("electron");

if (location.protocol === "file:")
  contextBridge.exposeInMainWorld("flowplanDesktop", {
    platform: process.platform,
    getServer: () => ipcRenderer.invoke("flowplan:get-server"),
    setServer: (url) => ipcRenderer.invoke("flowplan:set-server", url),
    retry: () => ipcRenderer.invoke("flowplan:retry"),
    changeServer: () => ipcRenderer.invoke("flowplan:change-server"),
    pasteSignIn: (text) => ipcRenderer.invoke("flowplan:sign-in-paste", text),
    cancelSignIn: () => ipcRenderer.invoke("flowplan:sign-in-cancel"),
  });
