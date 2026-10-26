// Quick capture from anywhere: a global shortcut (Ctrl+Shift+Space, ⇧⌘Space
// on macOS; changed or switched off in the settings) opens a small window
// above every other app – also while Flowplan's window is hidden or closed.
// Enter saves, Shift+Enter starts a new line, Esc closes (the text stays as
// a draft). Around that:
//
// - where it goes: the inbox (default), a database, today's journal entry or
//   a page – Tab to the picker, ↑↓, typing filters; recently used first,
//   remembered per profile (capture-targets.js);
// - shorthand: "morgen 15 Uhr #kunde @anna !hoch" as chips under the text,
//   read by the instance (POST /api/capture/preview), each removable;
// - the clipboard (Mod+Shift+V), a link with its title from the instance's
//   own link preview; files dropped on the window; a screen region
//   (screen-capture.js); a voice note held to talk (transcribed by the
//   instance, or attached);
// - an optional AI suggestion (the instance's AI, or Apple's model on a
//   Mac) as chips to accept or ignore;
// - without a connection the capture waits in an encrypted queue and is sent
//   later, with an Idempotency-Key, so nothing arrives twice
//   (capture-queue.js, capture-store.js);
// - after saving: "Öffnen" and "Rückgängig" (ten seconds), and "Zuletzt
//   erfasst" (capture-history.js);
// - quick actions: more shortcuts that open the window preset
//   (capture-actions.js).
//
// It saves with the active profile's own session through instance-api.js.
// A shortcut another app already holds cannot be registered: the settings
// page, the menu and a notification say so. messageFor() turns what went
// wrong into words – plain, for test/features.mjs.
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { shortcutLabel } = require("./settings");
const { captureCommand, localDay, pageAddress } = require("./instance-api");
const targetRules = require("./capture-targets");
const queueRules = require("./capture-queue");
const historyRules = require("./capture-history");
const actionRules = require("./capture-actions");

const MAX_AUDIO_BYTES = 25 * 1024 * 1024;
const MAX_ATTACHMENTS = 10;
const AUDIO_TYPES = /^audio\/(webm|ogg|mp4|mpeg|wav)(;.*)?$/;
const PARTITION = "flowplan-capture";

