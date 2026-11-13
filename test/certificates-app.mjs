// Self-signed certificates in the running app (#271), against a small HTTPS
// stand-in with a certificate no system trusts: adding it asks first (Cancel
// adds nothing), trusting pins exactly that certificate for that host, the
// pin applies to no other host, a changed certificate is refused with a
// warning naming both fingerprints until the person trusts the new one, and
// the profiles page shows the pin and removes it. Dialogs are recorded and
// answered instead of shown. No running Flowplan is needed.
// Usage: node test/certificates-app.mjs (Linux without a display: xvfb-run)
import { _electron as electron } from "playwright";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:https";
import { createRequire } from "node:module";
import { X509Certificate } from "node:crypto";
import assert from "node:assert/strict";
import { hasOpenssl, selfSigned } from "./certificate-fixtures.mjs";

const require = createRequire(import.meta.url);
const packaged = process.env.FLOWPLAN_APP;
const executablePath = packaged || require("electron");
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
async function until(test, what, timeout = 20000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const value = await test();
    if (value) return value;
    await sleep(150);
  }
  throw new Error(`timed out: ${what}`);
}
if (!hasOpenssl()) {
  console.error("openssl is needed to make the test certificates");
  process.exit(1);
}

const first = selfSigned();
const second = selfSigned();
const fingerprint = (pair) => new X509Certificate(pair.cert).fingerprint256;
const server = createServer({ key: first.key, cert: first.cert }, (req, res) => {
  if (req.url === "/api/health") {
    res.setHeader("Content-Type", "application/json");
    return res.end(JSON.stringify({ service: "flowplan" }));
  }
  res.setHeader("Content-Type", "text/html");
  res.end("<!doctype html><title>Secure</title><h1>Secure instance</h1>");
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const port = server.address().port;
const origin = `https://localhost:${port}`;
// The server presents another certificate from the next connection on.
function present(pair) {
  server.setSecureContext({ key: pair.key, cert: pair.cert });
  server.closeAllConnections();
}

const dir = mkdtempSync(join(tmpdir(), "flowplan-certificates-"));
const config = () => (existsSync(join(dir, "config.json")) ? JSON.parse(readFileSync(join(dir, "config.json"), "utf8")) : {});
const app = await electron.launch({
  executablePath,
  args: [...(packaged ? [] : ["."]), `--user-data-dir=${dir}`],
  cwd: new URL("..", import.meta.url).pathname,
});
// Dialogs are recorded and answered from a queue (1 = Cancel when empty).
await app.evaluate(({ app, dialog }) => {
  globalThis.seen = { dialogs: [], asked: [] };
  globalThis.answers = [];
  dialog.showMessageBox = async (...args) => {
    const options = args.length > 1 ? args[1] : args[0];
    globalThis.seen.dialogs.push({ message: options.message, detail: options.detail, buttons: options.buttons, defaultId: options.defaultId, cancelId: options.cancelId });
    return { response: globalThis.answers.length ? globalThis.answers.shift() : 1 };
  };
  dialog.showErrorBox = () => {};
  app.on("flowplan-certificate-asked", (asked) => globalThis.seen.asked.push(asked));
});
const answer = (...values) => app.evaluate((_e, values) => globalThis.answers.push(...values), values);
const dialogs = () => app.evaluate(() => globalThis.seen.dialogs);
const asked = () => app.evaluate(() => globalThis.seen.asked);
async function windowWith(test, timeout = 20000) {
  return until(async () => {
    for (const page of app.windows()) {
      if (page.isClosed()) continue;
      if (await page.evaluate(test).catch(() => false)) return page;
    }
    return null;
  }, String(test), timeout);
}
const showing = (text) => new Function(`return !!document.body && document.body.innerText.includes(${JSON.stringify(text)})`);
// A request with a profile's session, from the main process.
const fetchWith = (partition, url) =>
  app.evaluate(
    ({ session }, { partition, url }) =>
      session
        .fromPartition(partition)
        .fetch(url, { cache: "no-store" })
        .then((r) => `HTTP ${r.status}`, (e) => String(e.message)),
    { partition, url },
  );

// Adding the instance: the certificate is shown, Cancel adds nothing.
const setup = await windowWith(() => !!document.getElementById("form"));
{
  await setup.fill("#server", origin);
  await answer(1);
  await setup.click("#submit");
  await until(async () => (await setup.textContent("#error")).includes("ERR_CERT_AUTHORITY_INVALID"), "the reason is named");
  const [dialog] = await dialogs();
  assert.ok(dialog.message.includes(`localhost:${port}`), "names the host");
  assert.ok(dialog.detail.includes(fingerprint(first)), "shows the SHA-256 fingerprint");
  assert.ok(dialog.detail.includes("localhost"), "subject and issuer");
  assert.equal(dialog.buttons.length, 2);
  assert.equal(dialog.defaultId, 1, "Cancel is the default");
  assert.equal(dialog.cancelId, 1);
  assert.deepEqual(config().profiles || [], [], "nothing added");
  console.log("✔ Unbekanntes Zertifikat: Abbrechen fügt nichts hinzu");
}

// Trusting it: exactly this certificate for this host, and the instance loads.
let profile;
{
  await answer(0);
  await setup.click("#submit");
  await windowWith(showing("Secure instance"));
  profile = config().profiles[0];
  assert.equal(profile.certificate.host, "localhost");
  assert.equal(profile.certificate.fingerprint, fingerprint(first));
  assert.equal((await asked()).at(-1).trusted, true);
  const partition = `persist:profile-${profile.id}`;
  assert.equal(await fetchWith(partition, `${origin}/api/health`), "HTTP 200", "the profile's session trusts it");
  // The same certificate on another host name of the same server: refused.
  assert.match(await fetchWith(partition, `https://127.0.0.1:${port}/api/health`), /ERR_CERT_AUTHORITY_INVALID/, "never for another host");
  // Another session (another profile, the default session): refused.
  assert.match(await fetchWith("persist:profile-other", `${origin}/api/health`), /ERR_CERT_AUTHORITY_INVALID/, "never in another profile");
  console.log("✔ Vertrauen: genau dieses Zertifikat für diesen Host und dieses Profil");
}

// Restarts the app asks for (trust changed after Chromium kept a verdict) are recorded instead.
await app.evaluate(({ app }) => {
  globalThis.seen.restarts = 0;
  globalThis.realQuit = app.quit;
  app.relaunch = () => void globalThis.seen.restarts++;
  app.quit = () => {};
});
const restarts = () => app.evaluate(() => globalThis.seen.restarts);

// A changed certificate: the request waits for the warning with the old and
// the new fingerprint; Cancel loads nothing.
const third = selfSigned();
{
  const before = (await dialogs()).length;
  await answer(1);
  present(second);
  const main = await windowWith(showing("Secure instance"));
  await main.reload().catch(() => {});
  await until(async () => (await dialogs()).length > before, "the warning");
  const warning = (await dialogs())[before];
  assert.ok(warning.detail.includes(fingerprint(first)), "the old fingerprint");
  assert.ok(warning.detail.includes(fingerprint(second)), "the new fingerprint");
  assert.equal(warning.defaultId, 1, "Cancel is the default");
  const offline = await windowWith(() => location.pathname.endsWith("offline.html"));
  assert.equal(config().profiles[0].certificate.fingerprint, fingerprint(first), "the pin stays");
  assert.match(await fetchWith(`persist:profile-${profile.id}`, `${origin}/api/health`), /net::ERR_/, "refused");
  await sleep(800);
  assert.equal((await dialogs()).length, before + 1, "asked once, not again for every request");
  console.log("✔ Geändertes Zertifikat: nicht geladen, Warnung mit altem und neuem Fingerabdruck");

  // "Erneut versuchen" asks again; Cancel again leaves everything as it is,
  // trusting it now replaces the pin and restarts the app.
  await answer(1);
  await offline.evaluate(() => window.flowplanDesktop.retry());
  assert.equal((await dialogs()).length, before + 2, "asked again");
  assert.equal(await restarts(), 0);
  await answer(0);
  await offline.evaluate(() => window.flowplanDesktop.retry());
  assert.equal((await dialogs()).length, before + 3);
  assert.ok((await dialogs()).at(-1).detail.includes(fingerprint(first)) && (await dialogs()).at(-1).detail.includes(fingerprint(second)));
  assert.equal(config().profiles[0].certificate.fingerprint, fingerprint(second));
  assert.equal((await asked()).at(-1).previous, fingerprint(first));
  assert.equal(await restarts(), 1, "restarted for the new verdict");
  console.log("✔ Erneut versuchen fragt wieder; Vertrauen ersetzt das alte und startet neu");

  // Trusted right away when asked: the waiting request goes on, no restart.
  await answer(0);
  present(third);
  const count = (await dialogs()).length;
  await offline.evaluate(() => window.flowplanDesktop.retry());
  await until(async () => (await dialogs()).length > count, "the warning for the third certificate");
  await windowWith(showing("Secure instance"));
  assert.equal(config().profiles[0].certificate.fingerprint, fingerprint(third));
  assert.equal((await asked()).at(-1).previous, fingerprint(second));
  assert.equal(await fetchWith(`persist:profile-${profile.id}`, `${origin}/api/health`), "HTTP 200");
  assert.equal(await restarts(), 1, "no restart");
  console.log("✔ Neuem Zertifikat sofort vertrauen lädt die Seite");
}

// The profiles page shows the pin and removes it (after asking; the app restarts).
{
  await app.evaluate(({ Menu }) => Menu.getApplicationMenu().getMenuItemById("manage-profiles").click());
  const page = await windowWith(() => !!document.querySelector("#list li .certificate"));
  assert.ok((await page.textContent("#list li .certificate")).includes(fingerprint(third)));
  await answer(1);
  await page.click("#list li button.link");
  await sleep(500);
  assert.equal(config().profiles[0].certificate.fingerprint, fingerprint(third), "Cancel keeps it");
  await answer(0);
  await page.click("#list li button.link");
  await until(() => !config().profiles[0].certificate, "the pin is removed");
  assert.ok((await dialogs()).at(-1).detail.includes(fingerprint(third)));
  assert.equal(await restarts(), 2, "restarted, so nothing of the old trust is left");
  console.log("✔ Profile zeigen das Zertifikat und entfernen es");
}

await app.evaluate(({ app }) => (app.quit = globalThis.realQuit));
await app.close();
server.close();
server.closeAllConnections();
console.log("certificates-app: ok");
