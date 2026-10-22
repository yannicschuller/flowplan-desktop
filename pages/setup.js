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
