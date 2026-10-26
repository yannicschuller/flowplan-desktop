// The desktop features in the running app, against a small stand-in instance
// (test/stand-in.mjs): the right-click menu (and that it stays out of the
// way where the page has its own), the bridge's spelling and windows, pages
// in windows of their own (remembered and restored), quick capture into the
// inbox with the profile's session, the tray menu with today's tasks,
// flowplan://open links (an unknown instance is asked about first), files
// handed to the app, the settings (launch at login writes the XDG autostart
// entry, a taken shortcut is reported), printing to PDF and the update
// toast instead of a dialog. Native menus and dialogs are recorded instead
// of shown. No running Flowplan is needed.
// Usage: node test/app.mjs (Linux without a display: xvfb-run)
import { _electron as electron } from "playwright";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import assert from "node:assert/strict";
import { standIn, PAGE, INBOX, PNG } from "./stand-in.mjs";

const require = createRequire(import.meta.url);
const packaged = process.env.FLOWPLAN_APP;
const executablePath = packaged || require("electron");
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
async function until(test, what, timeout = 15000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const value = await test();
    if (value) return value;
    await sleep(150);
  }
  throw new Error(`timed out: ${what}`);
}

const instance = await standIn();
const dir = mkdtempSync(join(tmpdir(), "flowplan-app-"));
const xdg = join(dir, "xdg");
const config = () => JSON.parse(readFileSync(join(dir, "config.json"), "utf8"));
writeFileSync(
  join(dir, "config.json"),
  JSON.stringify({ profiles: [{ id: "a1", name: "Work", server: instance.origin }], activeProfile: "a1", settings: { tray: true, captureShortcut: "CommandOrControl+Alt+Shift+F9" } }),
);
const launch = () =>
  electron.launch({
    executablePath,
    args: [...(packaged ? [] : ["."]), `--user-data-dir=${dir}`],
    cwd: new URL("..", import.meta.url).pathname,
    // A packaged app checks for updates: at a source that is not there.
    env: { ...process.env, XDG_CONFIG_HOME: xdg, FLOWPLAN_NOTIFICATION_INTERVAL: "2", ...(packaged ? { FLOWPLAN_UPDATE_URL: `${instance.origin}/api/no-updates/` } : {}) },
  });
// Records native menus, dialogs and the app's events instead of showing them.
async function record(app) {
  await app.evaluate(({ app, Menu, dialog }) => {
    globalThis.seen = { menus: [], contextMenus: [], tray: [], dialogs: [], errors: [], updates: [], pageWindows: [], files: [], filesDone: [], captured: [], links: [], notices: [] };
    globalThis.answer = 2;
    Menu.prototype.popup = function () {
      globalThis.seen.menus.push(this);
    };
    app.on("flowplan-context-menu", ({ items }) => globalThis.seen.contextMenus.push(items));
    app.on("flowplan-tray", (items) => globalThis.seen.tray.push(items));
    app.on("flowplan-update", (state) => globalThis.seen.updates.push(state));
    app.on("flowplan-page-window", ({ url }) => globalThis.seen.pageWindows.push(url));
    app.on("flowplan-files", (files) => globalThis.seen.files.push(files));
    app.on("flowplan-files-done", (done) => globalThis.seen.filesDone.push(done));
    app.on("flowplan-captured", (result) => globalThis.seen.captured.push(result));
    app.on("flowplan-link-asked", (asked) => globalThis.seen.links.push(asked));
    app.on("flowplan-notice", (notice) => globalThis.seen.notices.push(notice));
    dialog.showMessageBox = async (...args) => {
      const options = args.length > 1 ? args[1] : args[0];
      globalThis.seen.dialogs.push({ message: options.message, detail: options.detail, buttons: options.buttons });
      return { response: globalThis.answer };
    };
    dialog.showErrorBox = (title, content) => globalThis.seen.errors.push({ title, content });
  });
}
const seen = (app, key) => app.evaluate((_e, key) => globalThis.seen[key].length, key);
const lastContextMenu = (app) => app.evaluate(() => globalThis.seen.contextMenus.at(-1)?.map((i) => i.id || "-"));
const clickMenu = (app, id) => app.evaluate(({ Menu }, id) => Menu.getApplicationMenu().getMenuItemById(id).click(), id);
// A window whose page passes `test`.
async function windowWith(app, test, timeout = 15000) {
  return until(async () => {
    for (const page of app.windows()) {
      if (page.isClosed()) continue;
      if (await page.evaluate(test).catch(() => false)) return page;
    }
    return null;
  }, String(test), timeout);
}
const windowCount = (app) => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed()).length);
const urls = (app) => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((w) => w.webContents.getURL()));

