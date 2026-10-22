// Profiles in the running app: an old single address becomes the first
// profile, new profiles open in their own session (cookies never mix, not
// even for two profiles on the same instance), the menu switches, the window
// keeps to the active profile's instance, removing a profile deletes what its
// session stored, and --profile=<id> picks one at start. Two small stand-in
// instances are enough; no running Flowplan is needed.
// Usage: node test/profiles.mjs (Linux without a display: xvfb-run)
import { _electron as electron } from "playwright";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import assert from "node:assert/strict";

const require = createRequire(import.meta.url);
// FLOWPLAN_APP: path of a packaged app executable instead of the dev build.
const packaged = process.env.FLOWPLAN_APP;
const executablePath = packaged || require("electron");

// An instance that names itself and shows the cookies it receives.
function instance(label) {
  const server = createServer((req, res) => {
    if (req.url === "/api/health") {
      res.setHeader("Content-Type", "application/json");
      return res.end(JSON.stringify({ service: "flowplan" }));
    }
    if (req.url === "/set") {
      res.setHeader("Set-Cookie", `sid=${label}; Path=/; HttpOnly`);
      return res.end("ok");
    }
    res.setHeader("Content-Type", "text/html");
    res.end(`<!doctype html><title>Instance ${label}</title><h1>Instance ${label}</h1><p id="cookie">${req.headers.cookie || "none"}</p>`);
  });
  return new Promise((done) =>
    server.listen(0, "127.0.0.1", () =>
      done({
        origin: `http://localhost:${server.address().port}`,
        stop: () => new Promise((closed) => (server.close(closed), server.closeAllConnections())),
      }),
    ),
  );
}
const a = await instance("A");
const b = await instance("B");
const dir = mkdtempSync(join(tmpdir(), "flowplan-profiles-"));
const config = () => JSON.parse(readFileSync(join(dir, "config.json"), "utf8"));
writeFileSync(join(dir, "config.json"), JSON.stringify({ server: a.origin }));
const launch = (...args) =>
  electron.launch({
    executablePath,
    args: [...(packaged ? [] : ["."]), `--user-data-dir=${dir}`, ...args],
    cwd: new URL("..", import.meta.url).pathname,
  });
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
// The window that shows something matching `test` (after a switch the old
// window goes once the new one shows).
async function windowWith(app, test, timeout = 30000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    for (const page of app.windows()) {
      if (page.isClosed()) continue;
      const ok = await page.evaluate(test).catch(() => false);
      if (ok) return page;
    }
    await sleep(200);
  }
  throw new Error(`no window with ${test}`);
}
const showing = (text) => new Function(`return document.body && document.body.innerText.includes(${JSON.stringify(text)})`);
const clickMenu = (app, id) => app.evaluate(({ Menu }, id) => Menu.getApplicationMenu().getMenuItemById(id).click(), id);
const cookieIn = (page) => page.textContent("#cookie");
const windowCount = (app) => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);
async function oneWindow(app) {
  for (let i = 0; i < 50 && (await windowCount(app)) > 1; i++) await sleep(200);
  assert.equal(await windowCount(app), 1, "the previous profile's window is gone");
}
async function addProfile(app, name, origin) {
  await clickMenu(app, "add-profile");
  const setup = await windowWith(app, () => !!document.getElementById("form") && new URLSearchParams(location.search).get("add") === "1");
  await setup.fill("#server", origin);
  await setup.fill("#name", name);
  await setup.click("#submit");
}

