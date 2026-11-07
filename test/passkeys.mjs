// Passkeys in the running app (#165). On Windows (simulated here with
// FLOWPLAN_PASSKEYS=window – Windows Hello itself cannot run on a Linux
// runner) the bridge says passkeys sign in in the window: the instance's
// sign-in page runs its own WebAuthn – here against Chromium's virtual
// authenticator, through the same navigator.credentials.create/get that
// Windows hands to its WebAuthn API – and nothing opens in the browser.
// When the prompt fails or is cancelled, "Im Browser anmelden" still goes
// through the browser. Several passkeys from Chromium's own account choice
// are picked in a dialog, only for the instance. On macOS and Linux
// (FLOWPLAN_PASSKEYS=browser, the default there) passkeys stay in the
// browser as before. The stand-in's /login follows components/login.tsx.
// Usage: node test/passkeys.mjs (Linux without a display: xvfb-run)
import { _electron as electron } from "playwright";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import assert from "node:assert/strict";
import { standIn } from "./stand-in.mjs";

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
async function windowWith(app, test, timeout = 15000) {
  return until(async () => {
    for (const page of app.windows()) {
      if (page.isClosed()) continue;
      if (await page.evaluate(test).catch(() => false)) return page;
    }
    return null;
  }, String(test), timeout);
}

const instance = await standIn();
// Onboarding done: no setup step or hint in the way.
const onboarding = { setupDone: true, hintShown: true, hintDismissed: true };
async function launch(way) {
  const dir = mkdtempSync(join(tmpdir(), "flowplan-passkeys-"));
  writeFileSync(join(dir, "config.json"), JSON.stringify({ profiles: [{ id: "a1", name: "Work", server: instance.origin }], activeProfile: "a1", onboarding }));
  const env = { ...process.env, XDG_CONFIG_HOME: join(dir, "xdg"), FLOWPLAN_HINT_DELAY: "600000" };
  delete env.FLOWPLAN_PASSKEYS;
  if (way) env.FLOWPLAN_PASSKEYS = way;
  const app = await electron.launch({
    executablePath,
    args: [...(packaged ? [] : ["."]), `--user-data-dir=${dir}`],
    cwd: new URL("..", import.meta.url).pathname,
    env: { ...env, ...(packaged ? { FLOWPLAN_UPDATE_URL: `${instance.origin}/api/no-updates/` } : {}) },
  });
  // The browser and dialogs are recorded instead of opened.
  await app.evaluate(({ shell, dialog }) => {
    globalThis.opened = [];
    globalThis.dialogs = [];
    globalThis.answer = 1;
    shell.openExternal = async (url) => void globalThis.opened.push(url);
    dialog.showMessageBox = async (...args) => {
      const options = args.length > 1 ? args[1] : args[0];
      globalThis.dialogs.push({ message: options.message, detail: options.detail, buttons: options.buttons });
      return { response: globalThis.answer };
    };
  });
  const main = await windowWith(app, () => location.protocol === "http:" && !!document.getElementById("editor"));
  await main.evaluate((url) => location.assign(url), `${instance.origin}/login`);
  await main.waitForSelector("#buttons > *");
  return { app, main };
}
const opened = (app) => app.evaluate(() => globalThis.opened.slice());
const dialogs = (app) => app.evaluate(() => globalThis.dialogs.slice());
// A link the app catches: the navigation never happens, so no waiting for it.
const follow = (page, selector) => page.evaluate((selector) => document.querySelector(selector).click(), selector);
const waitingWindow = (app) => windowWith(app, () => location.protocol === "file:" && location.pathname.endsWith("sign-in.html"));
// "Abbrechen" in the waiting window; it closes.
async function cancelWaiting(app) {
  const waiting = await waitingWindow(app);
  await waiting.evaluate(() => document.getElementById("cancel").click()).catch(() => {});
  await until(() => waiting.isClosed(), "the waiting window closed");
}
// Chromium's own account choice, as Electron raises it on the profile's session.
const chooseAccount = (app, origin, accounts) =>
  app.evaluate(
    ({ BrowserWindow }, { origin, accounts }) =>
      new Promise((done) => {
        const ses = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().startsWith(origin)).webContents.session;
        if (!ses.listenerCount("select-webauthn-account")) return done("no listener");
        ses.emit("select-webauthn-account", {}, { relyingPartyId: new URL(origin).hostname, accounts, frame: { origin, url: `${origin}/login` } }, (id) => done(id ?? null));
      }),
    { origin, accounts },
  );

