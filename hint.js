// The one-time hint for people who used Flowplan before quick capture had
// its own window and never captured (onboarding.js decides): a small card
// in the lower left corner of the main window (pages/hint.html, the update
// toast sits on the right), "Neu: Schnell erfassen mit {shortcut}", with
// "Ausprobieren", "Einstellungen" and ×. Non-modal: it takes no focus and
// the page stays usable. Closed, used or after the first capture it never
// comes back.
const path = require("node:path");

const SIZE = { width: 380, height: 124, margin: 16 };

// deps: getWindow(), locale(), shortcutLabel(), act(id) after a button.
function setupHint(deps) {
  const { WebContentsView, nativeTheme, app } = require("electron");
  let hint = null; // { view, window }

  function layout() {
    if (!hint || hint.window.isDestroyed()) return;
    const [width, height] = hint.window.getContentSize();
    hint.view.setBounds({ x: SIZE.margin, y: Math.max(0, height - SIZE.height - SIZE.margin), width: Math.min(SIZE.width, width - 2 * SIZE.margin), height: SIZE.height });
  }
  function close() {
    if (!hint) return;
    if (!hint.window.isDestroyed()) {
      hint.window.contentView.removeChildView(hint.view);
      hint.window.off("resize", layout);
    }
    if (!hint.view.webContents.isDestroyed()) hint.view.webContents.close();
    hint = null;
  }
  function show() {
    const target = deps.getWindow();
    if (!target || target.isDestroyed() || hint) return false;
    const view = new WebContentsView({ webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, sandbox: true, nodeIntegration: false } });
    view.setBackgroundColor(nativeTheme.shouldUseDarkColors ? "#16151b" : "#fcfbf8");
    view.setBorderRadius?.(12);
    view.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    view.webContents.on("will-navigate", (event) => event.preventDefault());
    hint = { view, window: target };
    target.contentView.addChildView(view);
    target.on("resize", layout);
    target.once("closed", () => {
      if (hint && hint.window === target) hint = null;
    });
    layout();
    void view.webContents.loadFile(path.join(__dirname, "pages", "hint.html"), { query: { lang: deps.locale() } });
    app.emit("flowplan-hint", view.webContents);
    return true;
  }
  return {
    show,
    close,
    contents: () => (hint ? hint.view.webContents : null),
    info: () => ({ shortcut: deps.shortcutLabel() }),
    act(id) {
      close();
      deps.act(id);
    },
  };
}

module.exports = { setupHint, SIZE };
