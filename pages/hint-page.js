// The one-time quick capture hint (hint.js): "Neu: Schnell erfassen mit
// {shortcut}" – try it, open the settings or close it; any of them and it
// never comes back.
const { t } = window.flowplanStrings;
const desktop = window.flowplanDesktop;
const close = document.getElementById("close");
close.title = t("hint.close");
close.setAttribute("aria-label", t("hint.close"));
desktop.hint.info().then((info) => {
  document.getElementById("title").textContent = t("hint.title", info.shortcut || "");
});
for (const button of document.querySelectorAll("[data-action]")) button.addEventListener("click", () => desktop.hint.act(button.dataset.action));
