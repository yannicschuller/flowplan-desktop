// The window that waits while the browser signs in (sign-in.js): it names the
// instance and takes the flowplan://sign-in link – or just the code – by hand
// where the browser cannot hand it to the app.
const { t } = window.flowplanStrings;
const params = new URLSearchParams(location.search);
const form = document.getElementById("form"),
  input = document.getElementById("code"),
  error = document.getElementById("error"),
  submit = document.getElementById("submit");
document.getElementById("text").textContent = t("signIn.text", params.get("server") || "Flowplan");
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  error.textContent = "";
  submit.disabled = true;
  submit.textContent = t("signIn.pasting");
  try {
    await window.flowplanDesktop.pasteSignIn(input.value);
  } catch (e) {
    error.textContent = String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, "");
    submit.disabled = false;
    submit.textContent = t("signIn.paste");
    input.select();
  }
});
document.getElementById("cancel").addEventListener("click", () => window.flowplanDesktop.cancelSignIn());