let app = await launch();
await record(app);
let main = await windowWith(app, () => !!document.getElementById("editor"));
await main.evaluate(() => fetch("/set"));
await main.reload();
await main.waitForSelector("#editor");

// The right-click menu: none where the page shows its own (Flowplan's
// editor), the native one elsewhere.
{
  await main.click("#editor", { button: "right" });
  await sleep(700);
  assert.equal(await main.evaluate(() => window.webMenu), 1, "the page's own menu");
  assert.equal(await seen(app, "contextMenus"), 0, "Electron does not ask for a menu the page handled");
  await main.click("#field", { button: "right" });
  await until(() => seen(app, "contextMenus"), "menu for the field");
  const field = await lastContextMenu(app);
  for (const id of ["cut", "copy", "paste", "paste-plain", "select-all", "spelling-languages"]) assert.ok(field.includes(id), id);
  assert.equal(field.includes("inspect"), !packaged, "Inspect Element outside the packaged app only");
  await main.click("#own", { button: "right" });
  await until(async () => (await lastContextMenu(app)).includes("link-window"), "menu for a link");
  assert.deepEqual((await lastContextMenu(app)).slice(0, 3), ["link-window", "link-open", "link-copy"]);
  await main.click("#other", { button: "right" });
  await until(async () => (await lastContextMenu(app))[0] === "link-open", "menu for another site");
  assert.ok(!(await lastContextMenu(app)).includes("link-window"));
  await main.click("#image", { button: "right" });
  await until(async () => (await lastContextMenu(app)).includes("image-copy"), "menu for an image");
  assert.ok((await lastContextMenu(app)).includes("image-save"));
  // A misspelled word (the dictionaries are downloaded by Chromium, which CI
  // cannot: the parameters as Chromium reports them).
  const menu = await app.evaluate(({ BrowserWindow }) => {
    const before = globalThis.seen.menus.length;
    const w = BrowserWindow.getAllWindows().find((x) => /localhost/.test(x.webContents.getURL()));
    w.webContents.emit("context-menu", { preventDefault() {} }, { x: 10, y: 10, isEditable: true, misspelledWord: "Flowplanung", dictionarySuggestions: ["Flowplan", "Planung"], editFlags: { canPaste: true } });
    const native = globalThis.seen.menus[before];
    return native.items.map((i) => i.label);
  });
  assert.deepEqual(menu.slice(0, 2), ["Flowplan", "Planung"], "the suggestions first");
  // "Add to Dictionary" adds to the profile's own session.
  await app.evaluate(({ BrowserWindow }) => {
    const items = globalThis.seen.menus.at(-1).items;
    items[2].click();
  });
  const words = () => app.evaluate(({ session }) => session.fromPartition("persist:profile-a1").listWordsInSpellCheckerDictionary());
  await until(async () => (await words()).includes("Flowplanung"), "word in the dictionary");
  // The languages of the spell checker: saved, applied to the sessions.
  await app.evaluate(() => globalThis.seen.menus.at(-1).items.find((i) => i.submenu).submenu.items[2].click());
  await until(() => !config().settings.spellLanguages.includes("fr-FR"), "French off");
  assert.deepEqual(await app.evaluate(({ session }) => session.fromPartition("persist:profile-a1").getSpellCheckerLanguages()), ["de-DE", "en-US"]);
  console.log("✔ Kontextmenü, nicht über dem Menü des Editors");
}

