// Settings (settings.js): tray icon, launch at login, the quick capture
// shortcut, the spell checker's languages and – on a Mac build with the
// helper – Apple Intelligence (device-ai.js, optional). Every change is saved
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
}
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

// Recording a shortcut: the next key with at least one modifier.
const KEYS = { Space: "Space", Enter: "Enter", Tab: "Tab", Backspace: "Backspace", Delete: "Delete", ArrowUp: "Up", ArrowDown: "Down", ArrowLeft: "Left", ArrowRight: "Right", Home: "Home", End: "End", PageUp: "PageUp", PageDown: "PageDown", Minus: "-", Equal: "=", Comma: ",", Period: ".", Slash: "/", Semicolon: ";", Quote: "'", BracketLeft: "[", BracketRight: "]", Backslash: "\\", Backquote: "`" };
function acceleratorOf(event) {
  let key = null;
  if (/^Key[A-Z]$/.test(event.code)) key = event.code.slice(3);
  else if (/^Digit[0-9]$/.test(event.code)) key = event.code.slice(5);
  else if (/^F([1-9]|1[0-9]|2[0-4])$/.test(event.code)) key = event.code;
  else key = KEYS[event.code] || null;
  if (!key) return null;
  const mods = [];
  if (mac ? event.metaKey : event.ctrlKey) mods.push("CommandOrControl");
  if (mac && event.ctrlKey) mods.push("Control");
  if (!mac && event.metaKey) mods.push("Super");
  if (event.altKey) mods.push("Alt");
  if (event.shiftKey) mods.push("Shift");
  if (!mods.length || (mods.length === 1 && mods[0] === "Shift")) return null;
  return [...mods, key].join("+");
}
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
