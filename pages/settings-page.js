// Settings (settings.js): tray icon, launch at login, the quick capture
// shortcut and its quick actions (capture-actions.js), the offline queue,
// the spell checker's languages and – on a Mac build with the helper –
// Apple Intelligence (device-ai.js, optional). Every change is saved
// at once; main.js checks it again and answers with what now holds.
const { t } = window.flowplanStrings;
const desktop = window.flowplanDesktop;
const $ = (id) => document.getElementById(id);
const error = $("error"),
  shortcut = $("shortcut"),
  status = $("shortcut-label");
const clean = (e) => String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, "");
const mac = desktop.platform === "darwin";
let current = null;
let recording = false;

// The menu bar on macOS, the notification area elsewhere.
if (mac) {
  $("tray-label").textContent = t("settings.trayMac");
}

function render(data) {
  current = data;
  const s = data.settings;
  $("tray").checked = s.tray;
  $("launchAtLogin").checked = s.launchAtLogin;
  $("startHidden").checked = s.startHidden;
  $("startHidden").disabled = !s.launchAtLogin;
  for (const box of document.querySelectorAll("#languages input")) {
    box.checked = s.spellLanguages.includes(box.value);
    // Spell checking keeps one language at least.
    box.disabled = box.checked && s.spellLanguages.length === 1;
  }
  if (!recording) shortcut.value = data.shortcutLabel || "";
  const messages = { ok: t("settings.shortcutOk"), off: t("settings.shortcutIsOff"), conflict: t("settings.shortcutTaken", data.shortcutLabel || "") };
  status.textContent = messages[data.shortcutStatus] || "";
  status.className = `small shortcut-status ${data.shortcutStatus}`;
  $("version").textContent = t("updates.version", data.version);
  // Only where the helper exists (the macOS build); the status line asks it.
  $("device-ai").hidden = !data.deviceAiSupported;
  $("deviceAi").checked = s.deviceAi;
  if (data.deviceAiSupported && s.deviceAi !== shownAi) void showAiStatus();
  renderQueue(data);
  renderActions(data);
}
// ---- The offline queue ----
function renderQueue(data) {
  const q = data.captureQueue || { waiting: 0, failed: 0 };
  $("queue-status").textContent = [q.waiting ? t("settings.queueWaiting", q.waiting) : t("settings.queueNone"), q.failed ? t("settings.queueFailed", q.failed) : ""].filter(Boolean).join(" ");
  $("queue-send").hidden = !q.waiting;
  $("queue-storage").textContent = t(data.captureEncrypted ? "settings.queueEncrypted" : "settings.queuePlain");
}
$("queue-send").addEventListener("click", async () => {
  await desktop.settings.sendQueue();
  setTimeout(async () => render(await desktop.settings.get()), 1500);
});
$("capture-try").addEventListener("click", () => desktop.settings.tryCapture());

