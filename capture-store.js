// What quick capture keeps on this computer, per profile: the offline queue
// (captures waiting for the connection, with their files) and the list of
// recent captures ("Zuletzt erfasst"). Both live in the app's user data
// folder (capture/<profile id>.json), encrypted at rest with the system's
// key store where there is one (Electron safeStorage: the macOS Keychain,
// DPAPI on Windows, the Secret Service / KWallet on Linux). Without one –
// some Linux desktops – the file is plain JSON readable only by the user
// (mode 0600), and the settings say so.
//
// Plain functions: the cipher and the file system are passed in, so
// test/features.mjs runs this with Node alone. A file that cannot be read
// or decrypted is kept aside (…json.unreadable), never overwritten: a
// capture is never lost silently.
const path = require("node:path");

const VERSION = 1;
const ID = /^[A-Za-z0-9_-]{1,64}$/;

// cipher: { available: bool, encrypt(string) → Buffer, decrypt(Buffer) → string }
function encode(data, cipher) {
  const json = JSON.stringify(data);
  if (cipher && cipher.available) return JSON.stringify({ v: VERSION, encrypted: true, data: Buffer.from(cipher.encrypt(json)).toString("base64") });
  return JSON.stringify({ v: VERSION, encrypted: false, data: json });
}
function decode(text, cipher) {
  const outer = JSON.parse(text);
  if (!outer || outer.v !== VERSION || typeof outer.data !== "string") throw new Error("unknown format");
  if (!outer.encrypted) return JSON.parse(outer.data);
  if (!cipher || !cipher.available) throw new Error("encrypted, but no key store");
  return JSON.parse(cipher.decrypt(Buffer.from(outer.data, "base64")));
}

function createStore({ dir, cipher, fs = require("node:fs") }) {
  const file = (profileId) => {
    if (!ID.test(String(profileId))) throw new Error("invalid profile id");
    return path.join(dir, `${profileId}.json`);
  };
  const empty = () => ({ queue: [], history: [] });
  return {
    encrypted: () => !!(cipher && cipher.available),
    load(profileId) {
      const target = file(profileId);
      let text;
      try {
        text = fs.readFileSync(target, "utf8");
      } catch {
        return empty();
      }
      try {
        const data = decode(text, cipher);
        return { queue: Array.isArray(data.queue) ? data.queue : [], history: Array.isArray(data.history) ? data.history : [] };
      } catch {
        // Kept for the person (or a later key store), never overwritten.
        try {
          fs.renameSync(target, `${target}.${Date.now()}.unreadable`);
        } catch {}
        return empty();
      }
    },
    save(profileId, data) {
      const target = file(profileId);
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      const temporary = `${target}.${process.pid}.tmp`;
      fs.writeFileSync(temporary, encode({ queue: data.queue || [], history: data.history || [] }, cipher), { mode: 0o600 });
      fs.renameSync(temporary, target);
    },
    remove(profileId) {
      fs.rmSync(file(profileId), { force: true });
    },
  };
}

module.exports = { VERSION, encode, decode, createStore };
