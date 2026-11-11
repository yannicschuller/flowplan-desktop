// System audio for meeting notes (#199): the instance records the
// microphone ("me") and, in the app, what the computer plays ("others" – the
// call's participants) without a bot in the call.
//
// The page asks window.FlowplanDesktop.armSystemAudio() first; that arms the
// NEXT getDisplayMedia() of that window for a few seconds. main.js answers
// that one request without a picker – a screen from desktopCapturer (the
// page stops its video track at once) and Chromium's loopback device as
// audio – and disarms it. Every other getDisplayMedia() stays as it was:
// refused (guards.permissionAllowed refuses "display-capture").
//
// What Electron 45 (Chromium 156) does with audio "loopback":
// - Windows 10 and later: WASAPI loopback of the default output device.
// - macOS 14.2 and later: a CoreAudio tap (the "System Audio Recording"
//   permission, NSAudioCaptureUsageDescription in Info.plist); macOS 13.0
//   to 14.1: ScreenCaptureKit (the screen recording permission). Both are
//   Chromium's defaults – no --enable-features is needed (the old
//   MacCatapLoopbackAudioForScreenShare flag is gone; the SCK override
//   MacSckSystemAudioLoopbackOverride only matters for SCK on macOS 15+,
//   where the tap is used anyway). macOS 12 and older: no loopback at all.
//   The video source needs the screen recording permission in any case.
// - Linux: Electron documents loopback for Windows only, and under Wayland
//   getDisplayMedia goes through the desktop's own picker – not offered.
//
// Plain functions without Electron, for test/features.mjs and
// test/security.mjs.
const ARM_MS = 10_000;

const versionParts = (value) =>
  String(value || "")
    .split(".")
    .map((part) => Number.parseInt(part, 10) || 0);
// "13.4.1" ≥ [13, 0]
function atLeast(version, [major, minor = 0]) {
  const [a = 0, b = 0] = versionParts(version);
  return a > major || (a === major && b >= minor);
}

// What window.FlowplanDesktop.systemAudio says. `osVersion`: the macOS
// version (process.getSystemVersion()) or os.release() on Windows ("10.0.…").
// `screenStatus`: systemPreferences.getMediaAccessStatus("screen") on a Mac.
function capability({ platform, osVersion, screenStatus } = {}) {
  if (platform === "win32") {
    return atLeast(osVersion, [10]) ? { supported: true, platform } : { supported: false, platform, reason: "os-version" };
  }
  if (platform === "darwin") {
    if (!atLeast(osVersion, [13])) return { supported: false, platform, reason: "os-version" };
    return { supported: true, platform, needsPermission: screenStatus !== "granted" };
  }
  return { supported: false, platform: platform === "linux" ? "linux" : String(platform || ""), reason: "platform" };
}

// The capability of this computer: `proc` is process (platform,
// getSystemVersion() on a Mac), `os` node:os (release() on Windows),
// `systemPreferences` Electron's (macOS only).
function currentCapability({ proc = process, os = require("node:os"), systemPreferences } = {}) {
  const platform = proc.platform;
  return capability({
    platform,
    osVersion: platform === "darwin" ? proc.getSystemVersion?.() : os.release(),
    screenStatus: platform === "darwin" ? systemPreferences?.getMediaAccessStatus("screen") : undefined,
  });
}

// What armSystemAudio() answers: armed, or why not. `screenVerdict`: the
// verdict of screen-capture.permissionVerdict on a Mac.
function armVerdict(cap, { screenVerdict = "ok" } = {}) {
  if (!cap || !cap.supported) return { ok: false, reason: cap?.reason || "platform" };
  if (cap.platform === "darwin" && screenVerdict !== "ok") return { ok: false, reason: "permission" };
  return { ok: true };
}

// Who may arm: the main frame of a page of the profile's own instance (the
// same check as every other instance channel, guards.isInstancePage).
function mayArm({ frameUrl, isMainFrame, origin }, isInstancePage) {
  return isMainFrame === true && !!origin && isInstancePage(frameUrl, origin);
}

// Armed requests per webContents id: valid ARM_MS, taken once.
function createArming({ now = () => Date.now(), ttl = ARM_MS } = {}) {
  const armed = new Map(); // webContents id → expiry
  const prune = () => {
    const at = now();
    for (const [id, until] of armed) if (until <= at) armed.delete(id);
  };
  return {
    arm(id) {
      prune();
      armed.set(id, now() + ttl);
    },
    // Without taking it (the permission request comes before the request itself).
    isArmed(id) {
      const until = armed.get(id);
      if (until === undefined) return false;
      if (until <= now()) {
        armed.delete(id);
        return false;
      }
      return true;
    },
    // Once: the next request finds it disarmed.
    take(id) {
      const ok = this.isArmed(id);
      armed.delete(id);
      return ok;
    },
    clear(id) {
      armed.delete(id);
    },
    size: () => (prune(), armed.size),
  };
}

// The answer to an armed getDisplayMedia(): a screen (the one of the window
// if it is among them) with the system's audio; null (refused) without one.
function displayMediaAnswer(sources, displayId) {
  const list = Array.isArray(sources) ? sources : [];
  const source = list.find((s) => displayId !== undefined && String(s.display_id) === String(displayId)) || list[0];
  return source ? { video: source, audio: "loopback" } : null;
}

// The one store main.js uses (test/app.mjs reaches it through the module
// cache to arm a window on Linux, where the bridge does not).
const arming = createArming();

module.exports = { ARM_MS, atLeast, capability, currentCapability, armVerdict, mayArm, createArming, displayMediaAnswer, arming };