// The instance's bridge: spelling from the page's spell checker, a word for
// the dictionary only when it is one, windows only for its own pages, and a
// drop the person did not make does nothing.
{
  const check = await main.evaluate(() => window.FlowplanDesktop.spelling.check("Haus"));
  assert.deepEqual(Object.keys(check).sort(), ["misspelled", "suggestions"]);
  assert.equal(await main.evaluate(() => window.FlowplanDesktop.spelling.addWord("two words")), false);
  assert.equal(await main.evaluate(() => window.FlowplanDesktop.spelling.addWord("Fluxplan")), true);
  assert.equal(await main.evaluate(() => typeof window.flowplanDesktop), "undefined", "no app bridge on the instance");
  const before = await windowCount(app);
  await main.evaluate(() => window.FlowplanDesktop.openWindow("https://evil.example/"));
  await main.evaluate((origin) => window.FlowplanDesktop.openWindow(`${origin}/api/export/x`), instance.origin);
  await sleep(500);
  assert.equal(await windowCount(app), before, "no window for other sites or endpoints");
  await main.evaluate(() => {
    const data = new DataTransfer();
    data.items.add(new File(["x"], "a.md"));
    window.dispatchEvent(new DragEvent("drop", { dataTransfer: data, bubbles: true, cancelable: true }));
  });
  await sleep(500);
  assert.equal(await seen(app, "files"), 0, "a synthetic drop is not the person's");
  console.log("✔ Brücke der Instanz");
}

// Pages in windows of their own: Shift-click, the bridge; remembered.
{
  await main.click("#own", { modifiers: ["Shift"] });
  await until(() => seen(app, "pageWindows"), "a page window");
  assert.equal(await app.evaluate(() => globalThis.seen.pageWindows[0]), `${instance.origin}/#page=${PAGE}`);
  await main.evaluate((origin) => window.FlowplanDesktop.openWindow(`${origin}/share/x`), instance.origin);
  await until(async () => (await seen(app, "pageWindows")) === 2, "a second page window");
  await until(() => config().pageWindows?.a1?.length === 2, "remembered");
  assert.deepEqual(config().pageWindows.a1.map((w) => w.url), [`${instance.origin}/#page=${PAGE}`, `${instance.origin}/share/x`]);
  assert.ok(config().pageWindows.a1[0].bounds.width >= 380);
  // The page windows have the profile's session and the bridge.
  const pageWindow = await windowWith(app, () => location.hash.includes("page=") && !!window.FlowplanDesktop);
  assert.equal(await pageWindow.evaluate(() => fetch("/api/notifications").then((r) => r.ok)), true);
  console.log("✔ Seiten in eigenen Fenstern");
}

// Quick capture: the window, Enter saves with the profile's session, Shift+Enter
// is a new line, Esc closes.
{
  await clickMenu(app, "quick-capture");
  const capture = await windowWith(app, () => !!document.getElementById("text") && location.protocol === "file:");
  await capture.waitForFunction(() => document.getElementById("target").textContent.includes("Work"));
  const props = await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().includes("capture.html"));
    return { onTop: w.isAlwaysOnTop(), visible: w.isVisible(), frame: w.getBounds().height < 400 };
  });
  assert.deepEqual(props, { onTop: true, visible: true, frame: true });
  await capture.fill("#text", "Erste Zeile");
  await capture.press("#text", "Shift+Enter");
  await capture.type("#text", "zweite Zeile");
  assert.equal(await capture.inputValue("#text"), "Erste Zeile\nzweite Zeile", "Shift+Enter: a new line");
  assert.equal(instance.to("/api/command").length, 0);
  await capture.press("#text", "Enter");
  await until(() => instance.to("/api/command").length === 1, "the capture command");
  const [command] = instance.to("/api/command");
  assert.equal(command.headers.cookie, "sid=stand-in", "with the profile's session");
  assert.equal(command.headers.origin, instance.origin);
  assert.deepEqual(JSON.parse(command.body).title, "Erste Zeile");
  assert.equal(JSON.parse(command.body).pageId, INBOX);
  await capture.waitForFunction(() => document.getElementById("status").classList.contains("ok"));
  assert.equal(await capture.inputValue("#text"), "", "saved: the field is empty again");
  await until(() => app.evaluate(({ BrowserWindow }) => !BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().includes("capture.html")).isVisible()), "the window goes after the confirmation");
  // As a task for today.
  await clickMenu(app, "quick-capture");
  await capture.fill("#text", "Anrufen");
  await capture.check("#task");
  await capture.press("#text", "Enter");
  await until(() => instance.to("/api/command").length === 2, "the task");
  assert.match(JSON.parse(instance.to("/api/command")[1].body).article, /data-type="taskItem" data-checked="false" data-due="\d{4}-\d{2}-\d{2}"/);
  // Signed out: said so, the text stays.
  instance.state.signedOut = true;
  await clickMenu(app, "quick-capture");
  await capture.fill("#text", "Bleibt hier");
  await capture.press("#text", "Enter");
  await capture.waitForFunction(() => document.getElementById("status").classList.contains("error"));
  assert.match(await capture.textContent("#status"), /localhost/);
  assert.equal(await capture.inputValue("#text"), "Bleibt hier", "the text stays");
  instance.state.signedOut = false;
  await capture.press("#text", "Escape");
  await until(() => app.evaluate(({ BrowserWindow }) => !BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().includes("capture.html")).isVisible()), "Esc closes");
  console.log("✔ Schnell erfassen");
}

