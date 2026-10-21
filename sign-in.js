// Sign-in through the system browser: passkeys (iCloud Keychain, Windows
// Hello, password managers) and identity providers that ask for one only
// work there. The instance's sign-in page links "Mit Passkey anmelden" and
// "Mit SSO anmelden" to /api/auth/desktop inside the app; the app keeps a
// random verifier, opens the browser with its SHA-256 challenge and waits
// for flowplan://sign-in with a one-time code. Only this app run, holding
// the verifier, can redeem the code – once, within a minute.
//
// While it waits, a small window (pages/sign-in.html) says what is going on
// and takes the link or code by hand: where flowplan:// never reaches the
// app (a Linux AppImage that is not integrated, the tar.gz), the user copies
// the "Flowplan-App öffnen" link from the browser's last page and pastes it.
const { app, shell, dialog, BrowserWindow, nativeTheme } = require("electron");
const { createHash, randomBytes } = require("node:crypto");
const path = require("node:path");
const { t } = require("./strings");

const SCHEME = "flowplan";
const PENDING_MS = 10 * 60_000;

function setupBrowserSignIn({ server, getWindow, preload, locale = () => "en" }) {
  const pending = new Map(); // challenge → { verifier, at }
  const queued = [];
  let ready = false;
  let waiting = null; // the "continue in the browser" window

  function closeWaiting() {
    if (waiting && !waiting.isDestroyed()) waiting.close();
    waiting = null;
  }
  function showWaiting(origin) {
    const parent = getWindow();
    if (!parent) return;
    if (waiting && !waiting.isDestroyed()) return waiting.focus();
    waiting = new BrowserWindow({
      parent,
      width: 460,
      height: 560,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      autoHideMenuBar: true,
      title: t("signIn.title"),
      backgroundColor: nativeTheme.shouldUseDarkColors ? "#16151b" : "#fcfbf8",
      webPreferences: { preload, contextIsolation: true, sandbox: true, nodeIntegration: false },
    });
    waiting.on("closed", () => (waiting = null));
    waiting.setMenuBarVisibility(false);
    void waiting.loadFile(path.join(__dirname, "pages", "sign-in.html"), { query: { lang: locale(), server: origin } });
  }
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
    showWaiting(origin);
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
  // Redeems a flowplan://sign-in link; says what went wrong instead of
  // showing it, so a pasted link can answer in its own window.
  async function redeem(link) {
    const win = getWindow();
    if (!win) return { ok: false, error: t("signIn.retry") };
    if (win.isMinimized()) win.restore();
    win.focus();
    let url;
    try {
      url = new URL(link);
    } catch {
      return { ok: false, error: t("signIn.noCode") };
    }
    if (url.protocol !== `${SCHEME}:` || url.hostname !== "sign-in") return { ok: false, error: t("signIn.noCode") };
    const origin = server(),
      challenge = url.searchParams.get("challenge") || "",
      code = url.searchParams.get("code") || "",
      request = pending.get(challenge);
    // Codes for another instance or a sign-in this app did not start are
    // ignored: nobody can sign the app in from outside.
    if (url.searchParams.get("server") !== origin || !request) return { ok: false, error: t("signIn.notStarted"), notStarted: true };
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
    if (!result.ok) return { ok: false, error: String(result.error || t("signIn.retry")) };
    closeWaiting();
    await win.loadURL(origin).catch(() => {});
    return { ok: true };
  }
  async function redeemAndTell(link) {
    const result = await redeem(link);
    if (result.ok) return;
    dialog.showErrorBox(result.notStarted ? t("signIn.notPossible") : t("signIn.failed"), result.error);
  }
  function handle(link) {
    if (ready && getWindow()) void redeemAndTell(link);
    else queued.push(link);
  }
  // From the waiting window: the whole flowplan://sign-in link, or just the
  // code – then for the sign-in started last.
  async function paste(text) {
    const value = String(text || "").trim();
    if (!value) throw new Error(t("signIn.noCode"));
    let link = value;
    if (!/^flowplan:/i.test(value)) {
      if (!/^[A-Za-z0-9_-]{20,100}$/.test(value)) throw new Error(t("signIn.noCode"));
      const latest = [...pending.entries()].sort((a, b) => b[1].at - a[1].at)[0];
      if (!latest) throw new Error(t("signIn.noPending"));
      link = `${SCHEME}://sign-in?${new URLSearchParams({ server: server() || "", challenge: latest[0], code: value })}`;
    }
    const result = await redeem(link);
    if (!result.ok) throw new Error(result.error);
    return true;
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
    paste,
    cancel: () => closeWaiting(),
    // The window exists: links that arrived during start-up are handled.
    ready() {
      ready = true;
      if (app.isPackaged) app.setAsDefaultProtocolClient(SCHEME);
      for (const link of queued.splice(0)) void redeemAndTell(link);
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
