// The update toast in the corner of the window (updates.js): the download
// with its progress, "Restart to Update" once it is ready, the answer to a
// check from the menu. It shows what updates.js sends and never takes the
// focus by itself.
const desktop = window.flowplanDesktop;
const title = document.getElementById("title"),
  detail = document.getElementById("detail"),
  bar = document.getElementById("bar"),
  fill = document.getElementById("fill"),
  source = document.getElementById("source"),
  actions = document.getElementById("actions");

function render(view) {
  if (!view) return;
  title.textContent = view.title || "";
  detail.textContent = view.detail || "";
  source.textContent = view.source || "";
  const busy = view.busy === true;
  bar.hidden = !(typeof view.progress === "number") && !busy;
  bar.classList.toggle("busy", busy);
  fill.style.width = typeof view.progress === "number" ? `${Math.round(view.progress * 1000) / 10}%` : "";
  actions.replaceChildren(
    ...(view.actions || []).map((action) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = action.label;
      button.dataset.action = action.id;
      button.className = action.primary ? "" : "secondary";
      button.addEventListener("click", () => void desktop.update.act(action.id));
      return button;
    }),
  );
}
desktop.update.onState(render);
desktop.update.state().then(render);
