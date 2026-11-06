// This computer's key for an instance (#133 in Flowplan, lib/app-devices.ts):
// the instance gives a password sign-in in the app the app's long lifetime
// only when the app proves it is the app – the user agent alone, which any
// browser can send, no longer counts. Per profile the app makes a random id
// and secret on first use, keeps them in the app's user data folder
// (device-keys/<profile id>.json), encrypted with the system's key store
// where there is one (Electron safeStorage, as quick capture: capture-store.js;
// otherwise readable only by the user, mode 0600), and hands them only to the
// main frame of that profile's instance (preload.js:
// window.FlowplanDesktop.deviceKey). The sign-in form sends them with the
// password; the instance registers the key at the first sign-in of an
// account on this computer and wants the same secret afterwards.
//
// A key that cannot be read any more (the key store changed) is replaced by
// a new one: the next password sign-in registers it as a new device.
// Removing the profile removes the key.
//
// Plain functions: cipher, file system and randomness are passed in, so
// test/features.mjs runs this with Node alone.
const path = require("node:path");
const crypto = require("node:crypto");

const PROFILE = /^[A-Za-z0-9_-]{1,64}$/;
const ID = /^[A-Za-z0-9_-]{16,64}$/;
const SECRET = /^[A-Za-z0-9_-]{32,128}$/;

const valid = (key) => !!key && typeof key.id === "string" && typeof key.secret === "string" && ID.test(key.id) && SECRET.test(key.secret);

function createDeviceKeys({ dir, cipher, fs = require("node:fs"), random = crypto.randomBytes }) {
  const file = (profileId) => {
    if (!PROFILE.test(String(profileId))) throw new Error("invalid profile id");
    return path.join(dir, `${profileId}.json`);
  };
  const read = (target) => {
    try {
      const outer = JSON.parse(fs.readFileSync(target, "utf8"));
      if (!outer || typeof outer.data !== "string") return null;
      if (!outer.encrypted) return JSON.parse(outer.data);
      if (!cipher || !cipher.available) return null;
      return JSON.parse(cipher.decrypt(Buffer.from(outer.data, "base64")));
    } catch {
      return null;
    }
  };
  const write = (target, key) => {
    const json = JSON.stringify(key);
    const encrypted = !!(cipher && cipher.available);
    const data = encrypted ? Buffer.from(cipher.encrypt(json)).toString("base64") : json;
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const temporary = `${target}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify({ v: 1, encrypted, data }), { mode: 0o600 });
    fs.renameSync(temporary, target);
  };
  return {
    // The profile's key, made on first use; null if it cannot be kept.
    get(profileId) {
      let target;
      try {
        target = file(profileId);
      } catch {
        return null;
      }
      const stored = read(target);
      if (valid(stored)) return { id: stored.id, secret: stored.secret };
      const key = { id: Buffer.from(random(16)).toString("base64url"), secret: Buffer.from(random(32)).toString("base64url") };
      if (!valid(key)) return null;
      try {
        write(target, key);
      } catch {
        return null;
      }
      const back = read(target);
      return valid(back) && back.secret === key.secret ? key : null;
    },
    forget(profileId) {
      try {
        fs.rmSync(file(profileId), { force: true });
      } catch {}
    },
  };
}

module.exports = { createDeviceKeys, validDeviceKey: valid };
