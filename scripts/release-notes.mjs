// The GitHub release's notes from the curated file of the version (#223):
//   node scripts/release-notes.mjs 1.2.3 > notes.md
// release-notes/1.2.3.json holds breaking, security, features,
// improvements and fixes – short lines in German and English (French and
// Chinese optional), with optional issue numbers. The notes are those
// sections in English, then the commits since the last release tag folded
// away under "All commits". The release body is what installed apps show
// under "Was ist neu?" (electron-updater reads it from the release feed;
// release-notes.js turns it into text). Without the file the script says
// so and exits with 2: the workflow then uses GitHub's generated notes. A
// broken file stops the release with the reasons (exit 1).
//
// Run before the release commit and tag (the commits since the last tag).
// Plain Node.js without dependencies; the same format as the server's
// scripts/release-notes.mjs in yannicschuller/flowplan.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const SECTIONS = [
  ["breaking", "Breaking changes"],
  ["security", "Security"],
  ["features", "New"],
  ["improvements", "Improved"],
  ["fixes", "Bug fixes"],
];
const KEYS = new Set(["$schema", "date", ...SECTIONS.map(([key]) => key)]);
const ITEM_KEYS = new Set(["de", "en", "fr", "zh", "issues"]);

// What is wrong with a curated file (an empty list: nothing).
export function checkNotes(data) {
  const errors = [];
  if (!data || typeof data !== "object" || Array.isArray(data)) return ["not a JSON object"];
  for (const key of Object.keys(data)) if (!KEYS.has(key)) errors.push(`unknown key "${key}"`);
  if (data.date !== undefined && !(typeof data.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(data.date))) errors.push('"date" is not YYYY-MM-DD');
  let items = 0;
  for (const [key] of SECTIONS) {
    const list = data[key];
    if (list === undefined) continue;
    if (!Array.isArray(list)) {
      errors.push(`"${key}" is not a list`);
      continue;
    }
    if (list.length > 60) errors.push(`"${key}" has more than 60 items`);
    list.forEach((item, i) => {
      const where = `${key}[${i}]`;
      if (!item || typeof item !== "object" || Array.isArray(item)) return errors.push(`${where} is not an object`);
      items++;
      for (const k of Object.keys(item)) if (!ITEM_KEYS.has(k)) errors.push(`${where}: unknown key "${k}"`);
      for (const lang of ["de", "en", "fr", "zh"]) {
        const text = item[lang];
        if (text === undefined && (lang === "fr" || lang === "zh")) continue;
        if (typeof text !== "string" || text.trim().length < 3) errors.push(`${where}.${lang} is missing`);
        else if (text.trim().length > 300) errors.push(`${where}.${lang} is longer than 300 characters`);
        else if (/[\r\n]/.test(text)) errors.push(`${where}.${lang} has a line break`);
      }
      if (item.issues !== undefined && !(Array.isArray(item.issues) && item.issues.length <= 10 && item.issues.every((n) => Number.isInteger(n) && n > 0)))
        errors.push(`${where}.issues is not a list of issue numbers`);
    });
  }
  if (!items) errors.push("no items");
  return errors;
}

const escape = (text) => text.replace(/([\\[\]])/g, "\\$1");
export const commitLines = (commits, url) => commits.map((c) => `- ${escape(c.subject)} ([${c.sha.slice(0, 7)}](${url}/commit/${c.sha}))`);

// The curated sections in English, empty ones left out; issue links point to
// the server repository, where the issues live.
export function curatedMarkdown(notes, issuesUrl) {
  const parts = [];
  for (const [key, heading] of SECTIONS) {
    const list = notes[key] || [];
    if (!list.length) continue;
    const lines = list.map((item) => {
      const issues = (item.issues || []).map((n) => `[#${n}](${issuesUrl}/${n})`);
      const text = item.en.trim();
      const [line, stop] = text.endsWith(".") ? [text.slice(0, -1), "."] : [text, ""];
      return `- ${line}${issues.length ? ` (${issues.join(", ")})` : ""}${stop}`;
    });
    parts.push(`### ${heading}\n\n${lines.join("\n")}`);
  }
  return parts.join("\n\n");
}

export function renderNotes({ version, previous, commits, curated, url, issuesUrl }) {
  const lines = commitLines(commits, url);
  const all = `<details>\n<summary>All commits</summary>\n\n${(lines.length ? lines : ["- Maintenance release without code changes."]).join("\n")}\n\n</details>`;
  const link = previous
    ? `**Full changelog:** [${previous}...v${version}](${url}/compare/${previous}...v${version})`
    : `**Full history:** [commits](${url}/commits/v${version})`;
  return `${curatedMarkdown(curated, issuesUrl)}\n\n${all}\n\n${link}`;
}

// The curated notes of a version: null without a file; a broken file throws.
export function readCurated(version, dir = "release-notes") {
  const file = `${dir}/${version}.json`;
  if (!existsSync(file)) return null;
  let data;
  try {
    data = JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    throw new Error(`${file} is not valid JSON: ${e.message}`);
  }
  const errors = checkNotes(data);
  if (errors.length) throw new Error(`${file} is not valid:\n- ${errors.join("\n- ")}`);
  return data;
}

function main() {
  const version = process.argv[2];
  if (!/^\d+\.\d+\.\d+$/.test(version || "")) {
    console.error("Usage: node scripts/release-notes.mjs 1.2.3");
    process.exit(1);
  }
  let curated;
  try {
    curated = readCurated(version);
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
  if (!curated) {
    console.error(`No curated notes in release-notes/${version}.json.`);
    process.exit(2);
  }
  const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();
  const repo = (process.env.GITHUB_REPOSITORY || "yannicschuller/flowplan-desktop").replace(/\.git$/, "");
  const url = `https://github.com/${repo}`;
  let previous = "";
  try {
    previous = git("describe", "--tags", "--abbrev=0", "--match", "v*.*.*", "--exclude", `v${version}`, "HEAD");
  } catch {}
  const commits = git("log", previous ? `${previous}..HEAD` : "HEAD", "--no-merges", "--format=%H%x09%s")
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [sha, ...subject] = line.split("\t");
      return { sha, subject: subject.join("\t") };
    })
    .filter((c) => !/^Release v\d/.test(c.subject));
  process.stdout.write(`${renderNotes({ version, previous, commits, curated, url, issuesUrl: "https://github.com/yannicschuller/flowplan/issues" })}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
