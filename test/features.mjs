// The decisions behind the right-click menu, quick capture, the tray, links
// to pages, page windows, dropped files, launch at login, printing and the
// update toast – with Node alone, no Electron. What the app asks an instance
// (instance-api.js) runs against a small stand-in instance (test/stand-in.mjs)
// with Node's fetch. Usage: node test/features.mjs
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { standIn, INBOX, WORKSPACE, SPACE, PAGE, TASK_PAGE, PNG, USER, PROJECTS, JOURNAL } from "./stand-in.mjs";

const require = createRequire(import.meta.url);
const strings = require("../strings.js");
const settings = require("../settings.js");
const { contextMenuItems } = require("../context-menu.js");
const api = require("../instance-api.js");
const deepLinks = require("../deep-links.js");
const files = require("../files.js");
const pageWindows = require("../page-windows.js");
const autostart = require("../autostart.js");
const print = require("../print.js");
const updates = require("../updates.js");
const { trayItems } = require("../tray.js");
const { messageFor, clipboardLink, audioOk, cleanInput } = require("../capture.js");
const targetRules = require("../capture-targets.js");
const queueRules = require("../capture-queue.js");
const historyRules = require("../capture-history.js");
const captureStore = require("../capture-store.js");
const actionRules = require("../capture-actions.js");
const onboarding = require("../onboarding.js");
const screenRules = require("../screen-capture.js");
const guards = require("../guards.js");
strings.setLocale("en");
const { t } = strings;
const server = "https://flowplan.example.com";

// Settings: defaults per system, only valid values, unknown keys dropped.
{
  assert.deepEqual(settings.settingsOf({}, "darwin"), { tray: true, launchAtLogin: false, startHidden: false, captureShortcut: "CommandOrControl+Shift+Space", spellLanguages: ["de-DE", "en-US", "fr-FR"], deviceAi: true, captureActions: [] });
  assert.equal(settings.settingsOf({}, "win32").tray, false, "off on Windows");
  assert.equal(settings.settingsOf({}, "linux").tray, false, "off on Linux");
  const saved = settings.settingsOf({ settings: { tray: "yes", launchAtLogin: true, captureShortcut: "rm -rf", spellLanguages: ["xx", "fr-FR"], partition: "persist:x" } }, "linux");
  assert.equal(saved.tray, false, "a string is no switch");
  assert.equal(saved.captureShortcut, settings.DEFAULT_SHORTCUT, "an invalid shortcut falls back");
  assert.deepEqual(saved.spellLanguages, ["fr-FR"]);
  assert.ok(!("partition" in saved));
  assert.equal(settings.settingsOf({ settings: { captureShortcut: null } }).captureShortcut, null, "switched off");
  assert.equal(settings.settingsOf({ settings: { deviceAi: false } }).deviceAi, false, "Apple Intelligence switched off");
  assert.equal(settings.settingsOf({ settings: { deviceAi: "no" } }).deviceAi, true, "only a boolean switches");
  assert.equal(settings.applyPatch({}, { deviceAi: false }).deviceAi, false);
  assert.deepEqual(settings.settingsOf({ settings: { spellLanguages: [] } }).spellLanguages, ["de-DE", "en-US", "fr-FR"], "never without a language");
  for (const ok of ["CommandOrControl+Shift+Space", "Alt+Shift+K", "Control+Alt+F12", "Super+Plus", "Ctrl+Shift+1"]) assert.equal(settings.isShortcut(ok), true, ok);
  for (const bad of ["Space", "K", "Shift+K", "Ctrl+", "Ctrl+Ctrl+K", "Hyper+K", "Ctrl+Shift+Space+K", "", null, "Ctrl+" + "K".repeat(80)]) assert.equal(settings.isShortcut(bad), false, String(bad));
  const patched = settings.applyPatch({ settings: { launchAtLogin: true, startHidden: true } }, { launchAtLogin: false, tray: true, evil: 1 }, "linux");
  assert.deepEqual(patched, { tray: true, launchAtLogin: false, startHidden: false, captureShortcut: settings.DEFAULT_SHORTCUT, spellLanguages: ["de-DE", "en-US", "fr-FR"], deviceAi: true, captureActions: [] }, "hidden only with launch at login");
  assert.equal(settings.applyPatch({}, { captureShortcut: "Nope" }).captureShortcut, settings.DEFAULT_SHORTCUT);
  assert.equal(settings.shortcutLabel("CommandOrControl+Shift+Space", "darwin"), "⌘⇧Space");
  assert.equal(settings.shortcutLabel("CommandOrControl+Shift+Space", "win32"), "Ctrl+Shift+Space");
  console.log("✔ Einstellungen geprüft");
}

// The right-click menu: suggestions, the dictionary, links, images, fields.
{
  const opts = { t, platform: "linux", origin: server, spellLanguages: ["de-DE", "en-US"] };
  const ids = (items) => items.map((i) => i.id || "-");
  let items = contextMenuItems({ isEditable: true, misspelledWord: "wrold", dictionarySuggestions: ["world", "wold", "a", "b", "c", "d", "e"], editFlags: { canCut: true, canCopy: true, canPaste: true, canSelectAll: true } }, opts);
  assert.deepEqual(items.slice(0, 6).map((i) => i.value), ["world", "wold", "a", "b", "c", "d"], "at most six suggestions, first");
  assert.equal(items[6].id, "spelling-add");
  assert.equal(items[6].value, "wrold");
  assert.deepEqual(ids(items).slice(7), ["-", "cut", "copy", "paste", "paste-plain", "select-all", "-", "spelling-languages"]);
  assert.equal(items.find((i) => i.id === "paste-plain").role, "pasteAndMatchStyle");
  const languages = items.find((i) => i.id === "spelling-languages").submenu;
  assert.deepEqual(languages.map((l) => [l.value, l.checked]), [["de-DE", true], ["en-US", true], ["fr-FR", false]]);
  items = contextMenuItems({ isEditable: true, misspelledWord: "zzzq", dictionarySuggestions: [] }, { ...opts, spellLanguages: ["fr-FR"] });
  assert.equal(items[0].id, "spelling-none");
  assert.equal(items[0].enabled, false);
  assert.equal(items.find((i) => i.id === "spelling-languages").submenu.find((l) => l.value === "fr-FR").enabled, false, "the last language stays");
  assert.ok(!contextMenuItems({ isEditable: true, misspelledWord: "<script>", dictionarySuggestions: [] }, opts).some((i) => i.id === "spelling-add"), "no odd words for the dictionary");
  // Not editable, no misspelling: no suggestions (Chromium only reports them in fields).
  assert.ok(!contextMenuItems({ isEditable: false, misspelledWord: "wrold", selectionText: "wrold" }, opts).some((i) => i.id?.startsWith("spelling")));
  // Links: the instance's own pages also in their own window; http(s) and mailto only.
  items = contextMenuItems({ linkURL: `${server}/#page=${PAGE}` }, opts);
  assert.deepEqual(ids(items), ["link-window", "link-open", "link-copy"]);
  items = contextMenuItems({ linkURL: "https://example.org/x" }, opts);
  assert.deepEqual(ids(items), ["link-open", "link-copy"]);
  items = contextMenuItems({ linkURL: "mailto:a@example.org?subject=x" }, opts);
  assert.equal(items.find((i) => i.id === "link-copy").value, "a@example.org", "the address of a mail link");
  for (const linkURL of ["javascript:alert(1)", "file:///etc/passwd", "flowplan://open?x", "https://u:p@example.org/"]) assert.deepEqual(contextMenuItems({ linkURL }, opts), [], linkURL);
  // Images: copy, save as (not from file: or javascript:).
  assert.deepEqual(ids(contextMenuItems({ mediaType: "image", srcURL: `${server}/api/files/x`, hasImageContents: true }, opts)), ["image-copy", "image-save"]);
  assert.deepEqual(ids(contextMenuItems({ mediaType: "image", srcURL: "file:///etc/passwd" }, opts)), ["image-copy"]);
  // A selection: copy; macOS adds Look Up; outside the packaged app Inspect.
  assert.deepEqual(ids(contextMenuItems({ selectionText: "Hallo" }, opts)), ["copy", "select-all"]);
  assert.deepEqual(ids(contextMenuItems({ selectionText: "Hallo" }, { ...opts, platform: "darwin" })), ["copy", "select-all", "-", "look-up"]);
  assert.equal(contextMenuItems({ selectionText: "Hallo" }, { ...opts, platform: "darwin" }).at(-1).label, "Look Up “Hallo”");
  assert.deepEqual(ids(contextMenuItems({}, opts)), [], "nothing to offer: no menu");
  assert.deepEqual(ids(contextMenuItems({}, { ...opts, dev: true })), ["inspect"]);
  assert.equal(contextMenuItems({ isEditable: true, editFlags: { canPaste: false } }, opts).find((i) => i.id === "paste").enabled, false);
  console.log("✔ Kontextmenü");
}

