// Touch ID for passkeys in the macOS app (#356), prepared by the release
// workflow – only when the secret MAC_PROVISIONING_PROFILE holds a Developer
// ID provisioning profile for app.flowplan.desktop (its keychain-access-groups,
// <TEAM>.* by default, must cover the passkey group).
// Without it, nothing of this runs: the app keeps build/entitlements.mac.plist
// and no profile, and passkeys go to the browser as before.
//
// With it, this script
//   1. checks the profile's entitlements (plutil -extract Entitlements json)
//      against the team: application identifier, team, keychain groups –
//      an app whose entitlements the profile does not cover does not launch,
//   2. writes the main app's entitlements: build/entitlements.mac.plist plus
//      keychain-access-groups (<TEAM_ID>.app.flowplan.desktop.webauthn),
//      com.apple.application-identifier and com.apple.developer.team-identifier
//      (the helpers keep entitlementsInherit, unchanged),
//   3. names the keychain group in build/update.json ("touchID"), which the
//      app reads to switch Touch ID on (sign-in.js enableTouchId).
//
// Usage: node scripts/touchid.mjs <team id> <profile entitlements .json> <entitlements out .plist>
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

export const BUNDLE_ID = "app.flowplan.desktop";
const TEAM = /^[A-Z0-9]{10}$/;

export const keychainGroup = (team) => `${team}.${BUNDLE_ID}.webauthn`;

// What keeps the profile from covering the entitlements; [] when it does.
export function profileProblems(entitlements, team) {
  if (!TEAM.test(String(team || ""))) return [`APPLE_TEAM_ID is not a team id: "${team}"`];
  const problems = [];
  const e = entitlements && typeof entitlements === "object" ? entitlements : {};
  const appId = `${team}.${BUNDLE_ID}`;
  if (e["com.apple.application-identifier"] !== appId) problems.push(`the profile is for "${e["com.apple.application-identifier"]}", not ${appId}`);
  if (e["com.apple.developer.team-identifier"] !== team) problems.push(`the profile belongs to team "${e["com.apple.developer.team-identifier"]}", not ${team}`);
  const groups = Array.isArray(e["keychain-access-groups"]) ? e["keychain-access-groups"] : [];
  const group = keychainGroup(team);
  const covered = groups.some((g) => g === group || (typeof g === "string" && g.endsWith(".*") && group.startsWith(g.slice(0, -1))));
  if (!covered) problems.push(`the profile has no keychain-access-groups covering ${group} (a Developer ID profile for app.flowplan.desktop normally lists <TEAM>.*) – it lists ${JSON.stringify(groups)}`);
  return problems;
}

const escape = (text) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// The base entitlements with the Touch ID keys before the closing </dict>.
export function touchIdEntitlements(base, team) {
  if (!TEAM.test(String(team || ""))) throw new Error(`not a team id: "${team}"`);
  for (const key of ["keychain-access-groups", "com.apple.application-identifier", "com.apple.developer.team-identifier"])
    if (base.includes(`<key>${key}</key>`)) throw new Error(`the base entitlements already have ${key}`);
  const end = base.lastIndexOf("</dict>");
  if (end < 0) throw new Error("no </dict> in the base entitlements");
  const lineStart = base.lastIndexOf("\n", end) + 1;
  const keys = [
    "    <!-- Touch ID for passkeys (#356): backed by the embedded provisioning profile -->",
    "    <key>com.apple.application-identifier</key>",
    `    <string>${escape(`${team}.${BUNDLE_ID}`)}</string>`,
    "    <key>com.apple.developer.team-identifier</key>",
    `    <string>${escape(team)}</string>`,
    "    <key>keychain-access-groups</key>",
    "    <array>",
    `      <string>${escape(keychainGroup(team))}</string>`,
    "    </array>",
  ].join("\n");
  return `${base.slice(0, lineStart)}${keys}\n${base.slice(lineStart)}`;
}

// build/update.json with the keychain group; the rest as it was.
export function withTouchId(info, team) {
  return { ...info, touchID: keychainGroup(team) };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [team, profileJson, out] = process.argv.slice(2);
  if (!team || !profileJson || !out) {
    console.error("Usage: node scripts/touchid.mjs <team id> <profile entitlements .json> <entitlements out .plist>");
    process.exit(2);
  }
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const problems = profileProblems(JSON.parse(readFileSync(profileJson, "utf8")), team);
  if (problems.length) {
    for (const problem of problems) console.error(`::error title=MAC_PROVISIONING_PROFILE::${problem}`);
    process.exit(1);
  }
  writeFileSync(out, touchIdEntitlements(readFileSync(join(root, "build", "entitlements.mac.plist"), "utf8"), team));
  const infoPath = join(root, "build", "update.json");
  const info = JSON.parse(readFileSync(infoPath, "utf8"));
  writeFileSync(infoPath, `${JSON.stringify(withTouchId(info, team), null, 2)}\n`);
  console.log(`Touch ID: keychain group ${keychainGroup(team)}`);
}
