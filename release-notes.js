// "Was ist neu?" in the update toast (#223, updates.js): the release notes
// of every version between the installed one and the update. They come with
// the update itself – electron-updater reads the release feed it checks for
// updates anyway; with `fullChangelog` it hands over the notes of each
// version newer than the installed one ({ version, note } per release, the
// note as GitHub's HTML) – so nothing is asked for in addition. A mirror
// (FLOWPLAN_UPDATE_URL) gives its latest*.yml's releaseNotes: one text
// (Markdown or HTML) or the same list.
//
// The notes are someone else's text: they never reach a page as HTML. Here
// they become plain sections and lines ({ key, title, items }), and
// pages/update-page.js puts them into the toast as text only. Folded
// <details> (the commit list under "All commits"), scripts, styles and
// anything else fall away. Plain functions, run by test/features.mjs and
// test/security.mjs with Node alone.

// 1.2.3 and 1.2.3-beta.1 (with or without "v"); null for anything else.
function parse(version) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+.*)?$/.exec(String(version || "").trim());
  return m ? { core: [+m[1], +m[2], +m[3]], pre: m[4] ? m[4].split(".") : [] } : null;
}
// Semantic versioning order: below 0 when a is older than b; a pre-release
// before its release. Unreadable versions count as equal.
function compareVersions(a, b) {
  const x = parse(a),
    y = parse(b);
  if (!x || !y) return 0;
  for (let i = 0; i < 3; i++) if (x.core[i] !== y.core[i]) return x.core[i] - y.core[i];
  if (!x.pre.length || !y.pre.length) return y.pre.length - x.pre.length;
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    const p = x.pre[i],
      q = y.pre[i];
    if (p === undefined) return -1;
    if (q === undefined) return 1;
    if (p === q) continue;
    const pn = /^\d+$/.test(p),
      qn = /^\d+$/.test(q);
    if (pn && qn) return +p - +q;
    if (pn !== qn) return pn ? -1 : 1;
    return p < q ? -1 : 1;
  }
  return 0;
}

// The sections of the curated notes (scripts/release-notes.mjs writes them
// as "### Breaking changes" and so on) and of GitHub's generated notes.
const SECTIONS = [
  ["breaking", /breaking|inkompatib|incompatib/i],
  ["security", /secur|sicherheit/i],
  ["fixes", /fix|fehler|bug/i],
  ["improvements", /improv|verbessert|amélior/i],
  ["features", /^(new|neu|nouveau|added|features?|new features)$/i],
];
const SKIP = /^(new contributors|full changelog|all commits)/i;
const sectionOf = (heading) => (SECTIONS.find(([, re]) => re.test(heading)) || ["other"])[0];

const LIMITS = { versions: 20, items: 60, text: 400 };
const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
function decode(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, name) => {
    if (name[0] === "#") {
      const code = name[1] === "x" || name[1] === "X" ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : "";
    }
    return ENTITIES[name.toLowerCase()] ?? match;
  });
}
// One line of text: tags out, entities decoded, whitespace folded, no
// control characters, at most LIMITS.text characters.
function clean(text) {
  const plain = decode(
    String(text)
      .replace(/<br\s*\/?>/gi, " ")
      .replace(/<[^>]*>/g, ""),
  )
    .replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return plain.length > LIMITS.text ? `${plain.slice(0, LIMITS.text - 1)}…` : plain;
}
// Markdown inline marks out: [text](url) → text, `code`, **bold**, _em_.
const unmark = (text) =>
  text
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/(\*\*|__)(.+?)\1/g, "$2")
    .replace(/(^|\W)[*_](\S.*?\S|\S)[*_](?=\W|$)/g, "$1$2");

// [{ heading, item }] in the order of the note.
function blocksOf(note) {
  let text = String(note || "")
    // Folded parts (the commit list) and what never is text.
    .replace(/<details\b[\s\S]*?<\/details\s*>/gi, "")
    .replace(/<(script|style|template|iframe|object|svg|math)\b[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "");
  const blocks = [];
  if (/<(h[1-6]|li|p|ul|ol)\b/i.test(text)) {
    const re = /<(h[1-6]|li|p)\b[^>]*>([\s\S]*?)<\/\1\s*>/gi;
    const found = [];
    for (let m; (m = re.exec(text)); ) found.push({ tag: m[1].toLowerCase(), text: clean(m[2]) });
    const lists = found.some((f) => f.tag === "li");
    for (const f of found) {
      if (!f.text) continue;
      if (f.tag[0] === "h") blocks.push({ heading: f.text });
      // Paragraphs count only in notes without lists ("Full changelog: …").
      else if (f.tag === "li" || !lists) blocks.push({ item: f.text });
    }
    return blocks;
  }
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const heading = /^#{1,6}\s+(.*)$/.exec(line);
    const item = /^(?:[-*+]|\d+[.)])\s+(.*)$/.exec(line);
    if (heading) blocks.push({ heading: clean(unmark(heading[1])) });
    else if (item) blocks.push({ item: clean(unmark(item[1])) });
    else if (!/^\*\*full (changelog|history)/i.test(line)) blocks.push({ item: clean(unmark(line)) });
  }
  return blocks.filter((b) => b.heading || b.item);
}

// A note → its sections: [{ key, title, items }]; items without a heading
// go into an untitled section.
function sectionsOf(note) {
  const sections = [];
  let current = null;
  let skipping = false;
  let count = 0;
  for (const block of blocksOf(note)) {
    if (block.heading) {
      skipping = SKIP.test(block.heading);
      current = null;
      if (!skipping) {
        current = { key: sectionOf(block.heading), title: block.heading, items: [] };
        sections.push(current);
      }
      continue;
    }
    if (skipping || count >= LIMITS.items) continue;
    if (!current) {
      current = { key: "other", title: "", items: [] };
      sections.push(current);
    }
    current.items.push(block.item);
    count++;
  }
  return sections.filter((s) => s.items.length);
}

// electron-updater's releaseNotes → [{ version, sections }], newest first:
// the versions after the installed one up to the update, those with text.
function notesFromRelease(releaseNotes, { current, next } = {}) {
  const list = Array.isArray(releaseNotes)
    ? releaseNotes.filter((r) => r && typeof r === "object").map((r) => ({ version: String(r.version || ""), note: r.note }))
    : typeof releaseNotes === "string"
      ? [{ version: String(next || ""), note: releaseNotes }]
      : [];
  return list
    .filter((r) => parse(r.version) && (!parse(current) || compareVersions(r.version, current) > 0) && (!parse(next) || compareVersions(r.version, next) <= 0))
    .sort((a, b) => compareVersions(b.version, a.version))
    .slice(0, LIMITS.versions)
    .map((r) => ({ version: r.version.replace(/^v/, ""), sections: sectionsOf(r.note) }))
    .filter((r) => r.sections.length);
}

// "Neuigkeiten nach Updates" (settings.js): everything, only the breaking
// changes (and only versions that have some), or nothing.
function notesForLevel(list, level) {
  if (level === "never" || !Array.isArray(list)) return [];
  if (level !== "breaking") return list;
  return list
    .map((r) => ({ version: r.version, sections: r.sections.filter((s) => s.key === "breaking") }))
    .filter((r) => r.sections.length);
}
const hasBreaking = (list) => list.some((r) => r.sections.some((s) => s.key === "breaking"));

module.exports = { compareVersions, notesFromRelease, notesForLevel, hasBreaking, sectionsOf };
