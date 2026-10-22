// "Manage Profiles…": every saved instance with its name (renamed in place),
// the active one marked, open and remove. Removing asks in the main process
// and signs that profile out on this computer.
const { t } = window.flowplanStrings;
const desktop = window.flowplanDesktop;
const list = document.getElementById("list"),
  error = document.getElementById("error"),
  back = document.getElementById("back");
const clean = (e) => String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, "");
const host = (server) => {
  try {
    return new URL(server).host;
  } catch {
    return server;
  }
};
// The shortcut as the menu shows it on this system.
document.querySelector("[data-i18n='profiles.text']").textContent = t("profiles.text", desktop.platform === "darwin" ? "⇧⌘P" : "Ctrl+Shift+P");

function button(label, kind, onClick) {
  const node = document.createElement("button");
  node.type = "button";
  node.textContent = label;
  if (kind) node.className = kind;
  node.addEventListener("click", onClick);
  return node;
}
function render({ profiles, active }) {
  list.replaceChildren();
  back.hidden = !active;
  for (const profile of profiles) {
    const item = document.createElement("li");
    item.dataset.id = profile.id;
    if (profile.id === active) item.className = "active";
    const name = document.createElement("input");
    name.value = profile.name;
    name.maxLength = 60;
    name.setAttribute("aria-label", t("profiles.nameLabel"));
    name.addEventListener("change", async () => {
      error.textContent = "";
      try {
        render(await desktop.renameProfile(profile.id, name.value));
      } catch (e) {
        error.textContent = clean(e);
      }
    });
    const address = document.createElement("div");
    address.className = "address";
    address.textContent = host(profile.server);
    const info = document.createElement("div");
    info.className = "info";
    info.append(name, address);
    const actions = document.createElement("div");
    actions.className = "actions";
    if (profile.id === active) {
      const badge = document.createElement("span");
      badge.className = "badge";
      badge.textContent = t("profiles.active");
      actions.append(badge);
    } else actions.append(button(t("profiles.open"), "", () => desktop.switchProfile(profile.id)));
    actions.append(
      button(t("profiles.remove"), "secondary danger", async () => {
        error.textContent = "";
        try {
          render(await desktop.removeProfile(profile.id));
        } catch (e) {
          error.textContent = clean(e);
        }
      }),
    );
    item.append(info, actions);
    list.append(item);
  }
}
document.getElementById("add").addEventListener("click", () => desktop.newProfile());
back.addEventListener("click", () => desktop.retry());
desktop.getProfiles().then(render);
