// First start and "Add Profile…": the address of an instance and an optional
// name. The main process checks the address (a real Flowplan, no redirect)
// before it saves the profile and opens it in its own session.
const { t } = window.flowplanStrings;
const params = new URLSearchParams(location.search);
const form = document.getElementById("form"),
  input = document.getElementById("server"),
  name = document.getElementById("name"),
  error = document.getElementById("error"),
  submit = document.getElementById("submit"),
  cancel = document.getElementById("cancel");
const adding = params.get("add") === "1";
const preset = params.get("server");
if (adding) {
  document.title = t("setup.addTitle");
  document.getElementById("heading").textContent = t("setup.addHeading");
  document.getElementById("text").textContent = t("setup.addText");
  submit.textContent = t("setup.add");
}
window.flowplanDesktop.getProfiles().then(({ profiles }) => {
  // With profiles saved, the way back is open.
  if (profiles.length) cancel.hidden = false;
  if (!adding && !input.value) input.value = preset || "";
});
const idle = () => t(adding ? "setup.add" : "setup.connect");
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  error.textContent = "";
  submit.disabled = true;
  submit.textContent = t("setup.connecting");
  try {
    await window.flowplanDesktop.addProfile(name.value, input.value);
  } catch (e) {
    error.textContent = String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, "");
    submit.disabled = false;
    submit.textContent = idle();
  }
});
cancel.addEventListener("click", () => window.flowplanDesktop.retry());

// ---- The last step: how Flowplan runs on this computer (onboarding.js) ----
// Its switches are the settings themselves (settings.js): each change is
// saved at once and can be changed later under Settings. "Überspringen"
// keeps what is there; both end the step for good.
if (params.get("step") === "desktop") {
  const desktop = window.flowplanDesktop;
  const $ = (id) => document.getElementById(id);
  const mac = desktop.platform === "darwin";
  document.getElementById("connect").hidden = true;
  $("desktop").hidden = false;
  document.title = t("setup.desktopTitle");
  if (mac) $("tray-label").textContent = t("settings.trayMac");
  let recording = false;
  let current = null;
  const shortcutBox = $("shortcut"),
    status = $("shortcut-status"),
    error = $("desktop-error");
  function render(data) {
    current = data;
    const s = data.settings;
    $("capture").checked = !!s.captureShortcut;
    $("tray").checked = s.tray;
    $("launchAtLogin").checked = s.launchAtLogin;
    $("startHidden").checked = s.startHidden;
    // Hidden at login only with launch at login.
    $("startHidden").disabled = !s.launchAtLogin;
    if (!recording) shortcutBox.value = data.shortcutLabel || "";
    shortcutBox.disabled = $("record").disabled = $("try").disabled = !s.captureShortcut;
    const messages = { ok: t("settings.shortcutOk"), off: t("settings.shortcutIsOff"), conflict: t("settings.shortcutTaken", data.shortcutLabel || "") };
    status.textContent = messages[data.shortcutStatus] || "";
    status.className = `small shortcut-status ${data.shortcutStatus}`;
  }
  async function apply(choices) {
    error.textContent = "";
    try {
      render(await desktop.setup.apply(choices));
    } catch (e) {
      error.textContent = String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, "");
      render(await desktop.settings.get());
    }
  }
  $("capture").addEventListener("change", (e) => apply({ capture: e.target.checked }));
  $("tray").addEventListener("change", (e) => apply({ tray: e.target.checked }));
  $("launchAtLogin").addEventListener("change", (e) => apply({ launchAtLogin: e.target.checked, startHidden: e.target.checked && $("startHidden").checked }));
  $("startHidden").addEventListener("change", (e) => apply({ launchAtLogin: true, startHidden: e.target.checked }));
  $("record").addEventListener("click", () => {
    recording = !recording;
    shortcutBox.value = recording ? "" : current?.shortcutLabel || "";
    shortcutBox.classList.toggle("recording", recording);
    $("record").textContent = recording ? t("settings.cancel") : t("settings.shortcutChange");
    if (recording) shortcutBox.focus();
  });
  shortcutBox.addEventListener("keydown", async (event) => {
    if (!recording) return;
    event.preventDefault();
    if (event.key === "Escape") return $("record").click();
    const value = window.flowplanShortcut.acceleratorOf(event, mac);
    if (!value) return;
    recording = false;
    shortcutBox.classList.remove("recording");
    $("record").textContent = t("settings.shortcutChange");
    error.textContent = "";
    try {
      render(await desktop.settings.set({ captureShortcut: value }));
    } catch (e) {
      // Another app holds it: said, the previous one stays.
      status.textContent = String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, "");
      status.className = "small shortcut-status conflict";
      shortcutBox.value = current?.shortcutLabel || "";
    }
  });
  $("try").addEventListener("click", () => desktop.setup.tryCapture());
  $("done").addEventListener("click", () => desktop.setup.finish());
  $("skip").addEventListener("click", () => desktop.setup.finish());
  desktop.setup.defaults().then(render);
}