// The tray: today's tasks of the active profile, unread notifications.
{
  // A window in front reads the tasks again after an error (signed out above).
  await main.bringToFront();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => /localhost/.test(w.webContents.getURL())).focus());
  const tray = await until(async () => {
    const items = await app.evaluate(() => globalThis.seen.tray.at(-1));
    return items && items.some((i) => i.id === "tray-task") && items.find((i) => i.id === "tray-inbox").label.match(/2/) ? items : null;
  }, "tray with tasks and unread count", 20000).catch(async (e) => {
    console.log(JSON.stringify(await app.evaluate(() => globalThis.seen.tray.map((items) => items.map((i) => i.label)))));
    throw e;
  });
  const tasks = tray.filter((i) => i.id === "tray-task").map((i) => i.label);
  assert.deepEqual(tasks.map((l) => l.replace(/^\S+ /, "")), ["Überfällig", "Angebot schicken"], "due today or overdue, oldest first");
  assert.ok(tray.some((i) => i.id === "tray-capture"));
  assert.ok(tray.some((i) => i.id === "tray-quit"));
  console.log("✔ Symbol mit Aufgaben von heute");
}

// flowplan://open: a page of a known instance; an unknown one is asked about.
{
  await app.evaluate(({ app }, link) => app.emit("second-instance", {}, ["flowplan", link], "/"), `flowplan://open?instance=${encodeURIComponent(instance.origin)}&page=${INBOX}`);
  await until(async () => (await urls(app)).includes(`${instance.origin}/#page=${INBOX}`), "the linked page");
  const before = config().profiles.length;
  await app.evaluate(() => (globalThis.answer = 2));
  await app.evaluate(({ app }) => app.emit("second-instance", {}, ["flowplan", "flowplan://open?instance=https%3A%2F%2Funknown.example&page=44444444-4444-4444-8444-444444444444"], "/"));
  await until(() => seen(app, "links"), "asked");
  assert.deepEqual(await app.evaluate(() => globalThis.seen.links[0]), { origin: "https://unknown.example", response: 2 });
  assert.ok(!(await urls(app)).some((u) => u.includes("unknown.example")), "nothing opened without consent");
  assert.equal(config().profiles.length, before);
  // Not a page: ignored.
  await app.evaluate(({ app }) => app.emit("second-instance", {}, ["flowplan", "flowplan://open?instance=javascript:alert(1)"], "/"));
  await sleep(300);
  assert.equal(await seen(app, "links"), 1);
  console.log("✔ Links flowplan://open");
}