// ---- Quick actions ----
let targets = null;
let recordingAction = null;
async function loadTargets() {
  try {
    targets = await desktop.settings.captureTargets();
  } catch {
    targets = { targets: [] };
  }
  if (current) renderActions(current);
}
const optionsFor = (kind) => {
  const list = targets?.targets || [];
  if (kind === "journal") return list.filter((x) => x.kind === "journal");
  if (kind === "template") return list.filter((x) => x.kind === "database");
  return [{ id: "inbox", name: t("capture.kind.inbox") }, ...list];
};
function saveActions(list) {
  return change({ captureActions: list });
}
function element(tag, props = {}, children = []) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}
function renderActions(data) {
  const list = data.settings.captureActions || [];
  const box = $("actions");
  if (recordingAction) return;
  $("actions-note").hidden = !!targets?.targets?.length;
  $("actions-note").textContent = t("settings.actionNeedsSignIn");
  box.replaceChildren(
    ...list.map((action, index) => {
      const update = (patch) => saveActions(list.map((a, i) => (i === index ? { ...a, ...patch } : a)));
      const name = element("input", { type: "text", value: action.name, maxLength: 40, ariaLabel: t("settings.actionName") });
      name.addEventListener("change", () => update({ name: name.value }));
      const target = element("select", { ariaLabel: t("settings.actionTarget") });
      const choices = optionsFor(action.kind);
      if (action.kind === "journal" || action.kind === "template")
        target.append(element("option", { value: "", textContent: t(action.kind === "journal" ? "settings.actionChooseJournal" : "settings.actionChooseDatabase") }));
      for (const x of choices) target.append(element("option", { value: x.id, textContent: x.space ? `${x.name} · ${x.space}` : x.name }));
      if (action.target && !choices.some((x) => x.id === action.target)) target.append(element("option", { value: action.target, textContent: "…" }));
      target.value = action.target || "";
      target.addEventListener("change", () => update({ target: target.value || null, template: null }));
      const parts = [name, target];
      if (action.kind === "template") {
        const template = element("select", { ariaLabel: t("settings.actionTemplate") });
        template.append(element("option", { value: "", textContent: t("settings.actionNoTemplate") }));
        const db = (targets?.targets || []).find((x) => x.id === action.target);
        for (const r of db?.templates || []) template.append(element("option", { value: r.id, textContent: r.name }));
        template.value = action.template || "";
        template.addEventListener("change", () => update({ template: template.value || null }));
        parts.push(template);
      }
      const shortcut = element("input", { readOnly: true, className: "action-shortcut", value: data.actionLabels?.[action.id] || "", placeholder: t("settings.shortcutPlaceholder"), ariaLabel: t("settings.shortcutPlaceholder") });
      const record = element("button", { type: "button", className: "secondary", textContent: t("settings.shortcutChange") });
      record.addEventListener("click", () => {
        recordingAction = action.id;
        shortcut.value = "";
        shortcut.classList.add("recording");
        shortcut.focus();
      });
      shortcut.addEventListener("keydown", (event) => {
        if (recordingAction !== action.id) return;
        event.preventDefault();
        if (event.key === "Escape") {
          recordingAction = null;
          return render(current);
        }
        const value = acceleratorOf(event);
        if (!value) return;
        recordingAction = null;
        void update({ shortcut: value });
      });
      shortcut.addEventListener("blur", () => {
        if (recordingAction === action.id) {
          recordingAction = null;
          render(current);
        }
      });
      const off = element("button", { type: "button", className: "secondary", textContent: t("settings.shortcutOff") });
      off.addEventListener("click", () => update({ shortcut: null }));
      const tryIt = element("button", { type: "button", className: "secondary", textContent: t("settings.captureTry") });
      tryIt.addEventListener("click", () => desktop.settings.tryCapture(action.id));
      const remove = element("button", { type: "button", className: "secondary", textContent: t("settings.actionRemove") });
      remove.addEventListener("click", () => saveActions(list.filter((_, i) => i !== index)));
      const statusKey = data.actionStatus?.[action.id] || (action.shortcut ? "ok" : "off");
      const status = element("p", { className: `small action-status ${statusKey}`, textContent: t(`settings.actionStatus.${statusKey}`) });
      const row = element("div", { className: "action-row" }, [element("div", { className: "row" }, parts), element("div", { className: "row" }, [shortcut, record, off, tryIt, remove])]);
      if (action.kind === "note" || action.kind === "bookmark") {
        const box = element("input", { type: "checkbox", checked: action.task });
        box.addEventListener("change", () => update({ task: box.checked }));
        row.append(element("label", { className: "switch" }, [box, " ", element("span", { textContent: t("settings.actionTask") })]));
      }
      row.append(status);
      row.dataset.id = action.id;
      return row;
    }),
  );
}
$("action-add").addEventListener("change", (event) => {
  const kind = event.target.value;
  event.target.value = "";
  if (!kind || !current) return;
  const list = current.settings.captureActions || [];
  const preset = {
    task: { name: t("actions.task"), target: "inbox", task: true },
    journal: { name: t("actions.journal"), target: (targets?.targets || []).find((x) => x.kind === "journal")?.id || null },
    bookmark: { name: t("actions.bookmark"), target: "inbox" },
    template: { name: t("actions.meeting"), target: null, prefix: t("actions.meetingPrefix") },
    note: { name: t("actions.note"), target: "inbox" },
  }[kind];
  const ids = new Set(list.map((a) => a.id));
  let id = kind;
  for (let n = 2; ids.has(id); n++) id = `${kind}-${n}`;
  void saveActions([...list, { id, kind, shortcut: null, ...preset }]);
});
void loadTargets();
let shownAi = null;
async function showAiStatus() {
  const line = $("device-ai-status");
  shownAi = current.settings.deviceAi;
  if (!shownAi) return void (line.textContent = t("settings.deviceAiIsOff"));
  line.textContent = t("settings.deviceAiChecking");
  try {
    const status = await desktop.settings.aiStatus();
    if (!current.settings.deviceAi) return;
    const a = status.availability || {};
    line.textContent = a.available ? t("settings.deviceAiAvailable") : t(`settings.deviceAi.${a.reason || "error"}`);
  } catch {
    line.textContent = t("settings.deviceAi.error");
  }
}
async function change(patch) {
  error.textContent = "";
  try {
    render(await desktop.settings.set(patch));
  } catch (e) {
    error.textContent = clean(e);
    if (current) render(current);
  }
}
for (const id of ["tray", "launchAtLogin", "startHidden", "deviceAi"]) $(id).addEventListener("change", (e) => change({ [id]: e.target.checked }));
for (const box of document.querySelectorAll("#languages input"))
  box.addEventListener("change", () => change({ spellLanguages: [...document.querySelectorAll("#languages input:checked")].map((b) => b.value) }));

// Recording a shortcut: the next key with at least one modifier (shortcut-keys.js).
const acceleratorOf = (event) => window.flowplanShortcut.acceleratorOf(event, mac);
function stopRecording() {
  recording = false;
  shortcut.classList.remove("recording");
  $("record").textContent = t("settings.shortcutChange");
  if (current) render(current);
}
$("record").addEventListener("click", () => {
  if (recording) return stopRecording();
  recording = true;
  shortcut.value = "";
  shortcut.classList.add("recording");
  $("record").textContent = t("settings.cancel");
  shortcut.focus();
});
shortcut.addEventListener("keydown", (event) => {
  if (!recording) return;
  event.preventDefault();
  if (event.key === "Escape") return stopRecording();
  const value = acceleratorOf(event);
  if (!value) return;
  recording = false;
  shortcut.classList.remove("recording");
  $("record").textContent = t("settings.shortcutChange");
  void change({ captureShortcut: value });
});
shortcut.addEventListener("blur", () => recording && stopRecording());
$("reset").addEventListener("click", () => change({ captureShortcut: "CommandOrControl+Shift+Space" }));
$("off").addEventListener("click", () => change({ captureShortcut: null }));
$("check").addEventListener("click", () => desktop.settings.checkUpdates());

desktop.settings.get().then(render);
