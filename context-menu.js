// The right-click menu of the windows: spelling suggestions and "Add to
// Dictionary", cut / copy / paste / paste as plain text / select all, a
// link (open in the browser, copy, open in its own window), an image (copy,
// save as), "Look Up" on macOS, the spell checker's languages and, outside
// the packaged app, "Inspect Element".
//
// Flowplan's editor has its own menu for text (components/text-menu.tsx in
// the server): it calls preventDefault on contextmenu, and Chromium then
// does not ask the browser for a menu at all – Electron emits no
// "context-menu" event (checked by test/app.mjs). So this menu appears only
// where the page left the right click alone (fields, links, images, Shift +
// right click in the editor), never on top of the web app's own. Inside the
// editor the web menu gets the suggestions through window.FlowplanDesktop
// (preload.js: spelling.check, spelling.addWord).
//
// contextMenuItems() decides what the menu holds – plain data, no Electron,
// so test/security.mjs and test/features.mjs run it with Node; attach()
// turns it into a native menu.
const { SPELL_LANGUAGES } = require("./settings");
const { externalUrl, dictionaryWord, sameOrigin } = require("./guards");

const MAX_SUGGESTIONS = 6;
// Addresses an image may be saved from (no file:, no javascript:).
const savableImage = (url) => typeof url === "string" && /^(https?:|data:image\/|blob:https?:)/i.test(url);

// params: Electron's context-menu parameters. options: t, platform, dev
// (not packaged), spellLanguages (the chosen ones), origin (the window
// profile's instance, for "Open in New Window").
function contextMenuItems(params = {}, { t = (key) => key, platform = process.platform, dev = false, spellLanguages = SPELL_LANGUAGES, origin } = {}) {
  const items = [];
  const separator = () => items.length && items[items.length - 1].type !== "separator" && items.push({ type: "separator" });
  const flags = params.editFlags || {};
  const selection = typeof params.selectionText === "string" ? params.selectionText.trim() : "";
  const misspelled = typeof params.misspelledWord === "string" ? params.misspelledWord : "";

  // Spelling: the suggestions first, as in every native text field.
  if (params.isEditable && misspelled) {
    const suggestions = (Array.isArray(params.dictionarySuggestions) ? params.dictionarySuggestions : [])
      .filter((s) => typeof s === "string" && s.trim())
      .slice(0, MAX_SUGGESTIONS);
    for (const suggestion of suggestions) items.push({ id: "spelling-suggestion", label: suggestion, action: "replace", value: suggestion });
    if (!suggestions.length) items.push({ id: "spelling-none", label: t("context.noSuggestions"), enabled: false });
    if (dictionaryWord(misspelled)) items.push({ id: "spelling-add", label: t("context.addToDictionary"), action: "add-word", value: misspelled });
    separator();
  }

  // A link: in the browser (http, https and mailto only), its address, or –
  // a page of the window's own instance – in a window of its own.
  const link = externalUrl(params.linkURL);
  if (link) {
    const own = /^https?:/i.test(link) && sameOrigin(link, origin);
    if (own) items.push({ id: "link-window", label: t("context.openLinkWindow"), action: "open-window", value: link });
    items.push({ id: "link-open", label: t("context.openLink"), action: "open-link", value: link });
    items.push({ id: "link-copy", label: /^mailto:/i.test(link) ? t("context.copyEmail") : t("context.copyLink"), action: "copy-link", value: /^mailto:/i.test(link) ? link.slice(7).split("?")[0] : link });
    separator();
  }

  // An image: copy it, or save it with the system's save dialog.
  if (params.mediaType === "image" && typeof params.srcURL === "string" && params.srcURL) {
    items.push({ id: "image-copy", label: t("context.copyImage"), action: "copy-image" });
    if (savableImage(params.srcURL)) items.push({ id: "image-save", label: t("context.saveImage"), action: "save-image", value: params.srcURL });
    separator();
  }

  if (params.isEditable) {
    items.push({ id: "cut", label: t("menu.cut"), role: "cut", enabled: flags.canCut !== false });
    items.push({ id: "copy", label: t("menu.copy"), role: "copy", enabled: flags.canCopy !== false });
    items.push({ id: "paste", label: t("menu.paste"), role: "paste", enabled: flags.canPaste !== false });
    items.push({ id: "paste-plain", label: t("context.pastePlain"), role: "pasteAndMatchStyle", enabled: flags.canPaste !== false });
    items.push({ id: "select-all", label: t("menu.selectAll"), role: "selectAll", enabled: flags.canSelectAll !== false });
  } else if (selection) {
    items.push({ id: "copy", label: t("menu.copy"), role: "copy", enabled: flags.canCopy !== false });
    items.push({ id: "select-all", label: t("menu.selectAll"), role: "selectAll" });
  }

  // macOS: the dictionary panel for the selected word.
  const lookUp = selection || misspelled;
  if (platform === "darwin" && lookUp && lookUp.length <= 60 && !/\n/.test(lookUp)) {
    separator();
    items.push({ id: "look-up", label: t("context.lookUp", lookUp.length > 24 ? `${lookUp.slice(0, 23)}…` : lookUp), action: "look-up" });
  }

  // The spell checker's languages, where one types.
  if (params.isEditable) {
    separator();
    items.push({
      id: "spelling-languages",
      label: t("context.spellingLanguages"),
      submenu: SPELL_LANGUAGES.map((language) => ({
        id: `spell-${language}`,
        label: t(`spelling.${language}`),
        type: "checkbox",
        checked: spellLanguages.includes(language),
        // The last chosen language stays: spell checking needs one.
        enabled: !(spellLanguages.length === 1 && spellLanguages[0] === language),
        action: "spell-language",
        value: language,
      })),
    });
  }

  if (dev) {
    separator();
    items.push({ id: "inspect", label: t("context.inspect"), action: "inspect" });
  }
  while (items.length && items[items.length - 1].type === "separator") items.pop();
  return items;
}

