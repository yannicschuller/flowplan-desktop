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
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import assert from "node:assert/strict";
import { standIn, PAGE, INBOX, PNG, PROJECTS } from "./stand-in.mjs";

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
// Screenshots of the capture window and the setup step (FLOWPLAN_SHOTS, or a temporary folder).
const shots = process.env.FLOWPLAN_SHOTS || mkdtempSync(join(tmpdir(), "flowplan-shots-"));
mkdirSync(shots, { recursive: true });
const xdg = join(dir, "xdg");
const config = () => JSON.parse(readFileSync(join(dir, "config.json"), "utf8"));
writeFileSync(
  join(dir, "config.json"),
  JSON.stringify({ profiles: [{ id: "a1", name: "Work", server: instance.origin }], activeProfile: "a1", settings: { tray: true, captureShortcut: "CommandOrControl+Alt+Shift+F9" } }),
);
const launch = () =>
  electron.launch({
    executablePath,
    // Chromium's fake microphone for the voice note.
    args: [...(packaged ? [] : ["."]), `--user-data-dir=${dir}`, "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
    cwd: new URL("..", import.meta.url).pathname,
    // A packaged app checks for updates: at a source that is not there.
    env: { ...process.env, XDG_CONFIG_HOME: xdg, FLOWPLAN_NOTIFICATION_INTERVAL: "2", FLOWPLAN_CAPTURE_TICK: "500", FLOWPLAN_HINT_DELAY: "300", ...(packaged ? { FLOWPLAN_UPDATE_URL: `${instance.origin}/api/no-updates/` } : {}) },
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

// Existing users after the update: one small hint in the corner, never again once closed.
const hintPage = () => windowWith(app, () => location.pathname.endsWith("hint.html") && !!document.getElementById("title").textContent);
{
  const hint = await hintPage();
  assert.equal(await hint.textContent("#title"), "New: quick capture with Ctrl+Alt+Shift+F9");
  await hint.screenshot({ path: join(shots, "hint.png") });
  assert.equal(config().onboarding.hintShown, true);
  await hint.click("#close");
  await until(() => config().onboarding.hintDismissed === true, "dismissed");
  await until(async () => !(await app.evaluate(({ webContents }) => webContents.getAllWebContents().some((c) => c.getURL().includes("hint.html")))), "gone");
  console.log("✔ Einmaliger Hinweis auf Schnell erfassen");
}

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

// Quick capture: the window, the target picker, chips, Enter saves with the
// profile's session (and an Idempotency-Key), Shift+Enter is a new line,
// "Rückgängig", the clipboard with a link, attachments, a screen region, a
// voice note, the AI suggestion, "Zuletzt erfasst", Esc closes.
const captureWindow = () => windowWith(app, () => !!document.getElementById("text") && location.pathname.endsWith("capture.html"));
const captureVisible = () => app.evaluate(({ BrowserWindow }) => !!BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().includes("capture.html"))?.isVisible());
const chipTexts = (capture) => capture.evaluate(() => [...document.querySelectorAll("#chips li")].map((li) => li.textContent));
{
  await clickMenu(app, "quick-capture");
  const capture = await captureWindow();
  await capture.waitForFunction(() => document.getElementById("target-name").textContent.includes("Work"));
  assert.match(await capture.textContent("#target-name"), /^Inbox · Eingang/, "the inbox by default");
  const props = await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().includes("capture.html"));
    return { onTop: w.isAlwaysOnTop(), visible: w.isVisible(), small: w.getBounds().height < 500, own: w.webContents.session.getStoragePath() === null };
  });
  assert.deepEqual(props, { onTop: true, visible: true, small: true, own: true }, "above other apps, its own in-memory session");
  await capture.fill("#text", "Erste Zeile");
  await capture.press("#text", "Shift+Enter");
  await capture.type("#text", "zweite Zeile");
  assert.equal(await capture.inputValue("#text"), "Erste Zeile\nzweite Zeile", "Shift+Enter: a new line");
  // The shorthand as chips; a removed chip stays text.
  await capture.fill("#text", "Angebot schreiben morgen 15 Uhr #kunde @anna !hoch");
  await until(async () => (await chipTexts(capture)).length === 4, "four chips");
  const texts = await chipTexts(capture);
  assert.match(texts[0], /^Fällig: Tue, Oct 27, 0?3:00\sPM×$/, "the due date in the window's language");
  assert.deepEqual(texts.slice(1), ["Tags: Kunde×", "Zuständig: Anna Schmidt×", "Priorität: Hoch×"]);
  await capture.screenshot({ path: join(shots, "capture-chips.png") });
  await capture.click('#chips li[data-id^="date:"] .chip-remove');
  await until(async () => (await chipTexts(capture)).length === 3, "the date chip removed");
  // Tab opens the picker; typing filters; Enter chooses.
  await capture.press("#text", "Tab");
  await capture.waitForSelector("#picker:not([hidden])");
  assert.equal(await capture.evaluate(() => document.activeElement.id), "picker-search");
  assert.deepEqual(await capture.$$eval("#picker-list li", (lis) => lis.map((li) => li.dataset.id)).then((ids) => ids.length), 4, "the inbox, the other database, a page, a journal");
  assert.match(await capture.textContent("#picker-note"), /^2 page\(s\) in end-to-end encrypted spaces/, "why encrypted pages are missing");
  await capture.type("#picker-search", "proj");
  await capture.screenshot({ path: join(shots, "capture-target-picker.png") });
  await capture.press("#picker-search", "Enter");
  await capture.waitForSelector("#picker", { state: "hidden" });
  assert.match(await capture.textContent("#target-name"), /^Projekte/);
  assert.equal(await capture.evaluate(() => document.activeElement.id), "text", "back in the text");
  assert.equal(instance.to("/api/capture/save").length, 0);
  await capture.press("#text", "Enter");
  await until(() => instance.state.saved.length === 1, "saved");
  const [request] = instance.to("/api/capture/save");
  assert.equal(request.headers.cookie, "sid=stand-in", "with the profile's session");
  assert.equal(request.headers.origin, instance.origin);
  assert.match(request.headers["idempotency-key"], /^[0-9a-f-]{36}$/, "every capture has its key");
  const fields = instance.state.saved[0].fields;
  assert.equal(fields.targetId, PROJECTS);
  assert.equal(fields.text, "Angebot schreiben morgen 15 Uhr #kunde @anna !hoch", "the text as typed; the instance reads it");
  assert.deepEqual(fields.literal, ["date:morgen 15 uhr"], "the removed chip stays text");
  assert.match(fields.today, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(fields.timeZone);
  // The toast: "Öffnen" and "Rückgängig".
  await capture.waitForSelector("#toast:not([hidden])");
  assert.equal(await capture.inputValue("#text"), "", "saved: the field is empty again");
  assert.equal(await capture.isVisible("#toast-undo"), true);
  assert.equal(await capture.isVisible("#toast-open"), true);
  await capture.screenshot({ path: join(shots, "capture-undo-toast.png") });
  await capture.click("#toast-undo");
  await until(() => instance.state.undone.length === 1, "undone");
  assert.deepEqual(instance.state.undone[0], { kind: "record", pageId: PROJECTS, rowId: instance.state.saved[0].rowId });
  await capture.waitForFunction(() => document.getElementById("status").textContent === "Undone.");
  // Recently used first: Projekte comes back next time.
  assert.deepEqual(config().captureRecent.a1, [PROJECTS]);
  // As a task for today, into the inbox (Alt+↑ from Projekte goes back to it).
  await capture.press("#text", "Alt+ArrowUp");
  assert.match(await capture.textContent("#target-name"), /^Inbox/);
  await capture.fill("#text", "Anrufen");
  await capture.check("#task");
  await capture.press("#text", "Enter");
  await until(() => instance.state.saved.length === 2, "the task");
  assert.equal(instance.state.saved[1].fields.task, true);
  assert.equal(instance.state.saved[1].fields.targetId, "inbox");
  await capture.waitForSelector("#toast:not([hidden])");
  // "Öffnen": the record in the main window.
  await capture.click("#toast-open");
  await until(async () => (await urls(app)).includes(`${instance.origin}/#page=${INBOX}&row=${instance.state.saved[1].rowId}`), "opened in Flowplan");
  assert.equal(await captureVisible(), false, "the window goes");
  // ↓ in the empty field: "Zuletzt erfasst" (the undone one is gone).
  await clickMenu(app, "quick-capture");
  await capture.press("#text", "ArrowDown");
  await capture.waitForSelector("#recent:not([hidden])");
  assert.deepEqual(await capture.$$eval("#recent-list li span", (s) => s.map((x) => x.textContent)), ["Anrufen"]);
  await capture.press("#text", "Escape");
  await capture.waitForSelector("#recent", { state: "hidden" });
  assert.equal(await captureVisible(), true, "Esc first closes the list");
  // The clipboard (Mod+Shift+V): a link, with the title from the instance's preview.
  await app.evaluate(({ clipboard }) => clipboard.writeText("https://example.org/artikel"));
  await capture.press("#text", "Control+Shift+V");
  await capture.waitForFunction(() => document.querySelector("#attachments .link")?.textContent.includes("Ein guter Artikel"));
  assert.ok(instance.to("/api/embed")[0].query.url === "https://example.org/artikel", "fetched by the instance, not the app");
  await app.evaluate(({ clipboard }) => clipboard.writeText("Text aus der Zwischenablage"));
  await capture.click("#paste");
  assert.equal(await capture.inputValue("#text"), "Text aus der Zwischenablage");
  // Files: "Anhängen …" with the same checks as files.js.
  const files = mkdtempSync(join(tmpdir(), "flowplan-capture-files-"));
  writeFileSync(join(files, "Foto.png"), PNG);
  writeFileSync(join(files, "Notiz.md"), "# Notiz");
  writeFileSync(join(files, "Falsch.png"), "<svg onload=alert(1)>");
  await app.evaluate(({ dialog }, paths) => (dialog.showOpenDialog = async () => ({ canceled: false, filePaths: paths })), ["Foto.png", "Notiz.md", "Falsch.png"].map((n) => join(files, n)));
  await capture.click("#attach");
  await until(async () => (await capture.$$eval("#attachments li", (l) => l.length)) === 3, "a link and two files");
  assert.match(await capture.textContent("#status"), /Falsch\.png: content does not match its extension/);
  // Remove one again.
  await capture.click('#attachments li:has-text("Notiz.md") .chip-remove');
  await until(async () => (await capture.$$eval("#attachments li", (l) => l.length)) === 2, "removed");
  // A screen region (Linux: the overlay with this screen).
  if (process.platform === "linux") {
    await capture.click("#screen");
    const overlay = await windowWith(app, () => location.pathname.endsWith("region.html"));
    await overlay.waitForFunction(() => document.getElementById("shot").naturalWidth > 0);
    await overlay.mouse.move(40, 40);
    await overlay.mouse.down();
    await overlay.mouse.move(240, 160, { steps: 4 });
    await overlay.mouse.up();
    await until(async () => (await capture.$$eval("#attachments li", (l) => l.length)) === 3, "the region attached");
    assert.match(await capture.textContent("#attachments"), /Bildschirm \d{4}-\d{2}-\d{2}/);
  }
  // A voice note (Chromium's fake microphone): the instance's transcript is the text.
  await capture.fill("#text", "");
  const voice = await capture.$("#voice");
  const box = await voice.boundingBox();
  await capture.mouse.move(box.x + 5, box.y + 5);
  await capture.mouse.down();
  await capture.waitForFunction(() => document.getElementById("voice").classList.contains("recording"));
  await sleep(1200);
  await capture.mouse.up();
  await capture.waitForFunction(() => document.getElementById("text").value.includes("Diktierter Gedanke"), null, { timeout: 15000 });
  assert.equal(instance.to("/api/transcribe").length, 1);
  assert.match(instance.to("/api/transcribe")[0].body.toString("latin1"), /name="pageId"\r\n\r\n33333333-3333-4333-8333-333333333333/, "into the target's page (the inbox)");
  // The AI suggestion: chips to accept, nothing applied by itself.
  await capture.click("#suggest");
  await capture.waitForSelector("#suggestion:not([hidden])");
  assert.match(await capture.textContent("#suggestion"), /AI suggestion \(from the instance's AI\)Into “Projekte”✓×Title: Angebot für Kunde schreiben✓×/);
  assert.match(await capture.textContent("#target-name"), /^Inbox/, "not applied by itself");
  await capture.click('#suggestion .capture-chip:has-text("Projekte") .chip-accept');
  assert.match(await capture.textContent("#target-name"), /^Projekte/);
  await capture.press("#text", "Enter");
  await until(() => instance.state.saved.length === 3, "with files");
  const withFiles = instance.state.saved[2];
  assert.equal(withFiles.fields.targetId, PROJECTS);
  assert.equal(withFiles.fields.url, "https://example.org/artikel");
  assert.equal(withFiles.fields.linkTitle, "Ein guter Artikel");
  assert.deepEqual(withFiles.files.map((f) => f.name).slice(0, 1), ["Foto.png"]);
  if (process.platform === "linux") assert.match(withFiles.files[1].name, /^Bildschirm .*\.png$/);
  assert.match(instance.to("/api/capture/save").at(-1).headers["content-type"], /^multipart\/form-data/);
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
  await until(async () => !(await captureVisible()), "Esc closes");
  // Esc keeps the draft.
  await clickMenu(app, "quick-capture");
  assert.equal(await capture.inputValue("#text"), "Bleibt hier", "a draft stays");
  await capture.fill("#text", "");
  await capture.press("#text", "Escape");
  console.log("✔ Schnell erfassen: Ziel, Kürzel, Rückgängig, Zwischenablage, Anhänge, Ausschnitt, Sprachnotiz, Vorschlag");
}

// Offline: the capture waits in the queue (window, tray), is sent once the
// instance is back – an answer lost on the way is retried with the same key,
// so the instance has it exactly once.
{
  await instance.stop();
  await clickMenu(app, "quick-capture");
  const capture = await captureWindow();
  await capture.fill("#text", "Offline notiert #kunde");
  await capture.press("#text", "Enter");
  await capture.waitForFunction(() => document.querySelector("#toast.queued") && !document.getElementById("toast").hidden);
  assert.match(await capture.textContent("#toast-text"), /^No connection to localhost:\d+ – queued/);
  assert.equal(await capture.inputValue("#text"), "", "in the queue, not lost");
  await capture.waitForFunction(() => document.getElementById("queue").textContent === "1 queued");
  await capture.screenshot({ path: join(shots, "capture-queued.png") });
  const queueFile = join(dir, "capture", "a1.json");
  assert.ok(existsSync(queueFile), "kept in the user data folder");
  const stored = JSON.parse(readFileSync(queueFile, "utf8"));
  assert.equal(stored.v, 1);
  if (stored.encrypted) assert.doesNotMatch(readFileSync(queueFile, "utf8"), /Offline notiert/, "encrypted at rest");
  const tray = await until(async () => (await app.evaluate(() => globalThis.seen.tray.at(-1)))?.find((i) => i.id === "tray-capture-queue"), "the tray shows it");
  assert.equal(tray.label, "1 waiting for a connection – send now");
  const before = instance.state.saved.length;
  // Back – and the first answer gets lost.
  instance.state.loseAnswer = true;
  await instance.start();
  await app.evaluate(({ powerMonitor }) => powerMonitor.emit("resume"));
  await until(() => instance.to("/api/capture/save").filter((r) => r.headers["idempotency-key"] && JSON.stringify(instance.state.saved.at(-1)?.fields || {}).includes("Offline notiert")).length >= 1, "sent once the instance is back", 30000);
  await app.evaluate(({ powerMonitor }) => powerMonitor.emit("resume"));
  await capture.waitForFunction(() => document.getElementById("queue").hidden, null, { timeout: 30000 });
  const attempts = instance.to("/api/capture/save").filter((r) => r.body.toString("utf8").includes("Offline notiert"));
  assert.ok(attempts.length >= 2, "retried after the lost answer");
  assert.equal(new Set(attempts.map((r) => r.headers["idempotency-key"])).size, 1, "with the same key");
  assert.equal(new Set(attempts.map((r) => r.body.toString("base64"))).size, 1, "and the same body");
  assert.equal(instance.state.saved.length, before + 1, "saved exactly once");
  assert.equal(JSON.parse(readFileSync(queueFile, "utf8")).v, 1);
  await until(async () => !(await app.evaluate(() => globalThis.seen.tray.at(-1)))?.some((i) => i.id === "tray-capture-queue"), "the tray is clear");
  const recent = (await app.evaluate(() => globalThis.seen.tray.at(-1))).find((i) => i.id === "tray-captured");
  assert.ok(recent.submenu.some((e) => e.label === "Offline notiert #kunde"), "Recently Captured in the tray");
  await capture.press("#text", "Escape");
  console.log("✔ Ohne Verbindung: Warteschlange, gesendet ohne Doppel");
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
  // Quick actions: none by default; with a shortcut one opens the window ready for it.
  assert.deepEqual(config().settings.captureActions || [], []);
  await settings.selectOption("#action-add", "task");
  await until(() => config().settings.captureActions?.length === 1, "an action");
  await settings.waitForSelector('.action-row[data-id="task"]');
  assert.equal(await settings.textContent('.action-row[data-id="task"] .action-status'), "No shortcut – not active");
  await settings.click('.action-row[data-id="task"] button:has-text("Change")');
  await settings.press('.action-row[data-id="task"] .action-shortcut', "Alt+Shift+F5");
  await until(() => config().settings.captureActions[0].shortcut === "Alt+Shift+F5", "its shortcut");
  assert.equal(await app.evaluate(({ globalShortcut }) => globalShortcut.isRegistered("Alt+Shift+F5")), true);
  await settings.waitForFunction(() => document.querySelector('.action-row[data-id="task"] .action-status').textContent === "Active");
  await settings.screenshot({ path: join(shots, "settings-quick-actions.png"), fullPage: true });
  await settings.click('.action-row[data-id="task"] button:has-text("Try it")');
  const preset = await windowWith(app, () => location.pathname.endsWith("capture.html") && !document.getElementById("action").hidden);
  assert.equal(await preset.textContent("#action"), "Quick action: Task");
  assert.equal(await preset.isChecked("#task"), true, "as a task");
  await preset.press("#text", "Escape");
  // A shortcut another app holds is reported for that action.
  const actions = config().settings.captureActions;
  const answer = await settings.evaluate((list) => window.flowplanDesktop.settings.set({ captureActions: [...list, { id: "bookmark", kind: "bookmark", name: "Lesezeichen", shortcut: "Alt+Shift+F7", target: "inbox" }] }), actions);
  assert.deepEqual(answer.actionStatus, { task: "ok", bookmark: "conflict" });
  await settings.reload();
  await settings.waitForFunction(() => document.querySelector('.action-row[data-id="bookmark"] .action-status')?.textContent === "Shortcut used by another app");
  // Removed: its shortcut is free again.
  await settings.evaluate(() => window.flowplanDesktop.settings.set({ captureActions: [] }));
  assert.equal(await app.evaluate(({ globalShortcut }) => globalShortcut.isRegistered("Alt+Shift+F5")), false);
  assert.match(await settings.textContent("#queue-storage"), /(encrypted with the system's key store|unencrypted in the app's data folder)/, "says how the queue is kept");
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
  await sleep(1200);
  assert.ok(!(await app.evaluate(({ webContents }) => webContents.getAllWebContents().some((c) => c.getURL().includes("hint.html")))), "the hint never comes back");
  // Closing one forgets it.
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().endsWith("/share/x")).close());
  await until(() => config().pageWindows?.a1?.length === 1, "forgotten").catch((e) => {
    console.log(JSON.stringify(config().pageWindows), urls);
    throw e;
  });
  console.log("✔ Seitenfenster nach Neustart");
}

