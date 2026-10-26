// The tray icon (Windows, Linux) or menu bar icon (macOS) – a setting, on
// by default in the macOS menu bar, off on Windows and Linux. Its menu:
// quick capture (with captures waiting for the connection and "Zuletzt
// erfasst", capture-history.js), today's tasks of the active profile (from its instance's
// "My tasks", instance-api.js), the unread notifications, open Flowplan, the
// profiles, "Restart to Update" once an update is ready, settings and quit.
// On macOS the icon is a template image (black with alpha, build/
// trayTemplate.png) that the system draws light or dark to match the menu
// bar; elsewhere the app icon.
//
// trayItems() decides what the menu holds – plain data without Electron,
// for test/features.mjs; setupTray() shows it and keeps it current.
const path = require("node:path");

// data: { tasks: {tasks, more} | null, tasksError, unread, profiles, active,
// captureLabel, updateReady, signedOut, capture: { queue, history } }
function trayItems(data, t = (key) => key) {
  const items = [];
  items.push({ id: "tray-capture", label: t("tray.capture"), accelerator: data.captureLabel || undefined, action: "capture" });
  const queue = data.capture?.queue;
  if (queue?.waiting) items.push({ id: "tray-capture-queue", label: t("tray.queued", queue.waiting), action: "send-queue" });
  if (queue?.failed) items.push({ id: "tray-capture-failed", label: t("tray.queueFailed", queue.failed), action: "capture" });
  const recent = data.capture?.history || [];
  if (recent.length)
    items.push({
      id: "tray-captured",
      label: t("tray.recent"),
      submenu: recent.slice(0, 8).map((e) => {
        const label = `${e.queued ? "⏳ " : ""}${e.title}`;
        return { id: "tray-captured-entry", label: label.length > 50 ? `${label.slice(0, 49)}…` : label, sublabel: e.target, action: "open-captured", value: e.id };
      }),
    });
  items.push({ type: "separator" });
  items.push({ id: "tray-today", label: t("tray.today"), enabled: false });
  const list = data.tasks?.tasks || [];
  if (data.tasksError) items.push({ id: "tray-tasks-error", label: t(data.tasksError === "signed-out" ? "tray.signedOut" : "tray.tasksUnavailable"), enabled: false });
  else if (!data.tasks) items.push({ id: "tray-tasks-loading", label: t("tray.loading"), enabled: false });
  else if (!list.length) items.push({ id: "tray-no-tasks", label: t("tray.noTasks"), enabled: false });
  for (const task of list) {
    const label = `${task.overdue ? "⚠ " : "☐ "}${task.text}`;
    items.push({ id: "tray-task", label: label.length > 60 ? `${label.slice(0, 59)}…` : label, sublabel: task.page, action: "open-task", value: task });
  }
  if (data.tasks?.more) items.push({ id: "tray-more-tasks", label: t("tray.moreTasks", data.tasks.more), action: "open-tasks" });
  items.push({ type: "separator" });
  items.push({ id: "tray-inbox", label: data.unread ? t("tray.unread", data.unread) : t("tray.noUnread"), action: "open-inbox" });
  items.push({ id: "tray-open", label: t("tray.open"), action: "open" });
  if (data.profiles && data.profiles.length > 1)
    items.push({
      id: "tray-profiles",
      label: t("menu.profiles"),
      submenu: data.profiles.map((p) => ({ id: `tray-profile-${p.id}`, label: p.label, type: "radio", checked: p.id === data.active, action: "profile", value: p.id })),
    });
  items.push({ type: "separator" });
  if (data.updateReady) items.push({ id: "tray-update", label: t("menu.restartToUpdate", data.updateReady), action: "update" });
  items.push({ id: "tray-settings", label: t("menu.settings"), action: "settings" });
  items.push({ id: "tray-quit", label: t("menu.quit"), action: "quit" });
  return items;
}

