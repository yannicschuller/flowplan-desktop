// The decisions behind the right-click menu, quick capture, the tray, links
// to pages, page windows, dropped files, launch at login, printing and the
// update toast – with Node alone, no Electron. What the app asks an instance
// (instance-api.js) runs against a small stand-in instance (test/stand-in.mjs)
// with Node's fetch. Usage: node test/features.mjs
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { standIn, INBOX, WORKSPACE, SPACE, PAGE, TASK_PAGE, PNG, USER } from "./stand-in.mjs";

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
const { messageFor } = require("../capture.js");
strings.setLocale("en");
const { t } = strings;
const server = "https://flowplan.example.com";

// Settings: defaults per system, only valid values, unknown keys dropped.
{
  assert.deepEqual(settings.settingsOf({}, "darwin"), { tray: true, launchAtLogin: false, startHidden: false, captureShortcut: "CommandOrControl+Shift+Space", spellLanguages: ["de-DE", "en-US", "fr-FR"], deviceAi: true });
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
  assert.deepEqual(patched, { tray: true, launchAtLogin: false, startHidden: false, captureShortcut: settings.DEFAULT_SHORTCUT, spellLanguages: ["de-DE", "en-US", "fr-FR"], deviceAi: true }, "hidden only with launch at login");
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
console.log("features: ok");