// ---- Windows: passkeys in the window ----
{
  const { app, main } = await launch("window");
  assert.equal(await main.evaluate(() => window.FlowplanDesktop.passkeys), "window", "the bridge says passkeys sign in here");
  assert.equal(await main.evaluate(() => window.isSecureContext && typeof PublicKeyCredential), "function", "the page has WebAuthn");
  assert.equal(await main.locator("#passkey").count(), 1, "the page's own passkey button");
  assert.equal(await main.locator("#passkey-link").count(), 0, "no hand-off link");

  // A platform authenticator with user verification – what Windows Hello is to the page.
  const cdp = await main.context().newCDPSession(main);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
  });

  // Settings → "Add a passkey": created in the window, for the instance's host.
  await main.click("#add-passkey");
  const registered = await until(() => main.evaluate(() => window.registered), "passkey created");
  assert.doesNotMatch(registered, /^failed/, registered);

  // "Mit Passkey anmelden": signed in with it, nothing went to the browser.
  await main.click("#passkey");
  const signedIn = await until(() => main.evaluate(() => window.signedIn), "signed in with the passkey");
  assert.equal(signedIn.id, registered);
  assert.equal(signedIn.rpId, "localhost", "the instance's own host is the relying party");
  assert.equal(instance.to("/api/auth/passkey").at(-1).headers.origin, instance.origin);
  assert.deepEqual(await opened(app), [], "no browser for a passkey in the window");
  assert.equal(await main.locator("#browser-fallback").count(), 0, "no fallback while it works");

  // Windows Hello cancelled (or failing): "Im Browser anmelden" – the hand-off as before.
  await main.evaluate(() => {
    navigator.credentials.get = () => Promise.reject(new DOMException("The operation either timed out or was not allowed.", "NotAllowedError"));
  });
  await main.click("#passkey");
  await main.waitForSelector("#browser-fallback");
  assert.equal(await main.textContent("#error"), "Passkey sign-in was cancelled.");
  assert.deepEqual(await opened(app), []);
  await follow(main, "#browser-fallback");
  const [url] = await until(async () => ((await opened(app)).length ? opened(app) : null), "the browser opened");
  assert.ok(url.startsWith(`${instance.origin}/api/auth/desktop?challenge=`), url);
  assert.equal(new URL(url).searchParams.get("via"), null, "a passkey sign-in, not SSO");
  assert.match(main.url(), /\/login$/, "the window stays on the sign-in page");
  await cancelWaiting(app);

  // Several passkeys from Chromium's own account choice: picked in a dialog.
  const accounts = [
    { credentialId: "cred-one", name: "alex@example.org", displayName: "Alex" },
    { credentialId: "cred-two", name: "", displayName: "Alex (work)" },
  ];
  assert.equal(await chooseAccount(app, instance.origin, accounts), "cred-two");
  const [asked] = await dialogs(app);
  assert.deepEqual(asked.buttons, ["alex@example.org", "Alex (work)", "Cancel"]);
  assert.match(asked.detail, /localhost/);
  await app.evaluate(() => (globalThis.answer = 2));
  assert.equal(await chooseAccount(app, instance.origin, accounts), null, "cancelled");
  assert.equal(await chooseAccount(app, instance.origin, accounts.slice(0, 1)), "cred-one", "one passkey: no question");
  // Another site in a frame of the window: cancelled, nothing asked.
  const before = (await dialogs(app)).length;
  assert.equal(
    await app.evaluate(
      ({ BrowserWindow }, origin) =>
        new Promise((done) => {
          const ses = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().startsWith(origin)).webContents.session;
          ses.emit("select-webauthn-account", {}, { relyingPartyId: "example.org", accounts: [{ credentialId: "x" }], frame: { origin: "https://example.org", url: "https://example.org/" } }, (id) => done(id ?? null));
        }),
      instance.origin,
    ),
    null,
  );
  assert.equal((await dialogs(app)).length, before);

  // SSO still goes to the browser.
  await main.evaluate(() => document.body.insertAdjacentHTML("beforeend", '<a id="sso" href="/api/auth/desktop?via=sso">SSO</a>'));
  await follow(main, "#sso");
  const sso = await until(async () => (await opened(app)).find((u) => u.includes("via=sso")), "SSO in the browser");
  assert.ok(sso.startsWith(`${instance.origin}/api/auth/desktop?`), sso);
  await cancelWaiting(app);
  await app.close();
}

// ---- macOS and Linux: passkeys in the browser, as before ----
for (const way of [undefined, "browser"]) {
  const { app, main } = await launch(way);
  if (process.platform !== "win32") assert.equal(await main.evaluate(() => window.FlowplanDesktop.passkeys), "browser", `${way}: the browser`);
  if (process.platform === "win32" && way === undefined) {
    await app.close();
    continue;
  }
  assert.equal(await main.locator("#passkey").count(), 0, "no passkey button in the window");
  await follow(main, "#passkey-link");
  const [url] = await until(async () => ((await opened(app)).length ? opened(app) : null), "the browser opened");
  assert.ok(url.startsWith(`${instance.origin}/api/auth/desktop?challenge=`), url);
  await cancelWaiting(app);
  assert.equal(await chooseAccount(app, instance.origin, [{ credentialId: "a" }, { credentialId: "b" }]), "no listener", "no account choice of the app's own");
  await app.close();
}

await instance.stop();
console.log("passkeys: ok");