// deps: t, data() → the menu's data without tasks, loadTasks() → promise of
// {tasks, more}, actions: { capture, openTask(task), openTasks, openInbox,
// open, profile(id), update, settings, quit }, changedEvent (app event to
// refresh on).
function setupTray(deps) {
  const { Tray, Menu, nativeImage, app } = require("electron");
  let tray = null;
  let tasks = null;
  let tasksError = null;
  let timer = null;
  let loading = false;
  let loadedAt = 0;

  function icon() {
    if (process.platform === "darwin") {
      const image = nativeImage.createFromPath(path.join(__dirname, "build", "trayTemplate.png"));
      image.setTemplateImage(true);
      return image;
    }
    const size = process.platform === "win32" ? 16 : 24;
    return nativeImage.createFromPath(path.join(__dirname, "build", "icon.png")).resize({ width: size, height: size, quality: "best" });
  }
  function build() {
    if (!tray) return;
    const items = trayItems({ ...deps.data(), tasks, tasksError }, deps.t);
    const run = (item) => {
      const a = deps.actions;
      switch (item.action) {
        case "capture":
          return a.capture();
        case "open-task":
          return a.openTask(item.value);
        case "open-tasks":
          return a.openTasks();
        case "open-inbox":
          return a.openInbox();
        case "open":
          return a.open();
        case "profile":
          return a.profile(item.value);
        case "update":
          return a.update();
        case "settings":
          return a.settings();
        case "quit":
          return a.quit();
        case "open-captured":
          return a.openCaptured(item.value);
        case "send-queue":
          return a.sendQueue();
      }
    };
    const native = (item) => {
      if (item.type === "separator") return { type: "separator" };
      const entry = { label: item.label, enabled: item.enabled !== false };
      if (item.id) entry.id = item.id;
      if (item.sublabel) entry.sublabel = item.sublabel;
      if (item.type) entry.type = item.type;
      if (item.checked !== undefined) entry.checked = item.checked;
      if (item.accelerator) {
        entry.accelerator = item.accelerator;
        entry.registerAccelerator = false;
      }
      if (item.submenu) entry.submenu = item.submenu.map(native);
      else if (item.action) entry.click = () => run(item);
      return entry;
    };
    tray.setContextMenu(Menu.buildFromTemplate(items.map(native)));
    const unread = deps.data().unread;
    tray.setToolTip(unread ? `Flowplan – ${deps.t("tray.unread", unread)}` : "Flowplan");
    // For test/app.mjs.
    app.emit("flowplan-tray", items);
  }
  async function loadTasks() {
    if (!tray || loading) return;
    loading = true;
    try {
      tasks = await deps.loadTasks();
      tasksError = null;
      loadedAt = Date.now();
    } catch (e) {
      tasksError = e?.kind || "error";
      if (tasksError === "no-profile") tasksError = "error";
    } finally {
      loading = false;
    }
    build();
  }
  function start() {
    if (tray) return;
    tray = new Tray(icon());
    // Windows and Linux: a click opens the window, the menu is on right-click.
    if (process.platform !== "darwin") tray.on("click", () => deps.actions.open());
    build();
    void loadTasks();
    // Today's tasks every five minutes (and on every change of the app).
    timer = setInterval(() => void loadTasks(), 5 * 60_000);
  }
  function stop() {
    clearInterval(timer);
    timer = null;
    if (tray) tray.destroy();
    tray = null;
    tasks = null;
    tasksError = null;
  }
  return {
    // On or off, as the setting says.
    apply(on) {
      if (on) start();
      else stop();
    },
    // The menu again (profiles, unread count, update); with reload, the
    // tasks too (another profile, something captured).
    // With reload "soft" (a window came to the front) only when the tasks
    // are older than a minute or could not be read.
    refresh({ reload = false } = {}) {
      if (!tray) return;
      if (reload === "soft") reload = !!tasksError || Date.now() - loadedAt > 60_000;
      if (reload) {
        tasks = null;
        tasksError = null;
        void loadTasks();
      }
      build();
    },
    active: () => !!tray,
  };
}

module.exports = { trayItems, setupTray };
