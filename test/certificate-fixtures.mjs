// Self-signed certificates for the certificate tests (#271), made with
// openssl in a temporary folder – no key is kept in the repository.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { X509Certificate, createHash } from "node:crypto";

export function hasOpenssl() {
  try {
    execFileSync("openssl", ["version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

// A self-signed certificate for `names` (DNS names and IP addresses) → { key, cert } (PEM).
export function selfSigned(commonName = "localhost", names = ["DNS:localhost", "IP:127.0.0.1"], days = 3650) {
  const dir = mkdtempSync(join(tmpdir(), "flowplan-cert-"));
  const key = join(dir, "key.pem");
  const cert = join(dir, "cert.pem");
  execFileSync(
    "openssl",
    ["req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:prime256v1", "-nodes", "-keyout", key, "-out", cert, "-days", String(days), "-subj", `/CN=${commonName}`, "-addext", `subjectAltName=${names.join(",")}`],
    { stdio: "ignore" },
  );
  return { key: readFileSync(key, "utf8"), cert: readFileSync(cert, "utf8") };
}

// What Electron hands setCertificateVerifyProc as `certificate`.
export function electronCertificate(pem) {
  const x509 = new X509Certificate(pem);
  const cn = (dn) => /CN=([^\n,]+)/.exec(dn)?.[1] || "";
  return {
    data: pem,
    fingerprint: `sha256/${createHash("sha256").update(x509.raw).digest("base64")}`,
    subjectName: cn(x509.subject),
    issuerName: cn(x509.issuer),
    validStart: Math.floor(Date.parse(x509.validFrom) / 1000),
    validExpiry: Math.floor(Date.parse(x509.validTo) / 1000),
  };
}
