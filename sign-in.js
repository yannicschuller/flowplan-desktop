// Sign-in through the system browser: passkeys (iCloud Keychain, Windows
// Hello, password managers) and identity providers that ask for one only
// work there. The instance's sign-in page links "Mit Passkey anmelden" and
// "Mit SSO anmelden" to /api/auth/desktop inside the app; the app keeps a
// random verifier, opens the browser with its SHA-256 challenge and waits
// for flowplan://sign-in with a one-time code. Only this app run, holding
// the verifier, can redeem the code – once, within a minute.
const { app, shell, dialog } = require("electron");
const { createHash, randomBytes } = require("node:crypto");

const SCHEME = "flowplan";
const PENDING_MS = 10 * 60_000;

function setupBrowserSignIn({ server, getWindow }) {
  const pending = new Map(); // challenge → { verifier, at }
  const queued = [];
  let ready = false;

  // Opens the browser for a sign-in started in the window.
  function start(via) {
    const origin = server();
    if (!origin) return;
    const verifier = randomBytes(32).toString("base64url");
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    for (const [key, value] of pending)
      if (Date.now() - value.at > PENDING_MS) pending.delete(key);
    pending.set(challenge, { verifier, at: Date.now() });
    const url = new URL("/api/auth/desktop", origin);
    url.searchParams.set("challenge", challenge);
    if (via === "sso") url.searchParams.set("via", "sso");
    void shell.openExternal(url.href);
  }
  // A navigation in the window to /api/auth/desktop starts it instead.
  function intercept(url) {
    let target;
    try {
      target = new URL(url);
    } catch {
      return false;
    }
    if (target.origin !== server() || target.pathname !== "/api/auth/desktop") return false;
    start(target.searchParams.get("via"));
    return true;
  }
  async function redeem(link) {
    const win = getWindow();
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
    let url;
    try {
      url = new URL(link);
    } catch {
      return;
    }
    if (url.protocol !== `${SCHEME}:` || url.hostname !== "sign-in") return;
    const origin = server(),
      challenge = url.searchParams.get("challenge") || "",
      code = url.searchParams.get("code") || "",
      request = pending.get(challenge);
    // Codes for another instance or a sign-in this app did not start are
    // ignored: nobody can sign the app in from outside.
    if (url.searchParams.get("server") !== origin || !request) {
      dialog.showErrorBox(
        "Anmeldung nicht möglich",
        "Diese Anmeldung wurde nicht in dieser App gestartet oder gehört zu einer anderen Instanz. Starte sie bitte noch einmal über „Mit Passkey anmelden“ oder „Mit SSO anmelden“.",
      );
      return;
    }
    pending.delete(challenge);
    // The code is redeemed from the instance's page, so the session cookie
    // lands in the app's own session.
    if (!sameOrigin(win.webContents.getURL(), origin)) await win.loadURL(origin).catch(() => {});
    const result = await win.webContents
      .executeJavaScript(
        `fetch("/api/auth/desktop-redeem",{method:"POST",headers:{"Content-Type":"application/json"},body:${JSON.stringify(
          JSON.stringify({ code, verifier: request.verifier }),
        )}}).then(async (r) => ({ ok: r.ok, error: (await r.json().catch(() => ({}))).error }))`,
      )
      .catch((e) => ({ ok: false, error: e.message }));
    if (!result.ok) {
      dialog.showErrorBox("Anmeldung fehlgeschlagen", String(result.error || "Bitte erneut anmelden."));
      return;
    }
    await win.loadURL(origin).catch(() => {});
  }
  function handle(link) {
    if (ready && getWindow()) void redeem(link);
    else queued.push(link);
  }
  // macOS delivers the link as an event, Windows and Linux start a second
  // instance with the link as argument.
  app.on("open-url", (event, link) => {
    event.preventDefault();
    handle(link);
  });
  const fromArgs = (argv) => argv.find((a) => a.startsWith(`${SCHEME}://`));
  const initial = fromArgs(process.argv);
  if (initial) queued.push(initial);

  return {
    intercept,
    // The window exists: links that arrived during start-up are handled.
    ready() {
      ready = true;
      if (app.isPackaged) app.setAsDefaultProtocolClient(SCHEME);
      for (const link of queued.splice(0)) void redeem(link);
    },
    secondInstance(argv) {
      const link = fromArgs(argv);
      if (link) handle(link);
    },
    // For tests: the challenges waiting for a code.
    pendingCount: () => pending.size,
  };
}
function sameOrigin(url, origin) {
  try {
    return new URL(url).origin === origin;
  } catch {
    return false;
  }
}
module.exports = { setupBrowserSignIn };