// Without a connection after a restart: the capture waits in the queue.
{
  await instance.stop();
  await clickMenu(app, "quick-capture");
  const capture = await captureWindow();
  await capture.fill("#text", "Offline notiert nach Neustart");
  await capture.press("#text", "Enter");
  await capture.waitForFunction(() => document.getElementById("queue").textContent === "1 queued");
  console.log("✔ Ohne Verbindung bleibt nichts verloren");
}
await app.close();

// First run: after the instance is added and signed in, the setup's last
// step – its switches are the settings, all skippable; no hint afterwards.
{
  await instance.start();
  const fresh = mkdtempSync(join(tmpdir(), "flowplan-setup-"));
  const freshConfig = () => JSON.parse(readFileSync(join(fresh, "config.json"), "utf8"));
  app = await electron.launch({
    executablePath,
    args: [...(packaged ? [] : ["."]), `--user-data-dir=${fresh}`],
    cwd: new URL("..", import.meta.url).pathname,
    env: { ...process.env, XDG_CONFIG_HOME: join(fresh, "xdg"), FLOWPLAN_HINT_DELAY: "300", ...(packaged ? { FLOWPLAN_UPDATE_URL: `${instance.origin}/api/no-updates/` } : {}) },
  });
  await record(app);
  const setup = await windowWith(app, () => location.pathname.endsWith("setup.html") && !!document.getElementById("server") && !document.getElementById("connect").hidden);
  await setup.fill("#server", instance.origin);
  await setup.click("#submit");
  const step = await windowWith(app, () => new URLSearchParams(location.search).get("step") === "desktop" && document.getElementById("shortcut").value !== "", 20000);
  assert.equal(await step.textContent("h1:visible"), "How Flowplan should run on this computer");
  assert.equal(await step.isChecked("#capture"), true, "quick capture on by default");
  assert.equal(await step.inputValue("#shortcut"), process.platform === "darwin" ? "⌘⇧Space" : "Ctrl+Shift+Space");
  assert.equal(await step.isChecked("#tray"), process.platform === "darwin", "as the settings' default of this system");
  assert.equal(await step.isChecked("#launchAtLogin"), false);
  assert.equal(await step.isDisabled("#startHidden"), true, "only with launch at login");
  await step.screenshot({ path: join(shots, "setup-step.png"), fullPage: true });
  // A shortcut another app holds: reported, the previous one stays.
  await app.evaluate(({ globalShortcut }) => globalShortcut.register("Alt+Shift+F6", () => {}));
  await step.click("#record");
  await step.press("#shortcut", "Alt+Shift+F6");
  await step.waitForFunction(() => document.getElementById("shortcut-status").classList.contains("conflict"));
  assert.match(await step.textContent("#shortcut-status"), /Alt\+Shift\+F6 is already used by another app/);
  assert.equal(freshConfig().settings?.captureShortcut ?? "CommandOrControl+Shift+Space", "CommandOrControl+Shift+Space");
  // "Jetzt ausprobieren" opens the capture window.
  await step.click("#try");
  const capture = await windowWith(app, () => location.pathname.endsWith("capture.html") && !!document.getElementById("text"));
  await until(async () => app.evaluate(({ BrowserWindow }) => !!BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().includes("capture.html"))?.isVisible()), "the capture window");
  await capture.press("#text", "Escape");
  // The choices are the settings.
  await step.check("#tray");
  await until(() => freshConfig().settings?.tray === true, "tray on");
  await step.check("#launchAtLogin");
  await until(() => freshConfig().settings?.launchAtLogin === true, "launch at login");
  assert.equal(await step.isDisabled("#startHidden"), false);
  await step.check("#startHidden");
  await until(() => freshConfig().settings?.startHidden === true, "in the background");
  if (process.platform === "linux") assert.ok(existsSync(join(fresh, "xdg", "autostart", "flowplan.desktop")));
  await step.uncheck("#launchAtLogin");
  await until(() => freshConfig().settings?.launchAtLogin === false && freshConfig().settings?.startHidden === false, "both off again");
  await step.click("#done");
  await until(() => freshConfig().onboarding?.setupDone === true, "done");
  await until(async () => (await urls(app)).some((u) => u.startsWith(instance.origin)), "back at the instance");
  await sleep(1000);
  assert.ok(!(await app.evaluate(({ webContents }) => webContents.getAllWebContents().some((c) => c.getURL().includes("hint.html")))), "no hint after the setup");
  assert.ok(!(await urls(app)).some((u) => u.includes("step=desktop")), "the step does not come back");
  await app.close();
  console.log("✔ Einrichtung: So soll Flowplan auf diesem Computer laufen");
}
await instance.stop();
console.log("app: ok");