// Wires the menu to a window's page. deps: t, isMac, dev, settings()
// (spellLanguages), setSpellLanguages(list), origin() of the window's
// profile, openWindow(url), openExternal(url).
function attach(window, deps) {
  const { Menu, clipboard } = require("electron");
  const contents = window.webContents;
  contents.on("context-menu", (_event, params) => {
    const languages = deps.settings().spellLanguages;
    const items = contextMenuItems(params, { t: deps.t, platform: process.platform, dev: deps.dev, spellLanguages: languages, origin: deps.origin() });
    // For test/app.mjs: what the menu would hold (no native menu in CI).
    require("electron").app.emit("flowplan-context-menu", { items, params, window });
    if (!items.length) return;
    const run = (item) => {
      switch (item.action) {
        case "replace":
          return contents.replaceMisspelling(item.value);
        case "add-word":
          return dictionaryWord(item.value) && contents.session.addWordToSpellCheckerDictionary(item.value);
        case "open-link":
          return externalUrl(item.value) && deps.openExternal(item.value);
        case "open-window":
          return deps.openWindow(item.value);
        case "copy-link":
          return clipboard.writeText(item.value);
        case "copy-image":
          return contents.copyImageAt(params.x, params.y);
        case "save-image":
          // Without a save path, Electron asks where with the system's dialog.
          return contents.downloadURL(item.value);
        case "look-up":
          return contents.showDefinitionForSelection();
        case "spell-language": {
          const next = languages.includes(item.value) ? languages.filter((l) => l !== item.value) : [...languages, item.value];
          return next.length && deps.setSpellLanguages(next);
        }
        case "inspect":
          return contents.inspectElement(params.x, params.y);
      }
    };
    const native = (item) => {
      if (item.type === "separator") return { type: "separator" };
      const entry = { label: item.label, enabled: item.enabled !== false };
      if (item.role) entry.role = item.role;
      if (item.type) entry.type = item.type;
      if (item.checked !== undefined) entry.checked = item.checked;
      if (item.submenu) entry.submenu = item.submenu.map(native);
      else if (item.action) entry.click = () => run(item);
      return entry;
    };
    Menu.buildFromTemplate(items.map(native)).popup({ window, x: params.x, y: params.y });
  });
}

module.exports = { MAX_SUGGESTIONS, contextMenuItems, attach };
