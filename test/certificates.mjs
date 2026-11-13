// Self-signed certificates and private CAs (#271): the pin a profile keeps,
// the decision of the profiles' verify proc and that every request to an
// instance goes through Chromium (session.fetch) – Node alone, no Electron,
// no network. Usage: node test/certificates.mjs
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { hasOpenssl, selfSigned, electronCertificate } from "./certificate-fixtures.mjs";

const require = createRequire(import.meta.url);
const root = new URL("..", import.meta.url).pathname;
const certificates = require("../certificates.js");
const profiles = require("../profiles.js");
const { verifyDecision, describeCertificate, makePin, cleanPin, fingerprintOf, hostOf, normalizeHost, networkReason, isCertificateError } = certificates;

if (!hasOpenssl()) {
  console.error("openssl is needed to make the test certificates");
  process.exit(1);
}
const a = electronCertificate(selfSigned("flowplan.example.lan", ["DNS:flowplan.example.lan"]).cert);
const b = electronCertificate(selfSigned("flowplan.example.lan", ["DNS:flowplan.example.lan"]).cert);
const ip = electronCertificate(selfSigned("192.168.1.10", ["IP:192.168.1.10", "IP:::1"]).cert);
const HEX = /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/;
const host = "flowplan.example.lan";

// The fingerprint: SHA-256 of the certificate, the same from the PEM and from Electron's field.
{
  const fp = fingerprintOf(a);
  assert.match(fp, HEX);
  assert.equal(fingerprintOf({ fingerprint: a.fingerprint }), fp, "Electron's sha256/<base64> gives the same");
  assert.notEqual(fingerprintOf(b), fp, "another key, another fingerprint");
  assert.equal(fingerprintOf({}), null);
  assert.equal(fingerprintOf({ fingerprint: "sha1/abc" }), null);
  assert.equal(fingerprintOf({ data: "not a certificate", fingerprint: "nonsense" }), null);
  console.log("✔ SHA-256-Fingerabdruck");
}

// What the dialog shows: subject, issuer, validity, whether the names cover the host.
{
  const info = describeCertificate(a, "Flowplan.Example.LAN");
  assert.equal(info.host, host);
  assert.equal(info.subject, host);
  assert.equal(info.issuer, host, "self-signed: issuer = subject");
  assert.ok(Date.parse(info.validFrom) <= Date.now() && Date.parse(info.validTo) > Date.now());
  assert.equal(info.nameMatches, true);
  assert.equal(describeCertificate(a, "other.example.lan").nameMatches, false);
  assert.equal(describeCertificate(ip, "192.168.1.10").nameMatches, true, "an IP address in the certificate");
  assert.equal(describeCertificate(ip, "[::1]").nameMatches, true);
  assert.equal(describeCertificate(ip, "192.168.1.11").nameMatches, false);
  // Without the PEM (never expected): Electron's fields.
  const bare = describeCertificate({ fingerprint: a.fingerprint, subjectName: "x\u0000y", issuerName: "i", validStart: 0, validExpiry: 4102444800 }, host);
  assert.equal(bare.subject, "x y", "no control characters");
  assert.equal(bare.validTo, "2100-01-01T00:00:00.000Z");
  assert.equal(bare.nameMatches, null, "unknown without the PEM");
  console.log("✔ Zertifikat beschreiben");
}

