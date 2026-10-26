// Files dropped on the Dock icon (macOS), opened with the app ("Open with",
// a file on the taskbar icon or the command line on Windows and Linux) or
// dropped on the window where the page itself does not take them: PDFs,
// images, Markdown and text go – after the person confirmed where – into the
// inbox of the active profile (one record each) or become new pages, through
// the instance's own upload and import endpoints (instance-api.js).
//
// What is accepted is decided here, from the name, the size and the first
// bytes – plain functions without Electron (test/security.mjs,
// test/features.mjs). Nothing is read before the person confirmed, and only
// files a person handed over: a drop on the window comes from the preload,
// which takes only real (trusted) drop events with files from the disk, and
// main.js checks every path again with these rules.
const path = require("node:path");
const { fileURLToPath } = require("node:url");

const MAX_FILES = 10;
// Per file; the instance may allow less (its upload limit) and says so.
const MAX_MEDIA_BYTES = 50 * 1024 * 1024;
const MAX_TEXT_BYTES = 5 * 1024 * 1024;
const HEAD_BYTES = 16;

const starts = (head, ...bytes) => bytes.every((b, i) => head[i] === b);
const ascii = (head, offset, text) => Buffer.from(head.subarray(offset, offset + text.length)).toString("latin1") === text;
// Extension → kind, type and the signature the content must have.
const TYPES = {
  png: { kind: "image", mime: "image/png", check: (h) => starts(h, 0x89, 0x50, 0x4e, 0x47) },
  jpg: { kind: "image", mime: "image/jpeg", check: (h) => starts(h, 0xff, 0xd8, 0xff) },
  jpeg: { kind: "image", mime: "image/jpeg", check: (h) => starts(h, 0xff, 0xd8, 0xff) },
  gif: { kind: "image", mime: "image/gif", check: (h) => ascii(h, 0, "GIF8") },
  webp: { kind: "image", mime: "image/webp", check: (h) => ascii(h, 0, "RIFF") && ascii(h, 8, "WEBP") },
  avif: { kind: "image", mime: "image/avif", check: (h) => ascii(h, 4, "ftypavi") },
  heic: { kind: "image", mime: "image/heic", check: (h) => ascii(h, 4, "ftyphei") || ascii(h, 4, "ftypmif1") },
  pdf: { kind: "pdf", mime: "application/pdf", check: (h) => ascii(h, 0, "%PDF-") },
  md: { kind: "markdown", mime: "text/markdown", check: (h) => !h.includes(0) },
  markdown: { kind: "markdown", mime: "text/markdown", check: (h) => !h.includes(0) },
  txt: { kind: "text", mime: "text/plain", check: (h) => !h.includes(0) },
};
const EXTENSIONS = Object.keys(TYPES);
const extensionOf = (name) => path.extname(String(name || "")).slice(1).toLowerCase();
const isText = (kind) => kind === "markdown" || kind === "text";

// What a file is, or why it is refused: "type", "size", "empty", "content".
function classifyFile({ name, size, head = Buffer.alloc(0) }) {
  const type = TYPES[extensionOf(name)];
  if (!type) return { error: "type" };
  if (!Number.isFinite(size) || size <= 0) return { error: "empty" };
  if (size > (isText(type.kind) ? MAX_TEXT_BYTES : MAX_MEDIA_BYTES)) return { error: "size" };
  if (!type.check(Buffer.from(head))) return { error: "content" };
  return { kind: type.kind, mime: type.mime };
}

// The files among command line arguments: absolute paths or file:// links
// (Linux launchers pass %U) with an accepted extension – never options,
// flowplan:// links or the app itself. Relative paths count from `cwd`.
function filesFromArgs(argv = [], { cwd, skip = [] } = {}) {
  const found = [];
  for (const arg of argv.slice(1)) {
    if (typeof arg !== "string" || !arg || arg.startsWith("-") || /^flowplan:/i.test(arg)) continue;
    let file = arg;
    if (/^file:\/\//i.test(arg)) {
      try {
        file = fileURLToPath(arg);
      } catch {
        continue;
      }
    } else if (/^[a-z][a-z0-9+.-]*:\/\//i.test(arg)) continue;
    if (!path.isAbsolute(file)) {
      if (!cwd) continue;
      file = path.resolve(cwd, file);
    }
    if (skip.includes(file) || !EXTENSIONS.includes(extensionOf(file))) continue;
    if (!found.includes(file)) found.push(file);
  }
  return found.slice(0, MAX_FILES);
}
// Paths from a drop on the window (the preload): absolute strings only.
function droppedPaths(list) {
  if (!Array.isArray(list)) return [];
  return list.filter((p) => typeof p === "string" && p.length < 4096 && path.isAbsolute(p) && !p.includes("\0") && EXTENSIONS.includes(extensionOf(p))).slice(0, MAX_FILES);
}

// A name for a page or record: the file name without extension, one line.
function titleOf(name) {
  const base = path.basename(String(name || "")).replace(/\.[a-z0-9]+$/i, "");
  return base.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 120) || "Flowplan";
}
// A name safe inside the vault: no folders, no characters Obsidian links
// cannot hold.
const vaultName = (name) => path.basename(String(name)).replace(/[\u0000-\u001f\u007f[\]#^|\\/:*?"<>]/g, "-").slice(0, 150) || "file";

// The files as a tiny Obsidian vault: one note per file – Markdown and text
// as the note itself, images and PDFs embedded as ![[file]] – which the
// instance's import turns into pages.
function vaultEntries(files) {
  const entries = [];
  const taken = new Set();
  const unique = (name) => {
    let candidate = name;
    for (let i = 2; taken.has(candidate.toLowerCase()); i++) candidate = name.replace(/(\.[^.]+)?$/, ` ${i}$1`);
    taken.add(candidate.toLowerCase());
    return candidate;
  };
  for (const file of files) {
    const title = titleOf(file.name).replace(/[[\]#^|\\/:*?"<>]/g, "-");
    if (isText(file.kind)) {
      entries.push({ name: unique(`${title}.md`), data: Buffer.from(file.bytes) });
    } else {
      const attachment = unique(vaultName(file.name));
      entries.push({ name: unique(`${title}.md`), data: Buffer.from(`![[${attachment}]]\n`) });
      entries.push({ name: attachment, data: Buffer.from(file.bytes) });
    }
  }
  return entries;
}

module.exports = { MAX_FILES, MAX_MEDIA_BYTES, MAX_TEXT_BYTES, HEAD_BYTES, EXTENSIONS, classifyFile, filesFromArgs, droppedPaths, titleOf, vaultEntries, isText };
