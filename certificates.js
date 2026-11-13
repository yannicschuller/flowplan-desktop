// Self-signed certificates and private CAs (#271). Every request to an
// instance goes through Chromium's network stack (session.fetch), so a CA or
// certificate in the system's trust store just works. A certificate the
// system does not trust can be trusted for one profile: the person sees host,
// subject, issuer, validity and the SHA-256 fingerprint and confirms – the
// profile then remembers ("pins") exactly that certificate for exactly that
// host. The profile's session accepts it there and nowhere else
// (session.setCertificateVerifyProc with verifyDecision below).
//
// The rules:
// - A certificate the system trusts is accepted as always – also on a pinned
//   host (the pin adds trust, it never takes any away).
// - The pinned certificate is accepted only on the pin's host (never another
//   host, never another certificate), only while it is valid (expired or not
//   yet valid: refused) and never when revoked. A certificate whose names do
//   not cover the host is accepted when pinned: the pin binds it to the host
//   itself, and the dialog said so before.
// - Another untrusted certificate on a pinned host is refused, and the person
//   is warned with the old and new fingerprint (like SSH host keys).
//
// Plain functions without Electron, so test/certificates.mjs can run them
// with Node alone. A pin from config.json is checked again here.
const { X509Certificate } = require("node:crypto");

const FINGERPRINT = /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/;
const MAX_TEXT = 300;

// "[::1]" and "::1", "Example.LAN" and "example.lan" are one host.
function normalizeHost(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/^\[(.*)\]$/, "$1")
    .replace(/\.$/, "");
}
// The host part of an origin (no port: the verify proc knows hostnames only).
function hostOf(origin) {
  try {
    return normalizeHost(new URL(String(origin)).hostname);
  } catch {
    return "";
  }
}
const text = (value) =>
  String(value ?? "")
    .replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, " ")
    .trim()
    .slice(0, MAX_TEXT);
// Electron's "sha256/<base64>" → "AB:CD:…".
function fromElectronFingerprint(value) {
  const match = /^sha256\/([A-Za-z0-9+/=]+)$/.exec(String(value || ""));
  if (!match) return null;
  const bytes = Buffer.from(match[1], "base64");
  if (bytes.length !== 32) return null;
  return [...bytes].map((b) => b.toString(16).padStart(2, "0").toUpperCase()).join(":");
}
function parsed(certificate) {
  try {
    return certificate?.data ? new X509Certificate(certificate.data) : null;
  } catch {
    return null;
  }
}
// The SHA-256 fingerprint of the leaf certificate (of its DER bytes), as
// "AB:CD:…" – computed from the PEM, else from Electron's own field.
function fingerprintOf(certificate) {
  const x509 = parsed(certificate);
  if (x509) return x509.fingerprint256.toUpperCase();
  return fromElectronFingerprint(certificate?.fingerprint);
}
const seconds = (value) => (Number.isFinite(value) ? value * 1000 : NaN);
// What the dialogs show and the pin keeps: fingerprint, subject, issuer,
// validity (ISO dates) and whether the certificate's names cover the host.
function describeCertificate(certificate, host) {
  const x509 = parsed(certificate);
  const validFrom = x509 ? Date.parse(x509.validFrom) : seconds(certificate?.validStart);
  const validTo = x509 ? Date.parse(x509.validTo) : seconds(certificate?.validExpiry);
  const wanted = normalizeHost(host);
  let nameMatches = null;
  if (x509 && wanted) {
    try {
      nameMatches = /^[0-9.]+$|:/.test(wanted) ? !!x509.checkIP(wanted) : !!x509.checkHost(wanted);
    } catch {
      nameMatches = false;
    }
  }
  return {
    host: wanted,
    fingerprint: fingerprintOf(certificate),
    subject: text(certificate?.subjectName || certificate?.subject?.commonName || x509?.subject),
    issuer: text(certificate?.issuerName || certificate?.issuer?.commonName || x509?.issuer),
    validFrom: Number.isFinite(validFrom) ? new Date(validFrom).toISOString() : null,
    validTo: Number.isFinite(validTo) ? new Date(validTo).toISOString() : null,
    nameMatches,
  };
}
// Within its validity at `now` (a minute of grace for clocks).
function isCurrent(info, now = Date.now()) {
  const from = Date.parse(info?.validFrom);
  const to = Date.parse(info?.validTo);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return false;
  return from - 60_000 <= now && now <= to + 60_000;
}
// The pin a profile keeps: { host, fingerprint, subject, issuer, validFrom,
// validTo, pinnedAt }. From a description the person confirmed.
function makePin(info, now = Date.now()) {
  return cleanPin({ ...info, pinnedAt: new Date(now).toISOString() }, info?.host);
}
// A pin from config.json, checked: the right shape, the host of the
// profile's own address. Anything else → null (no pin).
function cleanPin(value, host) {
  if (!value || typeof value !== "object") return null;
  const wanted = normalizeHost(host);
  if (!wanted || normalizeHost(value.host) !== wanted) return null;
  const fingerprint = String(value.fingerprint || "").toUpperCase();
  if (!FINGERPRINT.test(fingerprint)) return null;
  const date = (v) => (typeof v === "string" && Number.isFinite(Date.parse(v)) ? new Date(Date.parse(v)).toISOString() : null);
  return {
    host: wanted,
    fingerprint,
    subject: text(value.subject),
    issuer: text(value.issuer),
    validFrom: date(value.validFrom),
    validTo: date(value.validTo),
    pinnedAt: date(value.pinnedAt),
  };
}

