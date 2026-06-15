import crypto from "crypto";

/**
 * Signed action tokens for email links (approval, vendor quotes).
 * HMAC-SHA256 over a base64url JSON payload — no DB lookup needed to verify,
 * but tokens are also stored so they can be single-use / revoked.
 */

const SECRET = () => {
  const s = process.env.TOKEN_SECRET;
  if (!s) throw new Error("Missing TOKEN_SECRET in .env.local");
  return s;
};

export interface TokenPayload {
  /** "approval" | "quote" */
  kind: string;
  /** purchase_request id or rfq_vendor id */
  id: string;
  /** approver/vendor email the link was issued to — binds the token to an identity for the audit trail */
  email?: string;
  /** unix seconds */
  exp: number;
}

function b64url(buf: Buffer) {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function sign(data: string) {
  return b64url(crypto.createHmac("sha256", SECRET()).update(data).digest());
}

export function createToken(payload: Omit<TokenPayload, "exp">, ttlDays = 14): string {
  const full: TokenPayload = { ...payload, exp: Math.floor(Date.now() / 1000) + ttlDays * 86400 };
  const body = b64url(Buffer.from(JSON.stringify(full)));
  return `${body}.${sign(body)}`;
}

export function verifyToken(token: string): TokenPayload | null {
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = sign(body);
  if (sig.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const payload = JSON.parse(Buffer.from(body.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString()) as TokenPayload;
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}
