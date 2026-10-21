const { t } = window.flowplanStrings;
const params = new URLSearchParams(location.search);
const server = params.get("server");
if (server)
  document.getElementById("detail").textContent = t("offline.detail", server, params.get("error") || t("offline.unknownError"));
document.getElementById("retry").addEventListener("click", () => window.flowplanDesktop.retry());
document.getElementById("change").addEventListener("click", () => window.flowplanDesktop.changeServer());
// Try again by itself when the connection comes back.
window.addEventListener("online", () => window.flowplanDesktop.retry());
