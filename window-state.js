// The main window's size and place (config.json `window`), remembered when
// it closes or another profile replaces it, and restored at the next start
// (flowplan#428). Whatever comes back is checked against the screens the
// computer has now: a window of a minimum size that a screen's work area
// shows enough of – the place of a monitor no longer plugged in, a size
// saved while the window was minimised (Windows reports 160×28 far off
// screen, macOS a frame of zero) or anything else in the file opens centred
// on the main screen at the default size instead. Maximised and full screen
// are kept apart from the size: what is saved is always the window's normal
// size, the one it returns to.
//
// Plain functions without Electron (test/features.mjs); main.js passes
// screen.getAllDisplays() and screen.getPrimaryDisplay().

const DEFAULT = { width: 1320, height: 860 };
// The main window's minimum size (main.js makeWindow).
const MIN = { width: 380, height: 500 };
const MAX = 20000;
// At least this much of the window – its title bar – on a screen.
const VISIBLE = { width: 120, height: 60 };

const int = (v) => (Number.isInteger(v) && Math.abs(v) <= MAX ? v : null);
const areaOf = (display) => {
  const area = display && (display.workArea || display.bounds);
  if (!area) return null;
  const [x, y, width, height] = [area.x, area.y, area.width, area.height].map(int);
  return x === null || y === null || !width || !height || width <= 0 || height <= 0 ? null : { x, y, width, height };
};
// How much of `b` lies on the area.
function overlap(b, area) {
  const width = Math.min(b.x + b.width, area.x + area.width) - Math.max(b.x, area.x);
  const height = Math.min(b.y + b.height, area.y + area.height) - Math.max(b.y, area.y);
  return width > 0 && height > 0 ? { width, height } : null;
}
// A size centred on the area, no larger than the area.
function centred(size, area) {
  const width = Math.min(size.width, area.width);
  const height = Math.min(size.height, area.height);
  return { x: area.x + Math.round((area.width - width) / 2), y: area.y + Math.round((area.height - height) / 2), width, height };
}

// The bounds to open the main window with: the saved ones when they fit a
// current screen (shrunk to that screen's work area if larger), otherwise
// the saved size (or the default) centred on the main screen. Without any
// screen (never in practice) only a checked size, no place. `fallback`:
// the size without a usable saved one (a page window's is smaller).
function validBounds(saved, displays = [], primary = displays[0], { fallback = DEFAULT } = {}) {
  const areas = (Array.isArray(displays) ? displays : []).map(areaOf).filter(Boolean);
  const main = areaOf(primary) || areas[0] || null;
  const s = saved && typeof saved === "object" ? saved : {};
  const width = int(s.width);
  const height = int(s.height);
  const sized = width !== null && height !== null && width >= MIN.width && height >= MIN.height;
  const size = sized ? { width, height } : { width: fallback.width, height: fallback.height };
  if (!main) return size;
  const x = int(s.x);
  const y = int(s.y);
  if (sized && x !== null && y !== null) {
    const bounds = { x, y, width, height };
    // The screen showing most of it, if it shows enough.
    let best = null;
    for (const area of areas) {
      const seen = overlap(bounds, area);
      if (seen && seen.width >= VISIBLE.width && seen.height >= VISIBLE.height && (!best || seen.width * seen.height > best.seen.width * best.seen.height)) best = { area, seen };
    }
    if (best) {
      const { area } = best;
      const w = Math.min(width, area.width);
      const h = Math.min(height, area.height);
      // Shrunk to the screen, then moved fully onto it (the title bar
      // reachable, never under the menu bar or off an edge).
      return {
        x: Math.min(Math.max(x, area.x), area.x + area.width - w),
        y: Math.min(Math.max(y, area.y), area.y + area.height - h),
        width: w,
        height: h,
      };
    }
  }
  return centred(size, main);
}

// Whether bounds are worth remembering (a normal window, not a minimised
// or hidden stand-in).
function usable(b) {
  if (!b || typeof b !== "object") return false;
  const [x, y, width, height] = [b.x, b.y, b.width, b.height].map((v) => (Number.isFinite(v) ? Math.round(v) : null));
  return x !== null && y !== null && width >= MIN.width && height >= MIN.height && Math.abs(x) <= MAX && Math.abs(y) <= MAX && width <= MAX && height <= MAX;
}
const rounded = (b) => ({ x: Math.round(b.x), y: Math.round(b.y), width: Math.round(b.width), height: Math.round(b.height) });

// What config.json's `window` becomes when the window closes or another
// profile takes its place. `bounds` is the window's frame right now (only
// trusted while it is normal), `normal` its normal bounds as Electron
// reports them (getNormalBounds), `last` the last normal frame main.js saw
// (on resize and move), `previous` what config.json held. The first usable
// one wins, so minimised, full screen or maximised never become the size.
function stateToSave({ bounds, normal, last, maximized = false, fullScreen = false, minimized = false } = {}, previous = {}) {
  const isNormal = !maximized && !fullScreen && !minimized;
  const candidates = isNormal ? [bounds, last, normal] : [last, normal];
  const prev = previous && typeof previous === "object" ? previous : {};
  candidates.push({ x: prev.x, y: prev.y, width: prev.width, height: prev.height });
  const pick = candidates.find(usable);
  return { ...(pick ? rounded(pick) : {}), maximized: !!maximized, fullScreen: !!fullScreen };
}

module.exports = { DEFAULT, MIN, validBounds, stateToSave, usable };