// The decision of session.setCertificateVerifyProc for one profile's
// session. `request` is Electron's ({ hostname, certificate,
// verificationResult }), `host` the profile's host, `pin` its pin (or null).
// Returns { result, untrusted?, info? }: result is what the callback gets
// (0 accept, -2 refuse, -3 Chromium's own verdict); `untrusted` says why a
// certificate of the profile's own host is not accepted – "new" (no pin yet:
// it can be trusted), "changed" (another certificate than the pinned one),
// "expired" (outside its validity) or "revoked" – with `info` describing it.
function verifyDecision(request, { host, pin = null } = {}, now = Date.now()) {
  const hostname = normalizeHost(request?.hostname);
  // The system trusts it: as always.
  if (request?.verificationResult === "net::OK") return { result: -3 };
  // Another host than the profile's own: Chromium decides, no pin applies.
  if (!hostname || hostname !== normalizeHost(host)) return { result: -3 };
  const info = describeCertificate(request?.certificate, hostname);
  if (!info.fingerprint) return { result: -2 };
  if (request?.verificationResult === "net::ERR_CERT_REVOKED") return { result: -2, untrusted: "revoked", info };
  if (!isCurrent(info, now)) return { result: -2, untrusted: "expired", info };
  const own = pin && normalizeHost(pin.host) === hostname ? pin : null;
  if (!own) return { result: -3, untrusted: "new", info };
  if (own.fingerprint !== info.fingerprint) return { result: -2, untrusted: "changed", info };
  return { result: 0 };
}

// "net::ERR_CERT_AUTHORITY_INVALID" from an error of session.fetch (or the
// code of Node's fetch) for the messages.
function networkReason(error) {
  const match = /net::(ERR_[A-Z0-9_]+)/.exec(String(error?.message || ""));
  if (match) return match[1];
  // A DOMException's numeric code (23 for a timeout) says less than its name.
  const code = typeof error?.code === "string" ? error.code : null;
  return String(error?.cause?.code || code || error?.name || "network");
}
const isCertificateError = (reason) => /^ERR_(CERT_|SSL_|BAD_SSL_)/.test(String(reason || ""));

module.exports = {
  normalizeHost,
  hostOf,
  fingerprintOf,
  fromElectronFingerprint,
  describeCertificate,
  isCurrent,
  makePin,
  cleanPin,
  verifyDecision,
  networkReason,
  isCertificateError,
};