// An ApiError (instance-api.js) → a message for the capture window.
function messageFor(error, { t, host = "" }) {
  switch (error && error.kind) {
    case "offline":
      return t("capture.offline", host);
    case "signed-out":
      return t("capture.signedOut", host);
    case "no-inbox":
      return t("capture.noInbox");
    case "no-profile":
      return t("capture.noProfile");
    case "empty":
      return t("capture.empty");
    case "too-long":
    case "too-large":
      return t("capture.tooLong");
    case "queue-full":
      return t("capture.queueFull");
    case "screen-permission":
      return t("capture.screenPermission");
    case "screen-unavailable":
      return t("capture.screenUnavailable");
    case "rejected":
      return error.detail || t("capture.failed");
    default:
      return t("capture.failed");
  }
}
// The link on the clipboard: one http(s) address and nothing else.
function clipboardLink(value) {
  const text = String(value || "").trim();
  if (!text || text.length > 2000 || /\s/.test(text)) return null;
  try {
    const url = new URL(text);
    return (url.protocol === "https:" || url.protocol === "http:") && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}
// A recording from the page: its type and that it looks like one.
function audioOk(bytes, type) {
  if (!AUDIO_TYPES.test(String(type)) || !bytes || bytes.length < 16 || bytes.length > MAX_AUDIO_BYTES) return false;
  const head = Buffer.from(bytes.subarray(0, 12));
  return head.readUInt32BE(0) === 0x1a45dfa3 || head.toString("latin1", 0, 4) === "OggS" || head.toString("latin1", 4, 8) === "ftyp" || head.toString("latin1", 0, 4) === "RIFF";
}
// What the window sends to save, checked: only known fields of known types.
function cleanInput(input) {
  const list = (value, max, check) => (Array.isArray(value) ? value.filter(check).slice(0, max) : []);
  const link = input?.link && typeof input.link === "object" ? input.link : null;
  const url = link ? clipboardLink(link.url) : null;
  const cells = input?.cells && typeof input.cells === "object" && !Array.isArray(input.cells) ? input.cells : {};
  return {
    text: typeof input?.text === "string" ? input.text.slice(0, 20_000) : "",
    task: input?.task === true,
    targetId: targetRules.isTargetId(input?.targetId) ? input.targetId : "inbox",
    literal: list(input?.literal, 50, (v) => typeof v === "string" && v.length <= 300),
    attachments: list(input?.attachments, MAX_ATTACHMENTS, (v) => typeof v === "string" && /^[0-9a-f-]{36}$/.test(v)),
    templateId: typeof input?.templateId === "string" && /^[0-9a-f-]{36}$/.test(input.templateId) ? input.templateId : undefined,
    cells: Object.fromEntries(Object.entries(cells).slice(0, 30).filter(([k, v]) => k.length <= 200 && JSON.stringify(v ?? null).length <= 2000)),
    link: url
      ? {
          url,
          title: typeof link.title === "string" ? link.title.slice(0, 300) : "",
          description: typeof link.description === "string" ? link.description.slice(0, 500) : "",
          provider: typeof link.provider === "string" ? link.provider.slice(0, 100) : "",
          image: typeof link.image === "string" && /^https:\/\//.test(link.image) ? link.image.slice(0, 2000) : "",
        }
      : null,
  };
}

// deps: t, locale(), preload, settings(), activeProfile(), profileById(id),
// api(profile), isOnline(), notify(title, body), decorate(window),
// store (capture-store.js), open(profileId, url), changed() (tray, menu),
// readConfig(), writeConfig(patch), deviceAi() (or null), screen
// (screen-capture.js), inspectFile(path), fileRules (files.js),
// prepareSession(ses) (spell checker), isOwnPage(url).
function setupCapture(deps) {
  const { app, BrowserWindow, globalShortcut, nativeTheme, screen, session, clipboard, net, powerMonitor, systemPreferences } = require("electron");
  const fs = require("node:fs");
  let window = null;
  let registered = null;
  let status = "off";
  // Quick actions: id → { accelerator, status }.
  let actionShortcuts = new Map();
  // While saving, recording or picking a screen region, a click elsewhere
  // does not put the window away.
  let busy = 0;
  let preset = null;
  // Files, screenshots and recordings of the capture being written.
  const attachments = new Map();
  // Per profile: { queue, history } (capture-store.js), loaded once.
  const data = new Map();
  // Per profile: the target list and when it was read.
  const targetCache = new Map();
  let draining = false;
  let wasOnline = true;
  let timer = null;

  // ---- Queue and history, per profile ----
  function load(profileId) {
    if (!data.has(profileId)) data.set(profileId, deps.store.load(profileId));
    return data.get(profileId);
  }
  function persist(profileId) {
    try {
      deps.store.save(profileId, load(profileId));
    } catch (e) {
      console.warn(`capture store: ${e.message}`);
    }
    send("flowplan:capture-state", stateFor(deps.activeProfile()));
    deps.changed?.();
  }
  function stateFor(profile) {
    if (!profile) return { queue: { waiting: 0, failed: 0 }, history: [] };
    const own = load(profile.id);
    return { queue: queueRules.summary(own.queue), history: historyRules.visible(own.history).map(publicEntry), encrypted: deps.store.encrypted() };
  }
  const publicEntry = (e) => ({ id: e.id, title: e.title, target: e.target, at: e.at, queued: !!e.queued, open: !!e.url, undo: historyRules.canUndo(e) });
  function send(channel, value) {
    if (window && !window.isDestroyed() && !window.webContents.isLoading()) window.webContents.send(channel, value);
  }

  // ---- The window ----
  function captureSession() {
    const ses = session.fromPartition(PARTITION);
    if (!ses.flowplanPrepared) {
      ses.flowplanPrepared = true;
      deps.prepareSession?.(ses);
      // The microphone alone for its own page (voice notes); nothing else.
      const allowed = (wc, permission, details) => require("./guards").capturePermissionAllowed(permission, details, !!window && wc === window.webContents && deps.isOwnPage(wc.getURL()));
      ses.setPermissionRequestHandler((wc, permission, done, details) => done(allowed(wc, permission, details)));
      ses.setPermissionCheckHandler((wc, permission, _origin, details) => !!wc && allowed(wc, permission, { mediaTypes: details?.mediaType ? [details.mediaType] : ["audio"] }));
    }
    return ses;
  }
  function create() {
    window = new BrowserWindow({
      width: 620,
      height: 420,
      frame: false,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      show: false,
      title: deps.t("capture.title"),
      backgroundColor: nativeTheme.shouldUseDarkColors ? "#1f1e25" : "#ffffff",
      webPreferences: { preload: deps.preload, contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: true, session: captureSession() },
    });
    window.setAlwaysOnTop(true, "floating");
    if (process.platform === "darwin") window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    // Only its own page: nothing navigates or opens from here.
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    window.webContents.on("will-navigate", (event) => event.preventDefault());
    // Clicking elsewhere puts it away; the draft stays in the page.
    window.on("blur", () => {
      if (!busy) hide();
    });
    window.on("closed", () => (window = null));
    deps.decorate?.(window);
    void window.loadFile(path.join(__dirname, "pages", "capture.html"), { query: { lang: deps.locale(), platform: process.platform } });
  }
  // On the screen with the pointer, in its upper third.
  function place() {
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const area = display.workArea;
    const [width] = window.getSize();
    window.setPosition(Math.round(area.x + (area.width - width) / 2), Math.round(area.y + area.height / 5));
  }
  function show(withPreset = null) {
    if (!window || window.isDestroyed()) create();
    preset = withPreset;
    place();
    const reveal = () => {
      if (process.platform === "darwin") app.focus({ steal: true });
      window.show();
      window.focus();
      window.webContents.focus();
      send("flowplan:capture-preset", preset);
      app.emit("flowplan-capture-shown", window);
    };
    if (window.webContents.isLoading()) window.webContents.once("did-finish-load", reveal);
    else reveal();
  }
  function hide() {
    if (!window || window.isDestroyed() || !window.isVisible()) return;
    window.hide();
    // macOS: back to the app that was in front, unless Flowplan's own window is.
    if (process.platform === "darwin" && !BrowserWindow.getAllWindows().some((w) => w !== window && w.isVisible() && !w.isMinimized())) app.hide();
  }
  async function whileBusy(fn) {
    busy++;
    try {
      return await fn();
    } finally {
      busy--;
    }
  }

  // ---- Shortcuts ----
  // The shortcut from the settings; a taken one is reported, not forced.
  function register(accelerator = deps.settings().captureShortcut) {
    if (registered) {
      try {
        globalShortcut.unregister(registered);
      } catch {}
      registered = null;
    }
    if (!accelerator) {
      status = "off";
    } else {
      let ok = false;
      try {
        ok = globalShortcut.register(accelerator, () => show());
      } catch {
        ok = false;
      }
      status = ok ? "ok" : "conflict";
      if (ok) registered = accelerator;
    }
    app.emit("flowplan-shortcut", { status, accelerator });
    return status;
  }
  // A new shortcut from the settings page: kept only when it could be
  // registered; otherwise the previous one stays.
  function trySet(accelerator) {
    const previous = registered;
    const result = register(accelerator);
    if (result === "conflict" && previous) register(previous);
    return result === "conflict" ? "conflict" : result;
  }
  // Quick actions: each with its shortcut; a taken one is reported per action.
  function registerActions(actions = deps.settings().captureActions) {
    for (const [, entry] of actionShortcuts)
      if (entry.status === "ok")
        try {
          globalShortcut.unregister(entry.accelerator);
        } catch {}
    actionShortcuts = new Map();
    for (const action of actions) {
      if (!action.shortcut || actionRules.problemOf(action)) {
        actionShortcuts.set(action.id, { accelerator: action.shortcut, status: action.shortcut ? "incomplete" : "off" });
        continue;
      }
      let ok = false;
      try {
        ok = globalShortcut.register(action.shortcut, () => show(actionRules.presetFor(action)));
      } catch {
        ok = false;
      }
      actionShortcuts.set(action.id, { accelerator: action.shortcut, status: ok ? "ok" : "conflict" });
    }
    app.emit("flowplan-action-shortcuts", Object.fromEntries(actionShortcuts));
    return Object.fromEntries([...actionShortcuts].map(([id, e]) => [id, e.status]));
  }

  // ---- Targets ----
  const profileOr = () => {
    const profile = deps.activeProfile();
    if (!profile) throw Object.assign(new Error("no-profile"), { kind: "no-profile" });
    return profile;
  };
  // The list from the instance (kept five minutes); offline the last one.
  async function targetsFor(profile, { refresh = false } = {}) {
    const cached = targetCache.get(profile.id);
    if (cached && !refresh && Date.now() - cached.at < 5 * 60_000) return cached;
    if (!deps.isOnline() && cached) return cached;
    try {
      const raw = await deps.api(profile).captureTargets();
      const entry = raw
        ? { at: Date.now(), legacy: false, list: targetRules.normalizeTargets(raw) }
        : { at: Date.now(), legacy: true, list: targetRules.normalizeTargets({ inbox: await deps.api(profile).inbox().then((i) => ({ id: i.pageId, name: i.title })).catch(() => null), targets: [] }) };
      targetCache.set(profile.id, entry);
      return entry;
    } catch (e) {
      if (cached) return cached;
      return { at: 0, legacy: false, offline: true, error: e.kind, list: targetRules.normalizeTargets({}) };
    }
  }
  const recent = (profile) => targetRules.recentOf(deps.readConfig().captureRecent, profile.id);
  async function info({ refresh = false } = {}) {
    const profile = deps.activeProfile();
    const base = { profile: profile ? profile.name : "", host: profile ? new URL(profile.server).host : "", shortcut: registered ? shortcutLabel(registered) : "", platform: process.platform, preset };
    if (!profile) return { ...base, targets: [], target: "inbox", ...stateFor(null) };
    const entry = await targetsFor(profile, { refresh });
    const ordered = targetRules.orderTargets(entry.list, recent(profile));
    const target = preset?.target && ordered.some((t) => t.id === preset.target) ? preset.target : targetRules.initialTarget(ordered, recent(profile));
    return {
      ...base,
      targets: ordered,
      target,
      legacy: entry.legacy,
      offline: !!entry.offline || !deps.isOnline(),
      voice: entry.list.voice,
      suggest: entry.list.suggest ? { ...entry.list.suggest, device: entry.list.suggest.device && !!deps.deviceAi?.() } : null,
      encryptedExcluded: entry.list.encryptedExcluded,
      ...stateFor(profile),
    };
  }

  // ---- Shorthand ----
  async function preview(input) {
    const profile = profileOr();
    const entry = targetCache.get(profile.id);
    if (!deps.isOnline() || entry?.legacy) return null;
    const clean = cleanInput(input);
    try {
      return await deps.api(profile).capturePreview({ targetId: clean.targetId, text: clean.text, today: localDay(), literal: clean.literal, task: clean.task, locale: deps.locale() });
    } catch {
      return null;
    }
  }

  // ---- Attachments ----
  function addAttachment(file) {
    if (attachments.size >= MAX_ATTACHMENTS) throw Object.assign(new Error("too-many"), { kind: "rejected", detail: deps.t("capture.tooManyFiles", MAX_ATTACHMENTS) });
    const id = randomUUID();
    attachments.set(id, { id, ...file });
    return { id, name: file.name, type: file.type, size: file.bytes.length, kind: file.kind };
  }
  function dropFiles(paths) {
    const added = [];
    const refused = [];
    for (const file of deps.fileRules.droppedPaths(paths)) {
      const checked = deps.inspectFile(file);
      if (checked.error) {
        refused.push({ name: checked.name, reason: deps.t(`files.refused.${checked.error}`) });
        continue;
      }
      try {
        added.push(addAttachment({ name: checked.name, type: checked.mime, kind: checked.kind, bytes: fs.readFileSync(checked.path) }));
      } catch (e) {
        refused.push({ name: checked.name, reason: e.detail || deps.t("files.refused.missing") });
      }
    }
    return { added, refused };
  }
  // "Anhängen …": the same files as a drop, chosen in the system's dialog.
  async function pickFiles() {
    const { dialog } = require("electron");
    return whileBusy(async () => {
      const result = await dialog.showOpenDialog(window, {
        properties: ["openFile", "multiSelections"],
        filters: [{ name: deps.t("capture.attachFilter"), extensions: ["png", "jpg", "jpeg", "gif", "webp", "avif", "heic", "pdf", "md", "markdown", "txt"] }],
      });
      if (result.canceled) return { added: [], refused: [] };
      return dropFiles(result.filePaths);
    });
  }
  async function screenRegion() {
    return whileBusy(async () => {
      // The window steps aside while the region is chosen.
      const wasVisible = window && window.isVisible();
      if (wasVisible) window.hide();
      try {
        const shot = await deps.screen.capture();
        return shot ? { added: addAttachment({ ...shot, kind: "image" }) } : { cancelled: true };
      } catch (e) {
        return { error: messageFor(e, { t: deps.t }), permission: e.kind === "screen-permission" };
      } finally {
        if (wasVisible && window && !window.isDestroyed()) {
          window.show();
          window.focus();
        }
      }
    });
  }
  async function microphone() {
    if (process.platform !== "darwin") return { granted: true };
    const current = systemPreferences.getMediaAccessStatus("microphone");
    if (current === "granted") return { granted: true };
    if (current === "not-determined") return whileBusy(async () => ({ granted: await systemPreferences.askForMediaAccess("microphone") }));
    return { granted: false };
  }
  // A voice note: the instance's transcript becomes the text; without a
  // service, offline or when it fails, the recording is attached (and the
  // instance tries again when it is sent).
  async function addAudio(bytes, type, targetId) {
    const buffer = Buffer.from(bytes || []);
    if (!audioOk(buffer, type)) throw new Error(deps.t("capture.voiceFailed"));
    const profile = profileOr();
    const entry = await targetsFor(profile);
    const kind = String(type).split("/")[1].split(";")[0];
    const file = { name: `${deps.t("capture.voiceName")}.${kind === "mp4" ? "m4a" : kind}`, type: String(type).split(";")[0], bytes: buffer, kind: "audio" };
    const ordered = targetRules.orderTargets(entry.list, []);
    const pageId = targetRules.pageOf(ordered, targetRules.isTargetId(targetId) ? targetId : "inbox");
    if (deps.isOnline() && entry.list.voice && pageId) {
      try {
        const { text } = await deps.api(profile).transcribe(pageId, file);
        if (text.trim()) return { transcript: text.trim() };
      } catch {}
    }
    return { added: addAttachment({ ...file, transcribe: true }), queuedTranscript: !!entry.list.voice || !deps.isOnline() };
  }

  // ---- Clipboard and links ----
  async function fromClipboard() {
    // Electron's clipboard answers asynchronously (like navigator.clipboard).
    const text = String((await clipboard.readText()) ?? "").slice(0, 20_000);
    const url = clipboardLink(text);
    if (!url) return { text };
    return { text: "", link: await linkPreview(url) };
  }
  async function linkPreview(raw) {
    const url = clipboardLink(raw);
    if (!url) return null;
    const profile = deps.activeProfile();
    if (!profile || !deps.isOnline()) return { url, title: "", description: "", provider: new URL(url).hostname, image: "" };
    try {
      return await deps.api(profile).linkPreview(url);
    } catch {
      return { url, title: "", description: "", provider: new URL(url).hostname, image: "" };
    }
  }

  // ---- AI suggestion ----
  async function suggest(input) {
    const profile = profileOr();
    const entry = await targetsFor(profile);
    const mode = entry.list.suggest;
    if (!mode) throw new Error(deps.t("capture.suggestOff"));
    const text = typeof input?.text === "string" ? input.text.slice(0, 4000) : "";
    if (text.trim().length < 3) throw new Error(deps.t("capture.empty"));
    const targets = entry.list.targets.filter((t) => t.kind === "database").map((t) => t.id);
    const api = deps.api(profile);
    const device = mode.device ? deps.deviceAi?.() : null;
    return whileBusy(async () => {
      if (device && (mode.prefer === "device" || !mode.server)) {
        try {
          const { device: prompt } = await api.captureSuggest({ text, today: localDay(), targets, device: true });
          const answer = await device.generate({ id: `capture-${randomUUID()}`, ...prompt }, { owner: "capture" });
          const checked = await api.captureCheck({ answer: answer.json, targets });
          return { ...checked.suggestion, source: "device" };
        } catch (e) {
          if (!mode.server) throw new Error(deps.t("capture.suggestFailed"));
        }
      }
      try {
        const checked = await api.captureSuggest({ text, today: localDay(), targets });
        return { ...checked.suggestion, source: "server" };
      } catch (e) {
        throw new Error(e.detail || deps.t("capture.suggestFailed"));
      }
    });
  }

  // ---- Saving ----
  function payloadOf(input, profile) {
    const fields = {
      targetId: input.targetId,
      text: input.text,
      parse: true,
      literal: input.literal,
      task: input.task,
      today: localDay(),
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
      locale: deps.locale(),
      ...(input.templateId ? { templateId: input.templateId } : {}),
      ...(Object.keys(input.cells).length ? { cells: input.cells } : {}),
      ...(input.link
        ? { url: input.link.url, linkTitle: input.link.title || undefined, linkDescription: input.link.description || undefined, linkProvider: input.link.provider || undefined, linkImage: input.link.image || undefined }
        : {}),
    };
    const files = input.attachments.map((id) => attachments.get(id)).filter(Boolean);
    if (files.some((f) => f.transcribe)) fields.transcribe = true;
    for (const key of Object.keys(fields)) if (fields[key] === undefined) delete fields[key];
    return { fields, files: files.map((f) => ({ name: f.name, type: f.type, data: f.bytes.toString("base64") })), profileId: profile.id };
  }
  // One queued item to the instance: the new endpoint, or capture.record of
  // an older instance (its inbox looked up when it is sent).
  async function sendItem(profile, item) {
    const api = deps.api(profile);
    if (item.payload.legacy) {
      const inbox = await api.inbox();
      const { user } = await api.bootstrap();
      const command = captureCommand({ text: item.payload.text, task: item.payload.task }, { pageId: inbox.pageId, rowId: item.payload.rowId, today: item.payload.today, user });
      const result = await api.request("/api/command", { method: "POST", json: command, key: item.key });
      return { kind: "record", pageId: inbox.pageId, rowId: result?.rowId || command.rowId, title: command.title, target: inbox.title };
    }
    return api.captureSave(item);
  }
  // The answer → the history entry's place and undo.
  function placeOf(profile, result) {
    const url = pageAddress(profile.server, result.pageId, result.rowId);
    const undo = result.kind === "record" && result.rowId ? { kind: "record", pageId: result.pageId, rowId: result.rowId } : result.kind === "append" && result.undo ? { kind: "append", pageId: result.pageId, ...result.undo } : null;
    return { url, undo };
  }
  async function save(raw) {
    const profile = profileOr();
    const host = new URL(profile.server).host;
    const input = cleanInput(raw);
    const entry = await targetsFor(profile);
    const ordered = targetRules.orderTargets(entry.list, recent(profile));
    const target = ordered.find((t) => t.id === input.targetId) || ordered[0];
    if (!input.text.trim() && !input.link && !input.attachments.length) throw new Error(deps.t("capture.empty"));
    if (entry.legacy && (input.attachments.length || input.link || input.targetId !== "inbox")) throw new Error(deps.t("capture.legacy"));
    const payload = entry.legacy
      ? { legacy: true, text: input.text, task: input.task, today: localDay(), rowId: randomUUID() }
      : payloadOf(input, profile);
    const title = input.text.trim().split("\n")[0].slice(0, 120) || input.link?.title || input.link?.url || deps.t("capture.attachmentsOnly");
    const targetName = target ? (target.id === "inbox" ? target.name || deps.t("capture.inbox") : target.name) : deps.t("capture.inbox");
    const item = queueRules.newItem(payload, { profileId: profile.id, title, target: targetName });
    deps.writeConfig({ captureRecent: targetRules.rememberTarget(deps.readConfig().captureRecent, profile.id, input.targetId) });
    deps.used?.();
    const own = load(profile.id);
    const finish = () => {
      for (const id of input.attachments) attachments.delete(id);
    };
    const enqueueIt = () => {
      own.queue = queueRules.enqueue(own.queue, { ...item, attempts: 1, nextAt: Date.now() + queueRules.backoff(1) });
      own.history = historyRules.addEntry(own.history, { id: item.id, title, target: targetName, at: item.createdAt, queued: true });
      persist(profile.id);
      finish();
      ensureTimer();
      app.emit("flowplan-capture-queued", { profile: profile.id, id: item.id, key: item.key });
      setTimeout(hide, 1400);
      return { ok: true, queued: true, message: deps.t("capture.queued", host), entry: publicEntry(own.history[0]) };
    };
    if (!deps.isOnline()) return enqueueIt();
    return whileBusy(async () => {
      let result;
      try {
        result = await sendItem(profile, item);
      } catch (e) {
        // Not reachable (or the answer got lost): queued with the same key.
        if (queueRules.retryable(e) && e.kind !== "signed-out") return enqueueIt();
        const message = messageFor(e, { t: deps.t, host });
        if (window && !window.isVisible()) deps.notify?.(deps.t("capture.title"), message);
        throw new Error(message);
      }
      const place = placeOf(profile, result);
      own.history = historyRules.addEntry(own.history, { id: item.id, title: result.title || title, target: result.target || targetName, at: Date.now(), ...place });
      persist(profile.id);
      finish();
      deps.saved?.({ profile, result });
      app.emit("flowplan-captured", { profile: profile.id, ...result });
      return { ok: true, message: deps.t(input.task ? "capture.savedTask" : "capture.saved", result.target || targetName), entry: publicEntry(own.history[0]) };
    });
  }

  // ---- The queue: sent when the connection is back ----
  async function drainAll() {
    if (draining || !deps.isOnline()) return;
    draining = true;
    try {
      for (const profileId of [...data.keys()]) {
        const profile = deps.profileById(profileId);
        const own = load(profileId);
        if (!profile || !own.queue.length) continue;
        const { queue, sent } = await queueRules.drain(own.queue, (item) => sendItem(profile, item), {
          onSent: (item, result) => {
            own.history = historyRules.settle(own.history, item.id, placeOf(profile, result));
            app.emit("flowplan-capture-sent", { profile: profileId, id: item.id, key: item.key, result });
          },
        });
        own.queue = queue;
        if (sent.length) {
          deps.saved?.({ profile, result: sent.at(-1).result });
          if (!window || !window.isVisible()) deps.notify?.(deps.t("capture.title"), deps.t("capture.queueSent", sent.length));
        }
        persist(profileId);
      }
    } finally {
      draining = false;
    }
  }
  function ensureTimer() {
    if (timer) return;
    timer = setInterval(() => {
      const online = deps.isOnline();
      // Back online: everything waiting is due now.
      if (online && !wasOnline) for (const [id, own] of data) if (own.queue.length) ((own.queue = queueRules.wakeUp(own.queue)), persist(id));
      wasOnline = online;
      const waiting = [...data.values()].some((own) => own.queue.some((i) => !i.failed));
      if (!waiting) {
        clearInterval(timer);
        timer = null;
        return;
      }
      if (online && [...data.values()].some((own) => queueRules.dueItems(own.queue).length)) void drainAll();
    }, Number(process.env.FLOWPLAN_CAPTURE_TICK) || 5_000);
  }
  function wake() {
    for (const [id, own] of data) if (own.queue.length) ((own.queue = queueRules.wakeUp(own.queue)), persist(id));
    void drainAll();
  }
  powerMonitor.on("resume", wake);
  powerMonitor.on("unlock-screen", wake);

  // ---- After saving ----
  function findEntry(profile, id) {
    return load(profile.id).history.find((e) => e.id === id);
  }
  async function undo(id) {
    const profile = profileOr();
    const own = load(profile.id);
    const entry = findEntry(profile, String(id));
    if (!historyRules.canUndo(entry)) throw new Error(deps.t("capture.undoTooLate"));
    if (entry.queued) {
      own.queue = queueRules.remove(own.queue, entry.id);
      own.history = historyRules.markUndone(own.history, entry.id);
      persist(profile.id);
      return { ok: true, message: deps.t("capture.undone") };
    }
    const answer = await deps.api(profile).captureUndo(entry.undo);
    if (!answer.undone) throw new Error(deps.t("capture.undoChanged"));
    own.history = historyRules.markUndone(own.history, entry.id);
    persist(profile.id);
    deps.saved?.({ profile });
    app.emit("flowplan-capture-undone", { profile: profile.id, id: entry.id });
    return { ok: true, message: deps.t("capture.undone") };
  }
  function open(id) {
    const profile = profileOr();
    const entry = findEntry(profile, String(id));
    if (!entry || !entry.url) return false;
    hide();
    deps.open(profile.id, entry.url);
    return true;
  }
  // Queued captures that need attention: their text, to copy or discard.
  function attention() {
    const profile = deps.activeProfile();
    if (!profile) return [];
    return load(profile.id)
      .queue.filter((i) => i.failed)
      .map((i) => ({ id: i.id, title: i.title, text: i.payload.text ?? i.payload.fields?.text ?? "", error: i.lastError || "" }));
  }
  function discard(id) {
    const profile = profileOr();
    const own = load(profile.id);
    own.queue = queueRules.remove(own.queue, String(id));
    own.history = historyRules.markUndone(own.history, String(id));
    persist(profile.id);
    return stateFor(profile);
  }
  function retryNow() {
    wake();
    return stateFor(deps.activeProfile());
  }

  // Queues of every profile from earlier runs: sent as soon as possible.
  function start(profileIds) {
    for (const id of profileIds) if (load(id).queue.length) ensureTimer();
    wasOnline = deps.isOnline();
    setTimeout(() => void drainAll(), 1500);
  }

  return {
    show,
    hide,
    register,
    trySet,
    registerActions,
    actionStatus: () => Object.fromEntries([...actionShortcuts].map(([id, e]) => [id, e.status])),
    save,
    info,
    preview,
    dropFiles,
    pickFiles,
    screenRegion,
    microphone,
    addAudio,
    removeAttachment: (id) => attachments.delete(String(id)),
    fromClipboard,
    linkPreview,
    suggest,
    undo,
    open,
    attention,
    discard,
    retryNow,
    start,
    drain: drainAll,
    state: () => stateFor(deps.activeProfile()),
    // For the tray: the active profile's queue and recent captures.
    trayData() {
      const profile = deps.activeProfile();
      if (!profile) return { queue: { waiting: 0, failed: 0 }, history: [] };
      const own = load(profile.id);
      return { queue: queueRules.summary(own.queue), history: historyRules.visible(own.history, 8).map((e) => ({ id: e.id, title: e.title, target: e.target, at: e.at, open: !!e.url, queued: !!e.queued })) };
    },
    forgetProfile(id) {
      data.delete(id);
      targetCache.delete(id);
      try {
        deps.store.remove(id);
      } catch {}
    },
    status: () => status,
    label: () => (registered ? shortcutLabel(registered) : ""),
    window: () => window,
    dispose() {
      clearInterval(timer);
      timer = null;
      if (registered) globalShortcut.unregister(registered);
      registered = null;
    },
  };
}

module.exports = { messageFor, clipboardLink, audioOk, cleanInput, setupCapture, PARTITION };
