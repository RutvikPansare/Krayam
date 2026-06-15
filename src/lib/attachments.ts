/**
 * Feature 11 — spec-sheet attachment helpers.
 *
 * Allowed types, server-side magic-byte sniffing (never trust the client's
 * declared content type), org/PR-prefixed storage paths (customer isolation at
 * the storage layer), and 7-day signed download URLs.
 */

export const ATTACH_BUCKET = "attachments";
export const MAX_ATTACH_BYTES = 10 * 1024 * 1024; // 10 MB
export const MAX_ATTACH_PER_PR = 3;
export const SIGNED_URL_TTL_S = 7 * 24 * 60 * 60; // 7 days

export interface AllowedType { ext: string; mime: string; label: string }
export const ALLOWED_TYPES: AllowedType[] = [
  { ext: "pdf", mime: "application/pdf", label: "PDF" },
  { ext: "png", mime: "image/png", label: "PNG" },
  { ext: "jpg", mime: "image/jpeg", label: "JPG" },
  { ext: "jpeg", mime: "image/jpeg", label: "JPG" },
  { ext: "dwg", mime: "image/vnd.dwg", label: "DWG" },
];

export function extOf(name: string): string {
  return name.split(".").pop()?.toLowerCase() ?? "";
}
export function allowedExt(name: string): AllowedType | null {
  return ALLOWED_TYPES.find((t) => t.ext === extOf(name)) ?? null;
}

/**
 * Magic-byte sniff — validates the ACTUAL bytes, not the client's content-type.
 * Returns the detected mime, or null if it matches no allowed signature.
 */
export function sniffMime(bytes: Uint8Array): string | null {
  const b = bytes;
  // PDF: "%PDF"
  if (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return "application/pdf";
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  // JPEG: FF D8 FF
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  // DWG: "AC10".."AC10xx" (e.g. AC1015, AC1027, AC1032)
  if (b[0] === 0x41 && b[1] === 0x43 && b[2] === 0x31 && b[3] === 0x30) return "image/vnd.dwg";
  return null;
}

/** Storage key: <org>/<pr|staging>/<uuid>.<ext> — org prefix isolates tenants. */
export function buildStoragePath(orgId: string, prId: string | null, fileName: string): string {
  const ext = extOf(fileName) || "bin";
  return `${orgId}/${prId ?? "staging"}/${crypto.randomUUID()}.${ext}`;
}

/** Move a staged file to its PR folder once the PR exists (keeps org prefix). */
export function prPathFromStaging(stagingPath: string, prId: string): string {
  // stagingPath = <org>/staging/<uuid>.<ext>
  const [org, , file] = stagingPath.split("/");
  return `${org}/${prId}/${file}`;
}
