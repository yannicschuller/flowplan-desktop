const { t } = window.flowplanStrings;
const params = new URLSearchParams(location.search);
const server = params.get("server");
if (server)
  document.getElementById("detail").textContent = t("offline.detail", server, params.get("error") || t("offline.unknownError"));
document.getElementById("retry").addEventListener("click", () => window.flowplanDesktop.retry());
// Another profile, or another address, from here too.
document.getElementById("profiles").addEventListener("click", () => window.flowplanDesktop.showProfiles());
// Try again by itself when the connection comes back.
window.addEventListener("online", () => window.flowplanDesktop.retry());