// Links to pages: forms, checks, which profile.
{
  const id = PAGE;
  assert.deepEqual(deepLinks.parseLink(`flowplan://open?instance=${encodeURIComponent(server)}&page=${id}`), { kind: "open", origin: server, url: `${server}/#page=${id}` });
  assert.deepEqual(deepLinks.parseLink(`flowplan://open?instance=${server}&page=${id.toUpperCase()}&row=${INBOX}`).url, `${server}/#page=${id}&row=${INBOX}`);
  assert.deepEqual(deepLinks.parseLink(`flowplan://open/flowplan.example.com?page=${id}`), { kind: "open", origin: server, url: `${server}/#page=${id}` }, "the path form");
  assert.deepEqual(deepLinks.parseLink(`flowplan://open?url=${encodeURIComponent(`${server}/#page=${id}`)}`), { kind: "open", origin: server, url: `${server}/#page=${id}` });
  assert.deepEqual(deepLinks.parseLink(`flowplan://open?instance=${server}`), { kind: "open", origin: server, url: `${server}/` });
  assert.deepEqual(deepLinks.parseLink("flowplan://sign-in?code=x"), { kind: "sign-in" });
  for (const bad of [
    `flowplan://open?instance=http://evil.example&page=${id}`, // http only on loopback
    `flowplan://open?instance=javascript:alert(1)&page=${id}`,
    `flowplan://open?instance=file:///etc&page=${id}`,
    `flowplan://open?instance=${server}&page=../../x`,
    `flowplan://open?instance=${server}&row=${id}`, // a row needs its page
    `flowplan://open?url=${encodeURIComponent(`${server}/api/export/x`)}`, // no endpoints
    `flowplan://open?url=${encodeURIComponent("https://u:p@flowplan.example.com/")}`,
    `flowplan://open?instance=https://u:p@flowplan.example.com&page=${id}`,
    "flowplan://open/evil.example%2F..%2F?page=x",
    "flowplan://delete?all=1",
    "https://flowplan.example.com/",
    `flowplan://open?instance=${server}&page=${id}&x=${"a".repeat(5000)}`,
    undefined,
  ])
    assert.equal(deepLinks.parseLink(bad), null, String(bad).slice(0, 80));
  assert.equal(deepLinks.parseLink(`flowplan://open?instance=http://localhost:3000&page=${id}`).origin, "http://localhost:3000", "loopback for local tests");
  const state = { profiles: [{ id: "a", server: "https://other.example" }, { id: "b", server }, { id: "c", server }], activeProfile: "c" };
  const link = deepLinks.parseLink(`flowplan://open?instance=${server}&page=${id}`);
  assert.deepEqual(deepLinks.linkTarget(link, state), { profileId: "c", url: link.url }, "the active profile when it points there");
  assert.deepEqual(deepLinks.linkTarget(link, { ...state, activeProfile: "a" }), { profileId: "b", url: link.url }, "otherwise the first");
  assert.deepEqual(deepLinks.linkTarget(deepLinks.parseLink("flowplan://open?instance=https://new.example"), state), { unknown: "https://new.example", url: "https://new.example/" }, "an unknown instance is asked about");
  assert.equal(deepLinks.linkTarget({ kind: "sign-in" }, state), null);
  assert.deepEqual(deepLinks.linksFromArgs(["app", "--x", "flowplan://open?a", "FLOWPLAN://sign-in"]), ["flowplan://open?a", "FLOWPLAN://sign-in"]);
  assert.equal(deepLinks.pageLink(server, id), `flowplan://open?instance=${encodeURIComponent(server)}&page=${id}`);
  assert.deepEqual(deepLinks.parseLink(deepLinks.pageLink(server, id, INBOX)).url, `${server}/#page=${id}&row=${INBOX}`, "what the server builds opens");
  console.log("✔ Links flowplan://open");
}

// Files: types by name and content, sizes, the command line, the vault.
{
  const head = (text) => Buffer.from(text, "latin1");
  assert.deepEqual(files.classifyFile({ name: "Scan.PDF", size: 1000, head: head("%PDF-1.7") }), { kind: "pdf", mime: "application/pdf" });
  assert.deepEqual(files.classifyFile({ name: "a.png", size: PNG.length, head: PNG.subarray(0, 16) }), { kind: "image", mime: "image/png" });
  assert.deepEqual(files.classifyFile({ name: "notes.md", size: 10, head: head("# Notes") }), { kind: "markdown", mime: "text/markdown" });
  assert.deepEqual(files.classifyFile({ name: "a.txt", size: 10, head: head("hello") }), { kind: "text", mime: "text/plain" });
  assert.deepEqual(files.classifyFile({ name: "evil.png", size: 10, head: head("<svg onload=") }), { error: "content" }, "the content must match");
  assert.deepEqual(files.classifyFile({ name: "a.txt", size: 10, head: Buffer.from([0x4d, 0x5a, 0, 0]) }), { error: "content" }, "no binaries as text");
  for (const name of ["a.exe", "a.svg", "a.html", "a.js", "a", "a.zip", ".md.exe"]) assert.deepEqual(files.classifyFile({ name, size: 10, head: head("x") }), { error: "type" }, name);
  assert.deepEqual(files.classifyFile({ name: "big.pdf", size: files.MAX_MEDIA_BYTES + 1, head: head("%PDF-") }), { error: "size" });
  assert.deepEqual(files.classifyFile({ name: "big.md", size: files.MAX_TEXT_BYTES + 1, head: head("#") }), { error: "size" });
  assert.deepEqual(files.classifyFile({ name: "empty.md", size: 0 }), { error: "empty" });
  const argv = ["/opt/Flowplan/flowplan", "--no-sandbox", "--profile=a", "flowplan://open?x", "/home/u/Scan.pdf", "file:///home/u/Notiz%20eins.md", "https://example.org/a.pdf", "relative.txt", "/home/u/app.exe", "/home/u/Scan.pdf"];
  assert.deepEqual(files.filesFromArgs(argv), ["/home/u/Scan.pdf", "/home/u/Notiz eins.md"]);
  assert.deepEqual(files.filesFromArgs(argv, { cwd: "/home/u" }), ["/home/u/Scan.pdf", "/home/u/Notiz eins.md", "/home/u/relative.txt"]);
  assert.equal(files.filesFromArgs(["app", ...Array.from({ length: 20 }, (_, i) => `/x/${i}.md`)]).length, files.MAX_FILES);
  assert.deepEqual(files.droppedPaths(["/a/b.pdf", "relative.pdf", "/a/c.exe", 42, "/a/\0.pdf", "/a/d.md"]), ["/a/b.pdf", "/a/d.md"]);
  assert.deepEqual(files.droppedPaths("not a list"), []);
  assert.equal(files.titleOf("/x/Mein Plan\n.final.md"), "Mein Plan .final");
  const entries = files.vaultEntries([
    { name: "Notiz.md", kind: "markdown", bytes: Buffer.from("# Notiz") },
    { name: "Foto.png", kind: "image", bytes: PNG },
    { name: "Notiz.txt", kind: "text", bytes: Buffer.from("zwei") },
  ]);
  assert.deepEqual(entries.map((e) => e.name), ["Notiz.md", "Foto.md", "Foto.png", "Notiz 2.md"]);
  assert.equal(entries[1].data.toString(), "![[Foto.png]]\n", "images and PDFs embedded in their note");
  // The ZIP is a real one (checked by an independent reader when there is one).
  assert.equal(api.crc32(Buffer.from("123456789")), 0xcbf43926);
  const zip = api.zipStore(entries);
  assert.equal(zip.readUInt32LE(0), 0x04034b50);
  const dir = mkdtempSync(join(tmpdir(), "flowplan-zip-"));
  writeFileSync(join(dir, "v.zip"), zip);
  try {
    const listed = execFileSync("python3", ["-I", "-c", "import sys,zipfile; z=zipfile.ZipFile(sys.argv[1]); print(z.testzip() or 'ok'); print('|'.join(z.namelist()))", join(dir, "v.zip")]).toString().trim().split("\n");
    assert.deepEqual(listed, ["ok", "Notiz.md|Foto.md|Foto.png|Notiz 2.md"]);
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  console.log("✔ Dateien prüfen");
}

// Pages in windows of their own: only the profile's pages, sane sizes.
{
  const profile = { id: "a", server };
  const config = {
    pageWindows: {
      a: [
        { url: `${server}/#page=${PAGE}`, bounds: { x: 10, y: 20, width: 900, height: 700 } },
        { url: "https://evil.example/", bounds: {} },
        { url: `${server}/api/export/x` },
        { url: `${server}/share/abc`, bounds: { width: 10, height: 10 } },
        { url: "javascript:alert(1)" },
      ],
      gone: [{ url: `${server}/` }],
    },
  };
  assert.deepEqual(pageWindows.savedPageWindows(config, profile), [
    { url: `${server}/#page=${PAGE}`, bounds: { x: 10, y: 20, width: 900, height: 700 } },
    { url: `${server}/share/abc`, bounds: null },
  ]);
  assert.deepEqual(pageWindows.savedPageWindows(config, { id: "b", server }), []);
  const next = pageWindows.withPageWindows(config, { profiles: [profile] }, "a", [{ url: `${server}/#page=x`, bounds: { width: 800, height: 600, x: 1.5, y: 2 } }, { url: "https://evil.example/" }]);
  assert.deepEqual(next, { a: [{ url: `${server}/#page=x`, bounds: { width: 800, height: 600 } }] }, "removed profiles fall away, odd places too");
  assert.deepEqual(pageWindows.withPageWindows(next, { profiles: [profile] }, "a", []), {}, "no windows, no entry");
  console.log("✔ Seitenfenster merken");
}

// Launch at login.
{
  assert.deepEqual(autostart.loginItemOptions({ launchAtLogin: true, startHidden: true }, { platform: "darwin" }), { openAtLogin: true, openAsHidden: true });
  assert.deepEqual(autostart.loginItemOptions({ launchAtLogin: true, startHidden: true }, { platform: "win32", execPath: "C:\\Flowplan.exe" }), { openAtLogin: true, path: "C:\\Flowplan.exe", args: ["--hidden"] });
  assert.deepEqual(autostart.loginItemOptions({ launchAtLogin: false, startHidden: true }, { platform: "win32", execPath: "x" }), { openAtLogin: false, path: "x", args: [] });
  assert.equal(autostart.autostartPath({ XDG_CONFIG_HOME: "/cfg" }, "/home/u"), "/cfg/autostart/flowplan.desktop");
  assert.equal(autostart.autostartPath({ XDG_CONFIG_HOME: "relative" }, "/home/u"), "/home/u/.config/autostart/flowplan.desktop");
  const entry = autostart.autostartEntry({ command: "/opt/Flow plan/$x`y\"z", args: [], hidden: true });
  assert.match(entry, /^\[Desktop Entry\]\nType=Application\n/);
  assert.match(entry, /^Exec="\/opt\/Flow plan\/\\\$x\\`y\\"z" "--hidden"$/m, "quoted as the specification wants");
  assert.throws(() => autostart.autostartEntry({ command: "/x\nExec=evil" }));
  assert.deepEqual(autostart.linuxCommand({ env: { APPIMAGE: "/home/u/Flowplan.AppImage" }, execPath: "/tmp/.mount/flowplan" }), { command: "/home/u/Flowplan.AppImage", args: [] }, "the AppImage, not its mount");
  assert.deepEqual(autostart.linuxCommand({ env: {}, execPath: "/node_modules/electron/dist/electron", packaged: false, appPath: "/src/app" }), { command: "/node_modules/electron/dist/electron", args: ["/src/app"] });
  assert.equal(autostart.startsHidden(["x", "--hidden"]), true);
  assert.equal(autostart.startsHidden(["x"], { wasOpenedAsHidden: true }), true);
  assert.equal(autostart.startsHidden(["x"], {}), false);
  console.log("✔ Beim Anmelden starten");
}

// Printing and PDFs.
{
  assert.equal(print.paperFor("de-DE"), "A4");
  assert.equal(print.paperFor("en-US"), "Letter");
  assert.equal(print.paperFor("en-GB"), "A4");
  assert.equal(print.paperFor("fr"), "A4");
  assert.deepEqual(print.pdfOptions("en-CA"), { pageSize: "Letter", printBackground: true, preferCSSPageSize: true, margins: { marginType: "default" }, generateTaggedPDF: true, generateDocumentOutline: true });
  assert.equal(print.pdfFileName("Plan: Q1/Q2 <final>?"), "Plan Q1 Q2 final.pdf");
  assert.equal(print.pdfFileName(" ... "), "Flowplan.pdf");
  assert.equal(print.pdfFileName("x".repeat(300)).length, 124);
  console.log("✔ Drucken und PDF");
}

// The update toast: what shows when, never a dialog.
{
  const view = (s) => updates.view(s, { translate: t, locale: "en", current: "1.0.8" });
  let s = updates.INITIAL;
  s = updates.reduce(s, { type: "check", manual: false });
  assert.equal(view(s), null, "an automatic check shows nothing");
  s = updates.reduce(s, { type: "available", version: "1.1.0", canInstall: true });
  assert.equal(view(s).title, "Downloading Flowplan 1.1.0…");
  s = updates.reduce(s, { type: "progress", percent: 42.4, transferred: 12_300_000, total: 85_000_000, bytesPerSecond: 2_100_000 });
  assert.equal(view(s).detail, "42 % · 12.3 MB of 85 MB · 2.1 MB/s");
  assert.equal(view(s).progress, 0.424);
  assert.equal(updates.taskbarProgress(s), 0.424, "also on the Dock icon or taskbar");
  assert.deepEqual(view(s).actions.map((a) => a.id), ["hide"]);
  const hidden = updates.reduce(s, { type: "dismiss" });
  assert.equal(view(hidden), null);
  assert.equal(updates.taskbarProgress(hidden), 0.424, "hiding the toast keeps the progress on the icon");
  s = updates.reduce(hidden, { type: "downloaded", version: "1.1.0" });
  assert.equal(view(s).title, "Flowplan 1.1.0 is ready", "ready shows again");
  assert.deepEqual(view(s).actions.map((a) => [a.id, !!a.primary]), [["restart", true], ["later", false]]);
  assert.equal(updates.taskbarProgress(s), -1);
  assert.equal(updates.reduce(s, { type: "error", message: "x" }), s, "a failed later check keeps the update");
  s = updates.reduce(s, { type: "check", manual: false });
  assert.equal(s.phase, "ready");
  // An automatic check meanwhile keeps the menu's answer visible.
  const both = updates.reduce(updates.reduce(updates.INITIAL, { type: "check", manual: true }), { type: "check", manual: false });
  assert.equal(both.manual, true);
  assert.notEqual(view(updates.reduce(both, { type: "not-available" })), null);
  // From the menu: an answer either way, errors only then.
  let m = updates.reduce(updates.INITIAL, { type: "check", manual: true });
  assert.equal(view(m).busy, true);
  m = updates.reduce(m, { type: "not-available" });
  assert.equal(view(m).title, "Flowplan is up to date");
  assert.ok(view(m).autoHide > 0);
  let e = updates.reduce(updates.reduce(updates.INITIAL, { type: "check" }), { type: "error", message: "offline" });
  assert.equal(view(e), null, "an automatic check fails quietly");
  e = updates.reduce(updates.reduce(updates.INITIAL, { type: "check", manual: true }), { type: "error", message: "net::ERR" });
  assert.match(view(e).detail, /net::ERR – the latest version is also available at https:\/\/flowplan\.org\/download/);
  // Unsigned macOS and the like: the download page, once per version.
  let u = updates.reduce(updates.reduce(updates.INITIAL, { type: "check" }), { type: "available", version: "2.0.0", canInstall: false });
  assert.deepEqual(view(u).actions.map((a) => a.id), ["download", "later"]);
  u = updates.reduce(updates.reduce(updates.reduce(u, { type: "dismiss" }), { type: "check" }), { type: "available", version: "2.0.0", canInstall: false });
  assert.equal(view(u), null, "not again for the same version");
  u = updates.reduce(updates.reduce(u, { type: "check", manual: true }), { type: "available", version: "2.0.0", canInstall: false });
  assert.notEqual(view(u), null, "unless asked");
  assert.equal(view(updates.reduce(updates.INITIAL, { type: "not-installed" })).title, "Updates are only available in the installed app");
  assert.match(view(m).source, /^Update source: /, "the source is named");
  assert.equal(updates.formatBytes(999), "999 B");
  assert.equal(updates.formatBytes(1_500_000, "de"), "1,5 MB");
  console.log("✔ Update-Hinweis ohne Dialog");
}

// The tray's menu.
{
  const data = { unread: 3, profiles: [{ id: "a", label: "Work" }, { id: "b", label: "Home" }], active: "b", captureLabel: "CommandOrControl+Shift+Space", updateReady: "1.1.0", tasks: { tasks: [{ text: "Angebot", page: "Projekt", pageId: PAGE, rowId: null, overdue: true }], more: 2 } };
  const items = trayItems(data, t);
  const ids = items.map((i) => i.id || "-");
  assert.deepEqual(ids, ["tray-capture", "-", "tray-today", "tray-task", "tray-more-tasks", "-", "tray-inbox", "tray-open", "tray-profiles", "-", "tray-update", "tray-settings", "tray-quit"]);
  assert.equal(items[3].label, "⚠ Angebot");
  assert.equal(items.find((i) => i.id === "tray-inbox").label, "3 unread notifications");
  assert.equal(items.find((i) => i.id === "tray-profiles").submenu.find((p) => p.checked).value, "b");
  assert.equal(items.find((i) => i.id === "tray-update").label, "Restart to Update to 1.1.0");
  assert.equal(trayItems({ ...data, tasks: null, tasksError: "signed-out", profiles: [], updateReady: null }, t).find((i) => i.id === "tray-tasks-error").label, "Not signed in");
  assert.ok(trayItems({ ...data, tasks: { tasks: [], more: 0 } }, t).some((i) => i.id === "tray-no-tasks"));
  console.log("✔ Menü des Symbols");
}

// What the app asks the instance – against the stand-in, with Node's fetch.
{
  const instance = await standIn({ today: "2026-10-26" });
  const client = api.createInstanceApi({ origin: instance.origin, fetch });
  // Quick capture: workspace, inbox, the web app's command – with the origin.
  const saved = await client.capture({ text: "Idee\nmit Details\n\nund mehr" }, "2026-10-26");
  assert.equal(saved.pageId, INBOX);
  assert.match(saved.url, new RegExp(`/#page=${INBOX}&row=[0-9a-f-]{36}$`));
  const [command] = instance.to("/api/command");
  assert.equal(command.headers.origin, instance.origin, "the instance checks the origin of changes");
  assert.deepEqual(Object.keys(JSON.parse(command.body)).sort(), ["action", "pageId", "rowId", "text", "title"]);
  assert.deepEqual(JSON.parse(command.body).title, "Idee");
  assert.deepEqual(JSON.parse(command.body).text, "mit Details\n\nund mehr");
  // As a task: an open task due today.
  const task = api.captureCommand({ text: "Anrufen <Max>\nNotiz", task: true }, { pageId: INBOX, rowId: PAGE, today: "2026-10-26" });
  assert.equal(task.article, '<ul data-type="taskList"><li data-type="taskItem" data-checked="false" data-due="2026-10-26"><p>Anrufen &lt;Max&gt;</p></li></ul><p>Notiz</p>');
  // Assigned to the person capturing, so it is under "My tasks".
  const mine = api.captureCommand({ text: "Anrufen", task: true }, { pageId: INBOX, rowId: PAGE, today: "2026-10-26", user: { id: USER, name: "Alex <M>" } });
  assert.equal(mine.article, `<ul data-type="taskList"><li data-type="taskItem" data-checked="false" data-due="2026-10-26"><p>Anrufen <span data-mention="${USER}" class="mention">@Alex &lt;M&gt;</span></p></li></ul>`);
  assert.doesNotMatch(api.captureCommand({ text: "x", task: true }, { pageId: INBOX, user: { id: "../x", name: "x" } }).article, /data-mention/, "only a real id");
  await client.capture({ text: "Als Aufgabe", task: true }, "2026-10-26");
  assert.match(JSON.parse(instance.to("/api/command").at(-1).body).article, new RegExp(`data-mention="${USER}"`));
  assert.equal(task.text, undefined);
  assert.throws(() => api.captureCommand({ text: "   " }, { pageId: INBOX }), (e) => e.kind === "empty");
  assert.throws(() => api.captureCommand({ text: "x".repeat(20_001) }, { pageId: INBOX }), (e) => e.kind === "too-long");
  assert.throws(() => api.captureCommand({ text: "x" }, { pageId: "../x" }), (e) => e.kind === "no-inbox");
  // Bootstrap is asked once.
  await client.capture({ text: "Zweite" });
  assert.equal(instance.to("/api/bootstrap").length, 1);
  // Today's tasks: due today or earlier, across workspaces, oldest first.
  const today = await client.todayTasks("2026-10-26");
  assert.deepEqual(today.tasks.map((x) => [x.text, x.overdue]), [["Überfällig", true], ["Angebot schicken", false]]);
  assert.equal(instance.to("/api/tasks")[0].query.workspace, WORKSPACE);
  // Files: upload with a known length, the record with the file, imports.
  const stored = await client.upload(INBOX, { name: "bild.png", type: "image/png", bytes: PNG });
  assert.equal(stored.url, "/api/files/f1");
  const upload = instance.to("/api/upload")[0];
  assert.ok(Number(upload.headers["content-length"]) > PNG.length, "multipart with its length");
  assert.match(upload.headers["content-type"], /^multipart\/form-data; boundary=/);
  assert.ok(upload.body.includes(PNG), "the file itself");
  assert.match(upload.body.toString("latin1"), /name="pageId"\r\n\r\n33333333-3333-4333-8333-333333333333\r\n/);
  await client.recordWithFile(INBOX, "Bild", stored);
  assert.equal(JSON.parse(instance.to("/api/command").at(-1).body).article, '<p><img src="/api/files/f1" alt="bild.png"></p>');
  await client.importRecords(INBOX, [{ name: "a.md", type: "text/markdown", bytes: Buffer.from("# A") }]);
  assert.equal(instance.to(/\/import-markdown$/)[0].path, `/api/pages/${INBOX}/import-markdown`);
  const pages = await client.importPages(WORKSPACE, SPACE, api.zipStore([{ name: "a.md", data: Buffer.from("x") }]));
  assert.deepEqual(pages.rootIds, [PAGE]);
  const imported = instance.to("/api/import/source")[0].body.toString("latin1");
  assert.match(imported, /name="source"\r\n\r\nobsidian\r\n/);
  assert.match(imported, /name="mode"\r\n\r\npages\r\n/);
  assert.ok(imported.includes("PK\u0003\u0004"));
  // What went wrong, told apart.
  instance.state.signedOut = true;
  await assert.rejects(api.createInstanceApi({ origin: instance.origin, fetch }).capture({ text: "x" }), (e) => e.kind === "signed-out");
  instance.state.signedOut = false;
  instance.state.capture = { databases: [], default: null };
  await assert.rejects(api.createInstanceApi({ origin: instance.origin, fetch }).capture({ text: "x" }), (e) => e.kind === "no-inbox");
  instance.state.capture = null;
  instance.state.status["/api/command"] = 413;
  await assert.rejects(client.capture({ text: "x" }), (e) => e.kind === "too-large");
  delete instance.state.status["/api/command"];
  // Another origin is never asked, a redirect elsewhere is refused.
  const seen = [];
  const spy = api.createInstanceApi({ origin: instance.origin, fetch: async (url, init) => (seen.push(url), { ok: true, url: "https://evil.example/", status: 200, json: async () => ({}) }) });
  await assert.rejects(spy.request("/api/bootstrap"), (e) => e.kind === "server");
  await assert.rejects(spy.request("https://evil.example/api/x"), (e) => e.kind === "server");
  assert.deepEqual(seen, [`${instance.origin}/api/bootstrap`]);
  await instance.stop();
  // Without a connection: "offline", the text stays (capture.js).
  await assert.rejects(api.createInstanceApi({ origin: instance.origin, fetch }).capture({ text: "x" }), (e) => e.kind === "offline");
  assert.match(messageFor({ kind: "offline" }, { t, host: "flowplan.example.com" }), /^No connection to flowplan\.example\.com\. The text stays here/);
  assert.equal(messageFor({ kind: "rejected", detail: "Diese Seite ist gesperrt." }, { t }), "Diese Seite ist gesperrt.");
  assert.equal(messageFor(new Error("boom"), { t }), t("capture.failed"));
  assert.deepEqual(api.todayTasks({ tasks: [{ pageId: "bad", due: "2000-01-01" }, { pageId: PAGE, due: "2000-01-01", checked: true }, { pageId: TASK_PAGE, due: "2000-01-01", text: "x\u0000y" }] }, "2026-01-01").tasks.map((x) => x.text), ["x y"], "only the fields used, cleaned");
  console.log("✔ Anfragen an die Instanz");
}

// Quick capture: where it goes – the inbox first, recently used next, never
// encrypted pages; remembered per profile (ids only).
{
  const list = targetRules.normalizeTargets({
    inbox: { id: INBOX, name: "Eingang" },
    targets: [
      { id: INBOX, kind: "database", name: "Eingang", fills: { date: "Fällig", tags: true, person: null }, templates: [{ id: PAGE, name: "Besprechung" }, { id: "bad", name: "x" }] },
      { id: PROJECTS, kind: "database", name: "Projekte\u0000", space: "Arbeit" },
      { id: PAGE, kind: "document", name: "Notizen" },
      { id: JOURNAL, kind: "journal", name: "Tagebuch" },
      { id: TASK_PAGE, kind: "document", name: "", encrypted: true },
      { id: USER, kind: "whiteboard", name: "Board" },
      { id: "../x", kind: "database", name: "evil" },
    ],
    encryptedExcluded: 3,
    voice: true,
    suggest: { server: false, device: true, prefer: "device" },
  });
  assert.deepEqual(list.targets.map((x) => x.name), ["Eingang", "Projekte", "Notizen", "Tagebuch"], "encrypted, unknown kinds and odd ids fall away");
  assert.deepEqual(list.targets[0].templates, [{ id: PAGE, name: "Besprechung", default: false }]);
  assert.equal(list.encryptedExcluded, 3);
  assert.deepEqual(list.suggest, { server: false, device: true, prefer: "device" });
  assert.equal(targetRules.normalizeTargets({ suggest: { server: false, device: false } }).suggest, null, "AI off: no suggestion");
  let recent = targetRules.rememberTarget({}, "a1", JOURNAL);
  recent = targetRules.rememberTarget(recent, "a1", PROJECTS);
  recent = targetRules.rememberTarget(recent, "a1", JOURNAL);
  recent = targetRules.rememberTarget(recent, "a1", "../evil");
  assert.deepEqual(recent, { a1: [JOURNAL, PROJECTS] }, "newest first, once, only ids");
  const ordered = targetRules.orderTargets(list, targetRules.recentOf(recent, "a1"));
  assert.deepEqual(ordered.map((x) => x.id), ["inbox", JOURNAL, PROJECTS, PAGE], "the inbox, the recent, then databases, journals, pages");
  assert.equal(ordered[0].pageId, INBOX);
  assert.equal(targetRules.initialTarget(ordered, [JOURNAL]), JOURNAL, "the last one used");
  assert.equal(targetRules.initialTarget(ordered, ["11111111-1111-4111-8111-000000000000"]), "inbox", "gone: the inbox");
  assert.deepEqual(targetRules.filterTargets(ordered, "tag").map((x) => x.id), [JOURNAL]);
  assert.deepEqual(targetRules.filterTargets(ordered, "arbeit proj").map((x) => x.id), [PROJECTS], "the space counts too");
  assert.equal(targetRules.pageOf(ordered, "inbox"), INBOX);
  assert.equal(targetRules.pageOf(ordered, "x"), null);
  console.log("✔ Ziele beim Erfassen");
}

// What the capture window sends is checked again; chips the person removed
// travel as their ids (the instance keeps them as text).
{
  const input = cleanInput({ text: "x".repeat(30_000), task: "yes", targetId: "../x", literal: ["date:morgen", 42, "x".repeat(400)], attachments: ["not-an-id"], link: { url: "javascript:alert(1)" }, cells: { prio: "Hoch", big: "x".repeat(5000) } });
  assert.equal(input.text.length, 20_000);
  assert.equal(input.task, false);
  assert.equal(input.targetId, "inbox");
  assert.deepEqual(input.literal, ["date:morgen"]);
  assert.deepEqual(input.attachments, []);
  assert.equal(input.link, null, "only http(s) links");
  assert.deepEqual(input.cells, { prio: "Hoch" });
  assert.equal(cleanInput({ link: { url: "https://example.org/a", title: "T", image: "http://x/i.png" } }).link.image, "", "images over https only");
  assert.equal(clipboardLink("  https://example.org/a?b=1 "), "https://example.org/a?b=1");
  for (const bad of ["https://example.org/a b", "ftp://x", "https://u:p@x.org/", "Text https://x.org", ""]) assert.equal(clipboardLink(bad), null, bad);
  const webm = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(40)]);
  assert.equal(audioOk(webm, "audio/webm;codecs=opus"), true);
  assert.equal(audioOk(webm, "text/html"), false);
  assert.equal(audioOk(Buffer.from("<script>alert(1)</script>"), "audio/webm"), false, "the content must look like audio");
  console.log("✔ Eingaben des Erfassen-Fensters geprüft");
}

// The offline queue: kept encrypted (or said plainly that it is not), sent
// later with the same key and body, backing off; refused ones stay.
{
  const dir = mkdtempSync(join(tmpdir(), "flowplan-queue-"));
  // A stand-in for safeStorage: reversible, not plain.
  const cipher = { available: true, encrypt: (text) => Buffer.from(text).map((b) => b ^ 0x5a), decrypt: (buffer) => Buffer.from(buffer).map((b) => b ^ 0x5a).toString() };
  const store = captureStore.createStore({ dir, cipher });
  const item = queueRules.newItem({ fields: { text: "Geheimer Gedanke", targetId: "inbox" }, files: [] }, { profileId: "a1", title: "Geheimer Gedanke", now: 1000 });
  store.save("a1", { queue: [item], history: [] });
  const raw = readFileSync(join(dir, "a1.json"), "utf8");
  assert.doesNotMatch(raw, /Geheimer/, "encrypted at rest");
  assert.equal(JSON.parse(raw).encrypted, true);
  assert.deepEqual(store.load("a1").queue[0], item, "read back unchanged: the same key and boundary");
  assert.equal(store.encrypted(), true);
  // Without a key store: plain, and the settings say so.
  const plain = captureStore.createStore({ dir, cipher: { available: false } });
  plain.save("b2", { queue: [item] });
  assert.equal(JSON.parse(readFileSync(join(dir, "b2.json"), "utf8")).encrypted, false);
  assert.equal(plain.encrypted(), false);
  // An encrypted file without the key store is kept aside, never overwritten.
  assert.deepEqual(plain.load("a1"), { queue: [], history: [] });
  assert.ok(readdirSync(dir).some((f) => f.startsWith("a1.json.") && f.endsWith(".unreadable")), "kept for later");
  assert.throws(() => store.save("../x", { queue: [] }), /invalid profile id/);
  // Due, backoff, wake-up.
  assert.deepEqual(queueRules.dueItems([item], 999), []);
  assert.deepEqual(queueRules.dueItems([item], 1000), [item]);
  assert.deepEqual(queueRules.BACKOFF.slice(0, 3), [5_000, 15_000, 30_000]);
  assert.equal(queueRules.backoff(99), 900_000, "at most every 15 minutes");
  let queue = queueRules.afterFailure([item], item.id, { kind: "offline" }, 2000);
  assert.equal(queue[0].nextAt, 7000);
  assert.equal(queue[0].attempts, 1);
  assert.equal(queueRules.wakeUp(queue, 3000)[0].nextAt, 3000, "back online: due now");
  const refused = queueRules.afterFailure([item], item.id, { kind: "rejected", status: 404, detail: "Seite nicht gefunden." }, 2000);
  assert.equal(refused[0].failed, true, "refused for good: needs attention, stays");
  assert.equal(refused[0].lastError, "Seite nicht gefunden.");
  assert.deepEqual(queueRules.dueItems(refused, 1e12), []);
  assert.deepEqual(queueRules.summary(refused), { waiting: 0, failed: 1 });
  for (const kind of ["offline", "server", "signed-out", "in-progress"]) assert.equal(queueRules.retryable({ kind }), true, kind);
  assert.equal(queueRules.retryable({ kind: "rejected", status: 429 }), true);
  assert.equal(queueRules.retryable({ kind: "too-large" }), false);
  // Draining: a lost answer is retried with the same key and body; the
  // instance (lib/idempotency.ts) answers the retry from its store.
  const seen = [];
  const applied = new Map();
  let lose = true;
  const send = async (i) => {
    seen.push([i.key, JSON.stringify(i.payload)]);
    if (!applied.has(i.key)) applied.set(i.key, { kind: "record", pageId: INBOX, rowId: PAGE });
    if (lose) {
      lose = false;
      throw Object.assign(new Error("socket hang up"), { kind: "offline" });
    }
    return applied.get(i.key);
  };
  const second = queueRules.newItem({ fields: { text: "Zweite" }, files: [] }, { profileId: "a1", now: 1500 });
  let result = await queueRules.drain([item, second], send, { now: () => 5000 });
  assert.equal(result.sent.length, 0, "a connection error stops the round");
  assert.equal(result.queue.length, 2);
  result = await queueRules.drain(queueRules.wakeUp(result.queue, 6000), send, { now: () => 6000 });
  assert.deepEqual(result.sent.map((s) => s.item.id), [item.id, second.id], "oldest first");
  assert.deepEqual(result.queue, []);
  assert.equal(seen.filter(([key]) => key === item.key).length, 2, "the first was sent twice");
  assert.equal(new Set(seen.filter(([key]) => key === item.key).map(([, body]) => body)).size, 1, "with the same body");
  assert.equal(applied.size, 2, "and saved once each");
  // Limits: refused rather than dropping something older.
  const big = queueRules.newItem({ fields: {}, files: [{ name: "a", type: "image/png", data: "x".repeat(queueRules.MAX_QUEUED_BYTES + 1) }] }, { profileId: "a1" });
  assert.throws(() => queueRules.enqueue([], big), (e) => e.kind === "queue-full");
  assert.match(messageFor({ kind: "queue-full" }, { t }), /queue is full/);
  console.log("✔ Warteschlange ohne Verbindung: verschlüsselt, ohne Doppel");
}

// "Zuletzt erfasst" and "Rückgängig" for ten seconds.
{
  let history = [];
  for (let i = 0; i < 25; i++) history = historyRules.addEntry(history, { id: `e${i}`, title: `Notiz ${i}\u0007`, target: "Eingang", at: 1000 + i, url: `${server}/#page=${PAGE}`, undo: { kind: "record", pageId: PAGE, rowId: INBOX } });
  assert.equal(history.length, 20, "the last twenty");
  assert.equal(history[0].title, "Notiz 24", "newest first, cleaned");
  assert.equal(historyRules.canUndo(history[0], 1024 + 9_999), true);
  assert.equal(historyRules.canUndo(history[0], 1024 + 10_001), false, "ten seconds");
  history = historyRules.markUndone(history, "e24");
  assert.equal(historyRules.canUndo(history[0], 1024), false, "once");
  assert.equal(historyRules.visible(history)[0].id, "e23", "undone ones are not listed");
  // A queued one: undone by leaving the queue; sent, it gets its place.
  let queued = historyRules.addEntry([], { id: "q", title: "Offline", target: "Eingang", at: 5000, queued: true });
  assert.equal(historyRules.canUndo(queued[0], 5000), true);
  queued = historyRules.settle(queued, "q", { url: `${server}/#page=${INBOX}`, undo: { kind: "record", pageId: INBOX, rowId: PAGE } });
  assert.deepEqual([queued[0].queued, !!queued[0].url], [false, true]);
  assert.deepEqual(historyRules.markUndone(historyRules.addEntry([], { id: "q", title: "x", queued: true }), "q"), [], "a queued one undone is gone");
  console.log("✔ Zuletzt erfasst und Rückgängig");
}

// Quick actions: none active by default; checked; one shortcut, one action.
{
  assert.deepEqual(settings.settingsOf({}).captureActions, [], "only the main shortcut by default");
  const presets = actionRules.presets(t);
  assert.deepEqual(presets.map((p) => [p.name, p.shortcut]), [["Task", null], ["Journal entry", null], ["Bookmark", null], ["Meeting note", null]]);
  const list = actionRules.cleanActions(
    [
      { id: "task", kind: "task", name: "Aufgabe", shortcut: "Alt+Shift+T" },
      { id: "task", kind: "task", name: "Doppelt" },
      { id: "j", kind: "journal", name: "Journal", shortcut: "Alt+Shift+T", target: JOURNAL },
      { id: "m", kind: "template", name: "Besprechung", shortcut: "CmdOrCtrl+Shift+Space", target: PROJECTS, template: PAGE, prefix: "Besprechung: " },
      { id: "x", kind: "exec", name: "rm -rf" },
      { id: "BAD ID", kind: "note" },
      { id: "b", kind: "bookmark", shortcut: "Shift+B", target: "../x" },
    ],
    "CommandOrControl+Shift+Space",
  );
  assert.deepEqual(list.map((a) => [a.id, a.shortcut, a.target]), [["task", "Alt+Shift+T", "inbox"], ["j", null, JOURNAL], ["m", null, PROJECTS], ["b", null, "inbox"]], "a shortcut stays with the first, never the main one");
  assert.equal(actionRules.normalize("CmdOrCtrl+Shift+Space"), actionRules.normalize("Shift+CommandOrControl+Space"));
  assert.equal(actionRules.problemOf({ kind: "journal", target: null }), "journal", "a journal must be chosen");
  assert.equal(actionRules.problemOf({ kind: "template", target: null }), "database");
  assert.deepEqual(actionRules.presetFor(list[2]), { actionId: "m", kind: "template", name: "Besprechung", target: PROJECTS, template: PAGE, task: false, prefix: "Besprechung: ", paste: false });
  assert.equal(actionRules.presetFor({ ...list[3] }).paste, true, "a bookmark starts with the clipboard");
  assert.equal(actionRules.newActionId("task", list), "task-2");
  // The settings keep them; a new main shortcut wins over an action's.
  const saved = settings.applyPatch({ settings: { captureActions: [{ id: "a", kind: "note", shortcut: "Alt+Shift+N" }] } }, { captureShortcut: "Alt+Shift+N" });
  assert.equal(saved.captureActions[0].shortcut, null);
  console.log("✔ Schnellaktionen");
}

// First run and the one-time hint.
{
  assert.deepEqual(onboarding.setupDefaults("darwin"), { capture: true, captureShortcut: "CommandOrControl+Shift+Space", tray: true, launchAtLogin: false, startHidden: false });
  assert.deepEqual(onboarding.setupDefaults("win32"), { capture: true, captureShortcut: "CommandOrControl+Shift+Space", tray: false, launchAtLogin: false, startHidden: false }, "as today's settings defaults");
  assert.deepEqual(onboarding.setupPatch({ capture: false, tray: true, launchAtLogin: false, startHidden: true }, {}), { tray: true, launchAtLogin: false, startHidden: false, captureShortcut: null }, "hidden only with launch at login");
  assert.deepEqual(onboarding.setupPatch({ capture: true }, { captureShortcut: null }), { captureShortcut: "CommandOrControl+Shift+Space" });
  assert.deepEqual(onboarding.setupPatch({}, {}), {}, "skipped: nothing changes");
  // A new installation: the step after the first profile, then never the hint.
  let config = { profiles: [] };
  config = { ...config, onboarding: onboarding.afterFirstProfile(config, 0), profiles: [{ id: "a" }] };
  assert.equal(onboarding.showSetupStep(config), true);
  assert.equal(onboarding.showHint(config, { captureShortcut: "x" }), false);
  config = { ...config, onboarding: onboarding.setupFinished(config) };
  assert.equal(onboarding.showSetupStep(config), false);
  assert.equal(onboarding.showHint(config, { captureShortcut: "x" }), false);
  assert.equal(onboarding.afterFirstProfile({ onboarding: {} }, 1).setupPending, false, "a second profile: no step");
  // Someone from before: the hint, once; not after a capture or without a shortcut.
  const old = { profiles: [{ id: "a" }] };
  assert.equal(onboarding.showHint(old, { captureShortcut: "x" }), true);
  assert.equal(onboarding.showHint(old, { captureShortcut: null }), false);
  assert.equal(onboarding.showHint({ ...old, onboarding: onboarding.hintDismissed(old) }, { captureShortcut: "x" }), false);
  assert.equal(onboarding.showHint({ ...old, onboarding: onboarding.captureUsed(old) }, { captureShortcut: "x" }), false);
  assert.equal(onboarding.showHint({ server: "https://x.example" }, { captureShortcut: "x" }), true, "a single address of an old version counts");
  assert.equal(onboarding.showHint({}, { captureShortcut: "x" }), false, "nothing set up yet");
  console.log("✔ Einrichtung und einmaliger Hinweis");
}

// Screen regions and what the capture window's session may.
{
  assert.deepEqual(screenRules.screencaptureArgs("/tmp/x.png"), ["-i", "-x", "-t", "png", "/tmp/x.png"]);
  assert.equal(screenRules.permissionVerdict("granted"), "ok");
  assert.equal(screenRules.permissionVerdict("not-determined"), "ok", "the system asks");
  assert.equal(screenRules.permissionVerdict("denied"), "denied");
  assert.equal(screenRules.permissionVerdict("restricted"), "denied");
  assert.deepEqual(screenRules.regionFromDrag({ x: 300, y: 200 }, { x: 100, y: 50 }, { width: 1000, height: 800 }), { x: 100, y: 50, width: 200, height: 150 });
  assert.deepEqual(screenRules.regionFromDrag({ x: -20, y: 10 }, { x: 2000, y: 900 }, { width: 1000, height: 800 }), { x: 0, y: 10, width: 1000, height: 790 }, "inside the screen");
  assert.equal(screenRules.regionFromDrag({ x: 1, y: 1 }, { x: 3, y: 90 }, { width: 100, height: 100 }), null, "a click is no region");
  assert.deepEqual(screenRules.imageRect({ x: 10, y: 20, width: 100, height: 50 }, { width: 2000, height: 1600 }, { width: 1000, height: 800 }), { x: 20, y: 40, width: 200, height: 100 }, "at the display's scale");
  assert.match(screenRules.fileName(new Date(2026, 9, 26, 9, 5, 3)), /^Bildschirm 2026-10-26 09\.05\.03\.png$/);
  assert.equal(guards.capturePermissionAllowed("media", { mediaTypes: ["audio"] }, true), true, "the microphone for a voice note");
  assert.equal(guards.capturePermissionAllowed("media", { mediaTypes: ["video"] }, true), false, "never the camera");
  assert.equal(guards.capturePermissionAllowed("media", { mediaTypes: ["audio", "video"] }, true), false);
  assert.equal(guards.capturePermissionAllowed("display-capture", {}, true), false);
  assert.equal(guards.capturePermissionAllowed("notifications", {}, true), false);
  assert.equal(guards.capturePermissionAllowed("media", { mediaTypes: ["audio"] }, false), false, "only the capture window");
  console.log("✔ Bildschirmausschnitt und Mikrofon");
}

// The tray: captures waiting, recently captured.
{
  const items = trayItems({ capture: { queue: { waiting: 2, failed: 1 }, history: [{ id: "e1", title: "Angebot schreiben", target: "Eingang", queued: false }, { id: "e2", title: "x".repeat(80), target: "Projekte", queued: true }] }, profiles: [] }, t);
  assert.deepEqual(items.slice(0, 4).map((i) => i.id), ["tray-capture", "tray-capture-queue", "tray-capture-failed", "tray-captured"]);
  assert.equal(items[1].label, "2 waiting for a connection – send now");
  assert.equal(items[1].action, "send-queue");
  const recent = items[3].submenu;
  assert.deepEqual(recent.map((e) => [e.label.length <= 50, e.sublabel, e.value]), [[true, "Eingang", "e1"], [true, "Projekte", "e2"]]);
  assert.match(recent[1].label, /^⏳ /, "waiting ones marked");
  assert.ok(!trayItems({ capture: { queue: { waiting: 0, failed: 0 }, history: [] }, profiles: [] }, t).some((i) => i.id?.startsWith("tray-capture-") || i.id === "tray-captured"));
  console.log("✔ Symbol: Warteschlange und zuletzt erfasst");
}

// Quick capture against the stand-in: targets, preview, save with its key
// (JSON and multipart, the same bytes on a retry), undo, link preview,
// transcription, AI suggestion; an older instance without the endpoints.
{
  const instance = await standIn();
  const client = api.createInstanceApi({ origin: instance.origin, fetch });
  const targets = targetRules.normalizeTargets(await client.captureTargets());
  assert.deepEqual(targets.targets.map((x) => x.kind), ["database", "database", "document", "journal"]);
  const preview = await client.capturePreview({ targetId: "inbox", text: "Angebot morgen #kunde", today: "2026-10-26", literal: ["tag:#kunde"] });
  assert.deepEqual(preview.chips.map((c) => c.kind), ["date"], "a removed chip stays text");
  const item = queueRules.newItem({ fields: { targetId: PROJECTS, text: "Mit Bild", literal: ["date:morgen"], task: false, today: "2026-10-26" }, files: [{ name: "a.png", type: "image/png", data: PNG.toString("base64") }] }, { profileId: "a1" });
  const first = await client.captureSave(item);
  const again = await client.captureSave(item);
  assert.deepEqual(again, first, "a retry gets the stored answer");
  assert.equal(instance.state.saved.length, 1, "saved once");
  const [a, b] = instance.to("/api/capture/save");
  assert.equal(a.headers["idempotency-key"], item.key);
  assert.ok(a.body.equals(b.body), "byte for byte the same body");
  assert.equal(a.headers["content-type"], `multipart/form-data; boundary=${item.boundary}`);
  assert.deepEqual(instance.state.saved[0].fields.literal, '["date:morgen"]', "lists as JSON in multipart");
  assert.deepEqual(instance.state.saved[0].files.map((f) => f.name), ["a.png"]);
  const json = queueRules.newItem({ fields: { targetId: "inbox", text: "Nur Text", today: "2026-10-26" }, files: [] }, { profileId: "a1" });
  await client.captureSave(json);
  assert.match(instance.to("/api/capture/save").at(-1).headers["content-type"], /^application\/json/);
  assert.deepEqual(await client.captureUndo({ kind: "record", pageId: PROJECTS, rowId: first.rowId }), { undone: true });
  assert.deepEqual(await client.linkPreview("https://example.org/a"), { url: "https://example.org/a", title: "Ein guter Artikel", provider: "Example News", description: "Worum es geht", image: "" });
  assert.equal(instance.to("/api/embed")[0].query.url, "https://example.org/a", "the instance fetches, not the app");
  assert.deepEqual(await client.transcribe(INBOX, { name: "a.webm", type: "audio/webm", bytes: Buffer.alloc(10) }), { text: "Diktierter Gedanke" });
  await assert.rejects(client.transcribe("../x", { name: "a", type: "audio/webm", bytes: Buffer.alloc(1) }), (e) => e.kind === "no-inbox");
  assert.equal((await client.captureSuggest({ text: "Angebot", today: "2026-10-26" })).suggestion.targetId, PROJECTS);
  // 409 of a key still running: again shortly.
  instance.state.status["/api/capture/save"] = 409;
  await assert.rejects(client.captureSave(json), (e) => e.kind === "rejected" && e.status === 409);
  delete instance.state.status["/api/capture/save"];
  instance.state.legacy = true;
  assert.equal(await client.captureTargets(), null, "an older instance: only the inbox");
  await instance.stop();
  await assert.rejects(client.captureSave(json), (e) => e.kind === "offline" && queueRules.retryable(e));
  console.log("✔ Schnell erfassen gegen die Instanz");
}
console.log("features: ok");
