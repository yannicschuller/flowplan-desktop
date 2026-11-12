// The update toast in the corner of the window (updates.js): the download
// with its progress, "Restart to Update" once it is ready, the answer to a
// check from the menu. It shows what updates.js sends and never takes the
// focus by itself.
// "Was ist neu?" (#223) unfolds the release notes of the versions in
// between below: plain text from release-notes.js, put in as text nodes
// only – never as HTML.
const desktop = window.flowplanDesktop;
const card = document.getElementById("toast"),
  title = document.getElementById("title"),
  detail = document.getElementById("detail"),
  bar = document.getElementById("bar"),
  fill = document.getElementById("fill"),
  source = document.getElementById("source"),
  notes = document.getElementById("notes"),
  actions = document.getElementById("actions");

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = String(text);
  return node;
}
// [{ version, title, sections: [{ key, title, items }] }] → the notes list.
function renderNotes(list, heading) {
  if (!Array.isArray(list) || !list.length) {
    notes.hidden = true;
    notes.replaceChildren();
    return;
  }
  const parts = [element("h2", "notes-heading", heading || "")];
  for (const release of list) {
    const block = element("section", "notes-version");
    block.append(element("h3", "", release.title || release.version || ""));
    for (const section of release.sections || []) {
      const part = element("div", `notes-section ${/^[a-z]+$/.test(section.key) ? section.key : "other"}`);
      if (section.title) part.append(element("h4", "", section.title));
      const items = element("ul");
      for (const item of section.items || []) items.append(element("li", "", item));
      part.append(items);
      block.append(part);
    }
    parts.push(block);
  }
  notes.replaceChildren(...parts);
  notes.hidden = false;
}

function render(view) {
  if (!view) return;
  title.textContent = view.title || "";
  detail.textContent = view.detail || "";
  source.textContent = view.source || "";
  const busy = view.busy === true;
  bar.hidden = !(typeof view.progress === "number") && !busy;
  bar.classList.toggle("busy", busy);
  fill.style.width = typeof view.progress === "number" ? `${Math.round(view.progress * 1000) / 10}%` : "";
  const open = Array.isArray(view.notes) && view.notes.length > 0;
  card.classList.toggle("with-notes", open);
  renderNotes(view.notes, view.notesTitle);
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
