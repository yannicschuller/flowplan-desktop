// Quick capture (capture.js): Enter saves into the inbox of the active
// profile, Shift+Enter starts a new line, Esc closes. The text stays until
// it is saved – also when the window is put away or saving fails.
const { t } = window.flowplanStrings;
const desktop = window.flowplanDesktop;
const text = document.getElementById("text"),
  task = document.getElementById("task"),
  status = document.getElementById("status"),
  target = document.getElementById("target");
const clean = (e) => String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, "");
let saving = false;

function say(message, kind = "") {
  status.textContent = message;
  status.className = `capture-status ${kind}`;
}
async function refresh() {
  try {
    const info = await desktop.capture.info();
    target.textContent = info.profile ? t("capture.target", info.profile) : "";
    target.title = info.host;
  } catch {}
  text.focus();
}
async function save() {
  if (saving) return;
  if (!text.value.trim()) return say(t("capture.empty"), "error");
  saving = true;
  say(t("capture.saving"));
  try {
    const result = await desktop.capture.save(text.value, task.checked);
    say(result.message, "ok");
    text.value = "";
    task.checked = false;
  } catch (e) {
    // The text stays: try again once the connection is back.
    say(clean(e), "error");
  } finally {
    saving = false;
  }
}
text.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    void save();
  }
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    event.preventDefault();
    void desktop.capture.close();
  }
});
document.getElementById("form").addEventListener("submit", (event) => {
  event.preventDefault();
  void save();
});
text.addEventListener("input", () => status.classList.contains("ok") && say(""));
// Every time the window comes back: the current profile, the cursor in the text.
window.addEventListener("focus", () => {
  if (status.classList.contains("ok")) say("");
  void refresh();
});
void refresh();