let second, third;
{
  const app = await launch();
  let window = await windowWith(app, showing("Instance A"));
  // The single address became the first profile on the default session.
  assert.deepEqual(config().profiles, [{ id: "main", name: new URL(a.origin).host, server: a.origin, legacy: true }]);
  assert.equal(config().activeProfile, "main");
  console.log("✔ Einzelne Adresse wird erstes Profil");

  await window.evaluate(() => fetch("/set"));
  await window.reload();
  assert.equal(await cookieIn(window), "sid=A");
  // The menu offers the profiles in the system language.
  const label = await app.evaluate(({ Menu }) => Menu.getApplicationMenu().getMenuItemById("manage-profiles").label);
  assert.match(label, /^(Profile verwalten …|Manage Profiles…|Gérer les profils…)$/);

  // A second instance: its own session, nothing of A's cookies.
  await addProfile(app, "Privat", b.origin);
  window = await windowWith(app, showing("Instance B"));
  await oneWindow(app);
  assert.equal(await cookieIn(window), "none");
  await window.evaluate(() => fetch("/set"));
  second = config().profiles[1];
  assert.equal(second.name, "Privat");
  assert.equal(config().activeProfile, second.id);
  assert.equal(config().server, b.origin, "older versions find the active address");
  assert.equal(await window.evaluate(() => typeof window.flowplanDesktop), "undefined", "the instance has no bridge");
  // With two profiles the title names the profile.
  await sleep(300);
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getTitle()), "Instance B – Privat");
  console.log("✔ Neues Profil mit eigener Sitzung");

  // A third profile on the same instance as the first: a second account.
  await addProfile(app, "Zweites Konto", a.origin);
  window = await windowWith(app, () => document.title === "Instance A" && document.getElementById("cookie")?.textContent === "none");
  await oneWindow(app);
  third = config().profiles[2];
  console.log("✔ Zwei Profile auf derselben Instanz bleiben getrennt");

  // The window keeps to the active profile's instance: B opens in the
  // browser, not here.
  await app.evaluate(({ shell }) => {
    globalThis.opened = [];
    shell.openExternal = async (url) => void globalThis.opened.push(url);
  });
  await window.evaluate((url) => (location.href = url), `${b.origin}/`);
  await sleep(800);
  assert.equal(new URL(window.url()).origin, a.origin);
  assert.equal(await cookieIn(window), "none");
  assert.deepEqual(await app.evaluate(() => globalThis.opened), [`${b.origin}/`]);
  console.log("✔ Navigation bleibt beim aktiven Profil");

  // "Next Profile" (Ctrl/Cmd+Shift+P) wraps around to the first profile –
  // still signed in.
  const accelerator = await app.evaluate(({ Menu }) => Menu.getApplicationMenu().getMenuItemById("next-profile").accelerator);
  assert.equal(accelerator, "CmdOrCtrl+Shift+P");
  await clickMenu(app, "next-profile");
  window = await windowWith(app, () => document.getElementById("cookie")?.textContent === "sid=A");
  await oneWindow(app);
  assert.equal(config().activeProfile, "main");
  console.log("✔ Nächstes Profil per Menü");

  // Manage profiles: all three, the active one marked; rename in place.
  await clickMenu(app, "manage-profiles");
  window = await windowWith(app, () => document.querySelectorAll("#list li").length === 3);
  assert.equal(await window.getAttribute("#list li.active", "data-id"), "main");
  await window.fill('#list li[data-id="main"] input', "Arbeit");
  await window.dispatchEvent('#list li[data-id="main"] input', "change");
  for (let i = 0; i < 25 && config().profiles[0].name !== "Arbeit"; i++) await sleep(200);
  assert.equal(config().profiles[0].name, "Arbeit");
  const menuLabels = await app.evaluate(({ Menu }) => Menu.getApplicationMenu().getMenuItemById("manage-profiles").menu.items.map((i) => i.label));
  assert.ok(menuLabels.some((l) => l.startsWith("Arbeit – localhost:")), "the menu follows the new name");
  console.log("✔ Profile verwalten und umbenennen");

  // Removing B (after the confirmation) deletes what its session stored.
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBox = async () => ({ response: 0 });
  });
  const partition = `persist:profile-${second.id}`;
  const cookies = () => app.evaluate(({ session }, p) => session.fromPartition(p).cookies.get({}).then((c) => c.map((x) => x.value)), partition);
  assert.deepEqual(await cookies(), ["B"], "B's cookie lives in B's partition");
  await window.click(`#list li[data-id="${second.id}"] button.danger`);
  await windowWith(app, () => document.querySelectorAll("#list li").length === 2);
  assert.deepEqual(config().profiles.map((p) => p.id), ["main", third.id]);
  for (let i = 0; i < 25 && (await cookies()).length; i++) await sleep(200);
  assert.deepEqual(await cookies(), [], "its session is emptied");
  console.log("✔ Profil entfernen");
  await app.close();
}

// --profile=<id> at start picks a saved profile.
{
  const app = await launch(`--profile=${third.id}`);
  const window = await windowWith(app, () => document.title === "Instance A");
  assert.equal(await cookieIn(window), "none", "the second account's own session");
  assert.equal(config().activeProfile, third.id);
  await app.close();
  console.log("✔ --profile beim Start");
}
await a.stop();
await b.stop();
