/**
 * Upload validation — Phase 5F.8 (C3)
 *
 * Deterministic, dependency-free validation of an uploaded binary before it is
 * ever written to storage. Two independent checks are performed:
 *
 *   1. the DECLARED MIME type (what the client claims),
 *   2. MAGIC-BYTE sniffing of the actual content (what the bytes really are).
 *
 * Both must agree on an allowed type. Trusting the client-provided MIME alone is
 * unsafe (a renamed .exe would pass), so the content signature is authoritative.
 */

export const ALLOWED_UPLOAD_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'application/pdf',
] as const;

export type AllowedUploadMimeType = (typeof ALLOWED_UPLOAD_MIME_TYPES)[number];

/** Canonical extension for each allowed type (server-controlled, not user input). */
export const MIME_TO_EXTENSION: Record<AllowedUploadMimeType, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
};

export type UploadValidationReason =
  | 'EMPTY_FILE'
  | 'UNSUPPORTED_MIME_TYPE'
  | 'CONTENT_TYPE_MISMATCH'
  | 'OVERSIZED';

export interface UploadValidationResult {
  valid: boolean;
  reason?: UploadValidationReason;
  /** The agreed allowed MIME type when valid. */
  mimeType?: AllowedUploadMimeType;
  /** The canonical extension when valid. */
  extension?: string;
}

/**
 * Sniff the real MIME type from the leading bytes.
 *
 * Returns null when the content does not match any supported type. This is a
 * small, explicit signature table (no external dependency) covering exactly the
 * formats this phase allows.
 */
export function sniffMimeType(data: Buffer): AllowedUploadMimeType | null {
  if (!Buffer.isBuffer(data) || data.length < 4) {
    return null;
  }

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    data.length >= 8 &&
    data[0] === 0x89 &&
    data[1] === 0x50 &&
    data[2] === 0x4e &&
    data[3] === 0x47 &&
    data[4] === 0x0d &&
    data[5] === 0x0a &&
    data[6] === 0x1a &&
    data[7] === 0x0a
  ) {
    return 'image/png';
  }

  // JPEG: FF D8 FF
  if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) {
    return 'image/jpeg';
  }

  // WEBP: 'RIFF' .... 'WEBP'
  if (
    data.length >= 12 &&
    data.toString('ascii', 0, 4) === 'RIFF' &&
    data.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'image/webp';
  }

  // PDF: '%PDF-' (allow a small leading junk window, per spec)
  const head = data.toString('ascii', 0, Math.min(data.length, 1024));
  const pdfIndex = head.indexOf('%PDF-');
  if (pdfIndex !== -1 && pdfIndex <= 1024) {
    return 'application/pdf';
  }

  return null;
}

/**
 * Validate an upload. `maxBytes` is enforced here as well as at the body-parser
 * layer (defence in depth).
 */
export function validateUpload(
  data: unknown,
  declaredMimeType: unknown,
  maxBytes: number
): UploadValidationResult {
  if (!Buffer.isBuffer(data) || data.byteLength === 0) {
    return { valid: false, reason: 'EMPTY_FILE' };
  }

  if (typeof maxBytes === 'number' && maxBytes > 0 && data.byteLength > maxBytes) {
    return { valid: false, reason: 'OVERSIZED' };
  }

  const declared = typeof declaredMimeType === 'string' ? declaredMimeType.toLowerCase() : '';
  if (!isAllowedMime(declared)) {
    return { valid: false, reason: 'UNSUPPORTED_MIME_TYPE' };
  }

  const sniffed = sniffMimeType(data);
  if (sniffed === null || sniffed !== declared) {
    return { valid: false, reason: 'CONTENT_TYPE_MISMATCH' };
  }

  return { valid: true, mimeType: sniffed, extension: MIME_TO_EXTENSION[sniffed] };
}

export function isAllowedMime(value: string): value is AllowedUploadMimeType {
  return (ALLOWED_UPLOAD_MIME_TYPES as readonly string[]).includes(value);
}