// The pin: the host of the profile's own address, a valid fingerprint, nothing else.
{
  const now = Date.parse("2026-11-13T10:00:00Z");
  const pin = makePin(describeCertificate(a, host), now);
  assert.deepEqual(Object.keys(pin).sort(), ["fingerprint", "host", "issuer", "pinnedAt", "subject", "validFrom", "validTo"]);
  assert.equal(pin.host, host);
  assert.equal(pin.fingerprint, fingerprintOf(a));
  assert.equal(pin.pinnedAt, "2026-11-13T10:00:00.000Z");
  assert.deepEqual(cleanPin({ ...pin, extra: "<script>" }, host), pin, "unknown fields fall away");
  assert.deepEqual(cleanPin({ ...pin, fingerprint: pin.fingerprint.toLowerCase() }, host), pin, "case of the fingerprint");
  assert.equal(cleanPin(pin, "other.example.lan"), null, "never for another host");
  assert.equal(cleanPin(pin, ""), null);
  for (const bad of [null, "x", 1, [], { ...pin, fingerprint: "AB:CD" }, { ...pin, fingerprint: `${pin.fingerprint}:00` }, { ...pin, fingerprint: undefined }, { ...pin, host: undefined }])
    assert.equal(cleanPin(bad, host), null, JSON.stringify(bad));
  assert.equal(cleanPin({ ...pin, validTo: "never" }, host).validTo, null, "a broken date is no date");
  assert.equal(cleanPin({ ...pin, subject: "a\nb".repeat(400) }, host).subject.length, 300);
  // Hosts: case, trailing dot and brackets of IPv6 do not matter; the port is not part of it.
  assert.equal(hostOf("https://Flowplan.Example.LAN:8443"), host);
  assert.equal(hostOf("https://[::1]:8443"), "::1");
  assert.equal(normalizeHost("flowplan.example.lan."), host);
  assert.equal(hostOf("not a url"), "");
  console.log("✔ Gespeichertes Zertifikat (Pin)");
}

// The verify proc of a profile's session.
{
  const pin = makePin(describeCertificate(a, host));
  const request = (certificate, extra = {}) => ({ hostname: host, certificate, verificationResult: "net::ERR_CERT_AUTHORITY_INVALID", errorCode: -202, ...extra });
  // The system trusts it: Chromium's verdict, with or without a pin.
  assert.deepEqual(verifyDecision(request(b, { verificationResult: "net::OK", errorCode: 0 }), { host, pin }), { result: -3 });
  assert.deepEqual(verifyDecision(request(a, { verificationResult: "net::OK", errorCode: 0 }), { host }), { result: -3 });
  // The pinned certificate on its host: accepted.
  assert.deepEqual(verifyDecision(request(a), { host, pin }), { result: 0 });
  assert.deepEqual(verifyDecision(request(a, { hostname: "FLOWPLAN.example.lan" }), { host, pin }), { result: 0 });
  // Also when its names do not cover the host: the pin binds it to this host.
  assert.deepEqual(verifyDecision(request(a, { verificationResult: "net::ERR_CERT_COMMON_NAME_INVALID" }), { host, pin }), { result: 0 });
  // Never on another host – not even the same certificate (Chromium decides, no dialog).
  assert.deepEqual(verifyDecision(request(a, { hostname: "evil.example" }), { host, pin }), { result: -3 });
  assert.deepEqual(verifyDecision(request(a, { hostname: "flowplan.example.lan.evil.example" }), { host, pin }), { result: -3 });
  assert.deepEqual(verifyDecision(request(a, { hostname: "sub.flowplan.example.lan" }), { host, pin }), { result: -3 });
  assert.deepEqual(verifyDecision(request(a), { host: "other.example.lan", pin }), { result: -3 }, "a pin of another host never applies");
  assert.deepEqual(verifyDecision(request(a), { host, pin: { ...pin, host: "other.example.lan" } }), { result: -3, untrusted: "new", info: describeCertificate(a, host) });
  // Not pinned yet: Chromium refuses, the person can be asked.
  const fresh = verifyDecision(request(a), { host });
  assert.equal(fresh.result, -3);
  assert.equal(fresh.untrusted, "new");
  assert.equal(fresh.info.fingerprint, pin.fingerprint);
  // Another certificate than the pinned one: refused, with the new one to show.
  const changed = verifyDecision(request(b), { host, pin });
  assert.equal(changed.result, -2);
  assert.equal(changed.untrusted, "changed");
  assert.equal(changed.info.fingerprint, fingerprintOf(b));
  assert.notEqual(changed.info.fingerprint, pin.fingerprint);
  // Expired or not yet valid: refused, even when pinned.
  const later = Date.parse(pin.validTo) + 86_400_000;
  assert.deepEqual(verifyDecision(request(a, { verificationResult: "net::ERR_CERT_DATE_INVALID" }), { host, pin }, later).untrusted, "expired");
  assert.equal(verifyDecision(request(a), { host, pin }, later).result, -2);
  assert.equal(verifyDecision(request(a), { host }, later).untrusted, "expired", "an expired certificate is never offered");
  assert.equal(verifyDecision(request(a), { host, pin }, Date.parse(pin.validFrom) - 86_400_000).untrusted, "expired");
  assert.equal(verifyDecision(request(a), { host, pin }, Date.parse(pin.validTo) + 30_000).result, 0, "a minute of grace for clocks");
  // Revoked: refused.
  assert.deepEqual(verifyDecision(request(a, { verificationResult: "net::ERR_CERT_REVOKED" }), { host, pin }).result, -2);
  // Nothing to compare: refused.
  assert.deepEqual(verifyDecision(request({}), { host, pin }), { result: -2 });
  assert.deepEqual(verifyDecision(request(undefined), { host, pin }), { result: -2 });
  assert.deepEqual(verifyDecision({}, { host, pin }), { result: -3 });
  // IPv6 and IP addresses.
  const ipPin = makePin(describeCertificate(ip, "::1"));
  assert.deepEqual(verifyDecision({ hostname: "[::1]", certificate: ip, verificationResult: "net::ERR_CERT_AUTHORITY_INVALID" }, { host: hostOf("https://[::1]:8443"), pin: ipPin }), { result: 0 });
  console.log("✔ Prüfung im Profil: nur dieses Zertifikat für diesen Host");
}

