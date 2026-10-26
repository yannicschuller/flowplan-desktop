// Quick actions: more global shortcuts that open the capture window ready
// for one thing – "Aufgabe" (a task for today), "Journal-Eintrag" (today's
// journal), "Lesezeichen" (the link on the clipboard with its title),
// "Besprechungsnotiz" (a record from a template of a chosen database).
// Managed in the settings (add, rename, shortcut, target, template, as a
// task, remove); none is registered until the person gives it a shortcut,
// only the main capture shortcut is on by default. A shortcut another app
// (or another action) holds is reported, not taken.
//
// Stored with the other settings (settings.js, `captureActions`), checked
// here – plain functions without Electron, for test/features.mjs.
// settings.js requires this file; its isShortcut is taken when needed.
const isShortcut = (value) => require("./settings").isShortcut(value);

const MAX_ACTIONS = 8;
const KINDS = ["task", "journal", "bookmark", "template", "note"];
const ID = /^[a-z0-9-]{1,40}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const text = (value, max) => (typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max) : "");

// One action, checked; null when it makes no sense.
function cleanAction(raw) {
  if (!raw || typeof raw !== "object" || !ID.test(String(raw.id)) || !KINDS.includes(raw.kind)) return null;
  const target = raw.target === "inbox" || UUID.test(String(raw.target)) ? String(raw.target) : null;
  return {
    id: String(raw.id),
    kind: raw.kind,
    name: text(raw.name, 40) || raw.kind,
    shortcut: isShortcut(raw.shortcut) ? raw.shortcut : null,
    // journal: a journal's id; template: the database; others: any target or the inbox.
    target: raw.kind === "bookmark" || raw.kind === "task" || raw.kind === "note" ? target || "inbox" : target,
    template: raw.kind === "template" && UUID.test(String(raw.template)) ? String(raw.template) : null,
    task: raw.kind === "task" ? true : raw.task === true,
    // A first line to start with ("Besprechung: ").
    prefix: typeof raw.prefix === "string" ? raw.prefix.replace(/[\u0000-\u001f\u007f]/g, " ").trimStart().slice(0, 80) : "",
  };
}
// The list: at most eight, unique ids; a shortcut used twice (or the main
// one) stays only with the first.
function cleanActions(list, mainShortcut = null) {
  if (!Array.isArray(list)) return [];
  const ids = new Set();
  const shortcuts = new Set(mainShortcut ? [normalize(mainShortcut)] : []);
  const out = [];
  for (const raw of list) {
    const action = cleanAction(raw);
    if (!action || ids.has(action.id)) continue;
    ids.add(action.id);
    if (action.shortcut) {
      if (shortcuts.has(normalize(action.shortcut))) action.shortcut = null;
      else shortcuts.add(normalize(action.shortcut));
    }
    out.push(action);
    if (out.length >= MAX_ACTIONS) break;
  }
  return out;
}
// "CmdOrCtrl+Shift+K" and "CommandOrControl+Shift+K" are the same.
function normalize(accelerator) {
  const names = { CmdOrCtrl: "CommandOrControl", Cmd: "Command", Ctrl: "Control", Option: "Alt", Esc: "Escape", Return: "Enter" };
  const parts = String(accelerator).split("+").map((p) => names[p] || p);
  const key = parts.pop();
  return [...parts.sort(), key].join("+");
}
// The suggestions in the settings (not registered: no shortcut yet).
function presets(t) {
  return [
    { id: "task", kind: "task", name: t("actions.task"), shortcut: null, target: "inbox", task: true },
    { id: "journal", kind: "journal", name: t("actions.journal"), shortcut: null, target: null },
    { id: "bookmark", kind: "bookmark", name: t("actions.bookmark"), shortcut: null, target: "inbox" },
    { id: "meeting", kind: "template", name: t("actions.meeting"), shortcut: null, target: null, template: null, prefix: t("actions.meetingPrefix") },
  ];
}
// A fresh id for a new action of a kind.
function newActionId(kind, existing) {
  const ids = new Set(existing.map((a) => a.id));
  if (!ids.has(kind)) return kind;
  for (let n = 2; ; n++) if (!ids.has(`${kind}-${n}`)) return `${kind}-${n}`;
}
// What the capture window starts with for an action.
function presetFor(action) {
  if (!action) return null;
  return {
    actionId: action.id,
    kind: action.kind,
    name: action.name,
    target: action.kind === "journal" || action.kind === "template" ? action.target : action.target || "inbox",
    template: action.template,
    task: action.task,
    prefix: action.prefix,
    // Bookmarks start with what is on the clipboard.
    paste: action.kind === "bookmark",
  };
}
// Why an action cannot be used yet (shown in the settings).
function problemOf(action) {
  if (action.kind === "journal" && !action.target) return "journal";
  if (action.kind === "template" && !action.target) return "database";
  return null;
}

module.exports = { MAX_ACTIONS, KINDS, cleanAction, cleanActions, normalize, presets, newActionId, presetFor, problemOf };
