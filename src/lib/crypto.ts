import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

/**
 * App-managed field encryption for commercially-sensitive audit data
 * (AES-256-GCM). Key from AUDIT_ENC_KEY (base64- or hex-encoded 32 bytes).
 *
 * Stored format: "enc:v1:" + base64(iv[12] | tag[16] | ciphertext).
 * If no key is configured, values pass through in clear (dev) and a one-time
 * warning is logged — production must set AUDIT_ENC_KEY.
 */

const PREFIX = "enc:v1:";
let warned = false;

function loadKey(): Buffer | null {
  const raw = process.env.AUDIT_ENC_KEY;
  if (!raw) {
    if (!warned) { console.warn("AUDIT_ENC_KEY not set — audit fields stored UNENCRYPTED (dev only)."); warned = true; }
    return null;
  }
  const buf = /^[0-9a-fA-F]{64}$/.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
  if (buf.length !== 32) throw new Error("AUDIT_ENC_KEY must decode to exactly 32 bytes (AES-256).");
  return buf;
}

export function encryptField(plain: string | null | undefined): string | null {
  if (plain == null) return null;
  const key = loadKey();
  if (!key) return plain;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(String(plain), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + Buffer.concat([iv, tag, ct]).toString("base64");
}

export function decryptField(stored: string | null | undefined): string | null {
  if (stored == null) return null;
  if (!stored.startsWith(PREFIX)) return stored; // legacy plaintext or unencrypted dev row
  const key = loadKey();
  if (!key) return stored;
  const raw = Buffer.from(stored.slice(PREFIX.length), "base64");
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const ct = raw.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}

/** Encrypt an integer (paise) for at-rest storage; returns text. */
export function encryptInt(n: number): string | null {
  return encryptField(String(Math.round(n)));
}
export function decryptInt(stored: string | null | undefined): number {
  const s = decryptField(stored);
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}