// Profiles keep the pin (profiles.js).
{
  const pin = makePin(describeCertificate(a, host));
  const server = `https://${host}`;
  const loaded = profiles.loadProfiles({
    profiles: [
      { id: "a1", name: "Lab", server, certificate: pin },
      { id: "b2", name: "Other", server: "https://other.example.lan", certificate: pin },
      { id: "c3", name: "Port", server: `https://${host}:8443`, certificate: { ...pin, fingerprint: "nonsense" } },
    ],
    activeProfile: "a1",
  });
  assert.deepEqual(loaded.profiles[0].certificate, pin);
  assert.equal(loaded.profiles[1].certificate, undefined, "a pin for another host falls away");
  assert.equal(loaded.profiles[2].certificate, undefined, "a broken pin falls away");
  assert.deepEqual(profiles.toConfig(loaded).profiles[0].certificate, pin, "saved again");
  assert.equal("certificate" in profiles.toConfig(loaded).profiles[1], false);
  // Added with a pin, changed, removed.
  let { state, profile } = profiles.addProfile({ profiles: [], activeProfile: null }, { name: "", server, certificate: pin }, "abc");
  assert.deepEqual(profile.certificate, pin);
  assert.equal(profiles.addProfile({ profiles: [], activeProfile: null }, { server: "https://x.example", certificate: pin }).profile.certificate, undefined, "not for another host");
  const newer = makePin(describeCertificate(b, host));
  state = profiles.setCertificate(state, "abc", newer);
  assert.equal(profiles.findProfile(state, "abc").certificate.fingerprint, fingerprintOf(b));
  assert.throws(() => profiles.setCertificate(state, "abc", { ...newer, host: "evil.example" }), /invalid certificate/);
  assert.throws(() => profiles.setCertificate(state, "nope", newer), /unknown profile/);
  state = profiles.setCertificate(state, "abc", null);
  assert.equal("certificate" in profiles.findProfile(state, "abc"), false, "trust removed");
  assert.equal("certificate" in profiles.toConfig(state).profiles[0], false);
  console.log("✔ Profile speichern das vertraute Zertifikat");
}

// The cause of a failed request, for the messages.
{
  assert.equal(networkReason(new Error("net::ERR_CERT_AUTHORITY_INVALID")), "ERR_CERT_AUTHORITY_INVALID");
  assert.equal(networkReason(Object.assign(new TypeError("fetch failed"), { cause: { code: "DEPTH_ZERO_SELF_SIGNED_CERT" } })), "DEPTH_ZERO_SELF_SIGNED_CERT");
  assert.equal(networkReason(new DOMException("timeout", "TimeoutError")), "TimeoutError");
  assert.equal(networkReason(undefined), "network");
  for (const yes of ["ERR_CERT_AUTHORITY_INVALID", "ERR_CERT_DATE_INVALID", "ERR_CERT_COMMON_NAME_INVALID", "ERR_SSL_PROTOCOL_ERROR", "ERR_BAD_SSL_CLIENT_AUTH_CERT"]) assert.equal(isCertificateError(yes), true, yes);
  for (const no of ["ERR_NAME_NOT_RESOLVED", "ERR_CONNECTION_REFUSED", "TimeoutError", "", undefined]) assert.equal(isCertificateError(no), false, String(no));
  console.log("✔ Fehlergrund");
}