// Files handed to the app: checked, confirmed, then into the inbox or as pages.
{
  const files = mkdtempSync(join(tmpdir(), "flowplan-files-"));
  writeFileSync(join(files, "Notiz.md"), "# Notiz\n\nText");
  writeFileSync(join(files, "Foto.png"), PNG);
  writeFileSync(join(files, "Falsch.png"), "<svg onload=alert(1)>");
  const argv = ["flowplan", join(files, "Notiz.md"), join(files, "Foto.png"), join(files, "Falsch.png")];
  // Cancelled: nothing is sent.
  await app.evaluate(() => (globalThis.answer = 2));
  await app.evaluate(({ app }, argv) => app.emit("second-instance", {}, argv, "/"), argv);
  await until(() => seen(app, "files"), "checked");
  assert.deepEqual(await app.evaluate(() => globalThis.seen.files[0]), { accepted: ["Notiz.md", "Foto.png"], refused: [["Falsch.png", "content"]] });
  const asked = await app.evaluate(() => globalThis.seen.dialogs.at(-1));
  assert.match(asked.detail, /Notiz\.md[\s\S]*Foto\.png[\s\S]*✕ Falsch\.png/);
  await sleep(500);
  assert.equal(instance.to("/api/upload").length, 0, "nothing sent before the person agreed");
  // Into the inbox.
  await app.evaluate(() => (globalThis.answer = 0));
  await app.evaluate(({ app }, argv) => app.emit("second-instance", {}, argv, "/"), argv);
  await until(() => seen(app, "filesDone"), "into the inbox");
  assert.equal(instance.to("/api/upload").length, 1);
  assert.equal(instance.to(/import-markdown$/).length, 1);
  assert.match(JSON.parse(instance.to("/api/command").at(-1).body).article, /<img src="\/api\/files\/f1"/);
  // As new pages.
  await app.evaluate(() => (globalThis.answer = 1));
  await app.evaluate(({ app }, argv) => app.emit("second-instance", {}, argv, "/"), argv.slice(0, 2));
  await until(async () => (await seen(app, "filesDone")) === 2, "as pages");
  assert.ok(instance.to("/api/import/source")[0].body.includes("PK\u0003\u0004"));
  await until(async () => (await urls(app)).includes(`${instance.origin}/#page=${PAGE}`), "the new page opens");
  console.log("✔ Dateien übernehmen");
}

// Settings: tray, launch at login (XDG autostart on Linux), the shortcut.
{
  await clickMenu(app, "settings");
  const settings = await windowWith(app, () => location.pathname.endsWith("settings.html") && !!document.getElementById("tray"));
  await settings.waitForFunction(() => document.getElementById("shortcut").value !== "");
  assert.equal(await settings.isChecked("#tray"), true);
  const data = await settings.evaluate(() => window.flowplanDesktop.settings.get());
  assert.equal(data.shortcutStatus, "ok");
  if (process.platform === "linux") {
    const file = join(xdg, "autostart", "flowplan.desktop");
    await settings.check("#launchAtLogin");
    await until(() => existsSync(file), "autostart entry");
    await settings.check("#startHidden");
    await until(() => readFileSync(file, "utf8").includes('"--hidden"'), "hidden start");
    // Electron with the app's folder (npm start) or the app itself, then --hidden.
    assert.match(readFileSync(file, "utf8"), packaged ? /^Exec="[^"]+" "--hidden"$/m : /^Exec="[^"]+" "[^"]+" "--hidden"$/m);
    await settings.uncheck("#launchAtLogin");
    await until(() => !existsSync(file), "removed again");
    assert.equal(config().settings.startHidden, false);
  }
  // A shortcut another app holds is reported and not kept.
  await app.evaluate(({ globalShortcut }) => globalShortcut.register("Alt+Shift+F7", () => {}));
  const taken = await settings.evaluate(() => window.flowplanDesktop.settings.set({ captureShortcut: "Alt+Shift+F7" }).then(() => "saved", (e) => e.message));
  assert.match(taken, /Alt\+Shift\+F7/);
  assert.equal(config().settings.captureShortcut, "CommandOrControl+Alt+Shift+F9", "the previous one stays");
  assert.equal(await app.evaluate(({ globalShortcut }) => globalShortcut.isRegistered("CommandOrControl+Alt+Shift+F9")), true);
  await settings.evaluate(() => window.flowplanDesktop.settings.set({ captureShortcut: "Alt+Shift+F8" }));
  assert.equal(config().settings.captureShortcut, "Alt+Shift+F8");
  assert.deepEqual(await app.evaluate(({ globalShortcut }) => [globalShortcut.isRegistered("Alt+Shift+F8"), globalShortcut.isRegistered("CommandOrControl+Alt+Shift+F9")]), [true, false]);
  await settings.click("#off");
  await until(() => config().settings.captureShortcut === null, "switched off");
  assert.equal(await app.evaluate(({ globalShortcut }) => globalShortcut.isRegistered("Alt+Shift+F8")), false);
  // Values the page cannot set.
  await settings.evaluate(() => window.flowplanDesktop.settings.set({ spellLanguages: ["xx"], tray: "yes", partition: "persist:x" }));
  assert.ok(!("partition" in config().settings));
  assert.equal(config().settings.tray, true);
  await settings.click("#tray");
  await until(() => config().settings.tray === false, "tray off");
  await settings.close();
  // The menu switches the shortcut on again (the default) and picks languages.
  await clickMenu(app, "capture-shortcut");
  await until(() => config().settings.captureShortcut === "CommandOrControl+Shift+Space", "shortcut on from the menu");
  assert.equal(await app.evaluate(({ Menu }) => Menu.getApplicationMenu().getMenuItemById("capture-shortcut").checked), true);
  await clickMenu(app, "menu-spell-fr-FR");
  await until(() => config().settings.spellLanguages.includes("fr-FR"), "French again from the menu");
  console.log("✔ Einstellungen");
}

