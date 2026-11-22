// The switch to another profile (flowplan#428): no hard cut from one
// instance to the next. The window being replaced fades to the app's
// background with the target profile's name; the new window (main.js
// replaceWindow) opens under the same picture and fades it away once its
// instance has drawn. Both pictures look alike, so the swap of the windows
// behind them is not seen. A WebContentsView over the window's content with
// the app's own page pages/switch.html – no preload, no bridge, sandboxed;
// with "Reduce motion" (prefers-reduced-motion) the page skips the fades.
//
// coverTiming is a plain function (test/features.mjs); attachCover needs
// Electron and is called by main.js only.
const path = require("node:path");

// The fade in pages/style.css (body.switch), and how long the new window
// waits for its instance to finish loading before it shows it anyway.
const FADE = 220;
const MAX_WAIT = 1500;
const REMOVE_AFTER = FADE + 80;

// The page's address: its words come along in the query, as the page has
// no bridge to read the catalogues.
function coverQuery({ name, text, phase, lang }) {
  return { name: String(name || "").slice(0, 60), text: String(text || "").slice(0, 200), phase: phase === "in" ? "in" : "cover", lang: String(lang || "en") };
}

// A cover over `w`. phase "in": fades in over what the window shows (the
// window that is being replaced); "cover": there at once (the new window).
// out() fades it away and removes it; it also goes with its window.
function attachCover(w, { name, text, phase, lang, dark }) {
  const { WebContentsView } = require("electron");
  const view = new WebContentsView({ webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false } });
  // Transparent while it fades in; the background at once otherwise.
  view.setBackgroundColor(phase === "in" ? "#00000000" : dark ? "#16151b" : "#fcfbf8");
  const layout = () => {
    if (w.isDestroyed()) return;
    const [width, height] = w.getContentSize();
    view.setBounds({ x: 0, y: 0, width, height });
  };
  layout();
  w.contentView.addChildView(view);
  w.on("resize", layout);
  const file = path.join(__dirname, "pages", "switch.html");
  const query = coverQuery({ name, text, phase, lang });
  void view.webContents.loadFile(file, { query }).catch(() => {});
  let removed = false,
    leaving = false;
  const remove = () => {
    if (removed) return;
    removed = true;
    if (!w.isDestroyed()) {
      w.off("resize", layout);
      w.contentView.removeChildView(view);
    }
    if (!view.webContents.isDestroyed()) view.webContents.close();
  };
  w.once("closed", remove);
  return {
    view,
    out() {
      if (leaving || removed) return;
      leaving = true;
      // The same page, its address with #out: the page fades (hashchange).
      if (!view.webContents.isDestroyed()) void view.webContents.loadFile(file, { query, hash: "out" }).catch(() => {});
      view.setBackgroundColor("#00000000");
      setTimeout(remove, REMOVE_AFTER);
    },
    remove,
  };
}

module.exports = { FADE, MAX_WAIT, REMOVE_AFTER, coverQuery, attachCover };