// Every request to an instance goes through Chromium (main.js): no Node fetch,
// no https module, never a blanket "ignore certificate errors".
{
  const main = readFileSync(join(root, "main.js"), "utf8");
  const sources = ["main.js", "instance-api.js", "notifier.js", "capture.js", "sign-in.js", "updates.js", "profiles.js", "certificates.js"].map((f) => readFileSync(join(root, f), "utf8")).join("\n");
  assert.doesNotMatch(main, /(?<![.\w])fetch\(/, "main.js: only session.fetch");
  assert.doesNotMatch(sources, /require\("(node:)?https?"\)/, "no Node http(s) requests");
  assert.doesNotMatch(sources, /ignore-certificate-errors|allow-insecure-localhost|NODE_TLS_REJECT_UNAUTHORIZED|rejectUnauthorized/);
  assert.doesNotMatch(sources, /on\("certificate-error"/, "no certificate-error handler that could accept");
  const check = main.slice(main.indexOf("async function checkServer"), main.indexOf("// ---- Certificates"));
  assert.match(check, /await ses\.fetch\(`\$\{origin\}\/api\/health`/, "the health check asks with a session");
  // A verify proc accepts (0) only what verifyDecision says.
  const procs = main.match(/setCertificateVerifyProc\([\s\S]*?\n {2}\}\);/g) || [];
  assert.equal(procs.length, 2, "the check's session and the profiles' sessions");
  for (const proc of procs) {
    assert.match(proc, /certificates\.verifyDecision\(request, \{ host/);
    assert.doesNotMatch(proc, /callback\(0\)/, "never accepted without the decision");
  }
  assert.match(main, /function sessionFor\(profile\) \{[\s\S]*?watchCertificates\(ses, profile\);/, "every session of a profile");
  // The trust dialog comes before any pin, and Cancel is the default.
  const trusting = main.slice(main.indexOf("async function checkServerTrusting"), main.indexOf("// A profile's session accepts"));
  assert.ok(trusting.indexOf("askCertificate") < trusting.indexOf("makePin"), "asked before pinned");
  assert.match(main, /buttons: \[restart \? t\("cert\.trustRestart"\) : previous \? t\("cert\.trustNew"\) : t\("cert\.trust"\), t\("cert\.cancel"\)\],\s*defaultId: 1,\s*cancelId: 1,/);
  // A profile's request waits for the person's answer: that answer is the verdict Chromium keeps.
  assert.match(main, /askForProfile\(owner, decision\)\.then\(\(trusted\) => callback\(trusted \? 0 : decision\.result\)\)/);
  // The profile's API and the notifier use the profile's session.
  assert.match(main, /createInstanceApi\(\{ origin: profile\.server, fetch: \(url, init\) => ses\.fetch\(url, init\) \}\)/);
  assert.match(readFileSync(join(root, "notifier.js"), "utf8"), /deps\.sessionFor\(profile\)\.fetch\(/);
  // The settings show and remove the pin.
  assert.match(readFileSync(join(root, "preload.js"), "utf8"), /removeCertificate: \(id\) => ipcRenderer\.invoke\("flowplan:remove-certificate", id\)/);
  assert.match(readFileSync(join(root, "pages", "profiles-page.js"), "utf8"), /desktop\.removeCertificate\(profile\.id\)/);
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  assert.ok(pkg.build.files.includes("certificates.js"), "packaged");
  const ci = readFileSync(join(root, ".github", "workflows", "ci.yml"), "utf8");
  assert.match(ci, /test:certificates\n/, "CI runs this test");
  assert.match(ci, /test:certificates-app/, "CI runs the app test");
  console.log("✔ Alle Anfragen an die Instanz über Chromium");
}

console.log("certificates: ok");