// Printing: Save as PDF writes the page (print stylesheet), Print shows a preview.
{
  const pdf = join(dir, "page.pdf");
  await app.evaluate(({ dialog }, pdf) => (dialog.showSaveDialog = async () => ({ canceled: false, filePath: pdf })), pdf);
  await main.bringToFront();
  await clickMenu(app, "save-pdf");
  await until(() => existsSync(pdf) && readFileSync(pdf).length > 500, "PDF written");
  assert.equal(readFileSync(pdf).subarray(0, 5).toString(), "%PDF-");
  const before = await windowCount(app);
  await clickMenu(app, "print");
  await until(async () => (await urls(app)).some((u) => u.startsWith("file:") && u.endsWith(".pdf")), "print preview");
  assert.equal(await windowCount(app), before + 1);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().endsWith(".pdf")).close());
  console.log("✔ Drucken und PDF");
}

// Updates: an answer in the toast, never a dialog.
{
  const dialogs = await seen(app, "dialogs");
  await clickMenu(app, "check-updates");
  // npm start does not update itself; the packaged app cannot reach the source.
  const state = await until(async () => {
    const last = await app.evaluate(() => globalThis.seen.updates.at(-1));
    return last && ["not-installed", "error"].includes(last.phase) ? last : null;
  }, "update state", 45000);
  assert.equal(state.phase, packaged ? "error" : "not-installed");
  assert.ok(state.view, "shown, since asked from the menu");
  if (packaged) assert.ok(instance.to(/\/api\/no-updates\//).length, "asked the given source");
  const toast = await until(() => app.evaluate(({ webContents }) => webContents.getAllWebContents().find((c) => c.getURL().includes("update.html"))?.id), "the toast");
  const text = await until(() => app.evaluate(({ webContents }, id) => webContents.fromId(id).executeJavaScript("document.getElementById('title').textContent"), toast), "toast text");
  assert.equal(text, state.view.title);
  assert.equal(await seen(app, "dialogs"), dialogs, "no dialog");
  // Its button hides it.
  await app.evaluate(({ webContents }, id) => webContents.fromId(id).executeJavaScript("document.querySelector('[data-action=ok]').click()"), toast);
  await until(async () => (await app.evaluate(() => globalThis.seen.updates.at(-1))).view === null, "hidden");
  console.log("✔ Update-Hinweis statt Dialog");
}

// Page windows come back after a restart.
{
  await app.close();
  app = await launch();
  await record(app);
  await until(async () => (await urls(app)).filter((u) => u.startsWith(instance.origin)).length >= 3, "main window and two page windows");
  assert.ok((await urls(app)).includes(`${instance.origin}/share/x`));
  // Closing one forgets it.
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().endsWith("/share/x")).close());
  await until(() => config().pageWindows?.a1?.length === 1, "forgotten").catch((e) => {
    console.log(JSON.stringify(config().pageWindows), urls);
    throw e;
  });
  console.log("✔ Seitenfenster nach Neustart");
}

// Without a connection: quick capture says so and keeps the text.
{
  await instance.stop();
  await clickMenu(app, "quick-capture");
  const capture = await windowWith(app, () => !!document.getElementById("text") && location.protocol === "file:");
  await capture.fill("#text", "Offline notiert");
  await capture.press("#text", "Enter");
  await capture.waitForFunction(() => document.getElementById("status").classList.contains("error"));
  assert.equal(await capture.inputValue("#text"), "Offline notiert");
  console.log("✔ Ohne Verbindung bleibt der Text");
}
await app.close();
console.log("app: ok");
