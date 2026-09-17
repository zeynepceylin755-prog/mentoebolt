/**
 * Storage Provider Interface — Phase 5F.8 (C)
 *
 * The smallest reasonable abstraction for safely persisting an uploaded binary
 * (image/PDF) and referring to it later. It deliberately mirrors the shape of the
 * existing provider contracts (IOcrProvider / IQuestionUnderstandingProvider):
 *
 *   - a provider owns the physical medium (local disk now, object storage later),
 *   - callers only ever hold an opaque `ref` (never a filesystem path),
 *   - swapping the backing store requires no business-logic change.
 *
 * Binary files are NEVER stored inside Prisma; only the opaque `ref` string is
 * persisted (QuestionIngestion.originalAssetRef / QuestionInstance.assetRef).
 */

/** Result of a successful store operation. */
export interface StoredAsset {
  /** Opaque, provider-owned reference. Safe to persist. Never a user filename. */
  ref: string;
  /** MIME type that was validated before storing. */
  mimeType: string;
  /** Byte length of the stored payload. */
  sizeBytes: number;
  /** SHA-256 content hash (hex) for integrity + idempotency support. */
  contentHash: string;
}

export interface StoreInput {
  /** Raw bytes to persist. */
  data: Buffer;
  /** Already-validated MIME type. */
  mimeType: string;
  /** Verified file extension (without dot), e.g. 'png'. Not user-controlled. */
  extension: string;
}

export interface IStorageProvider {
  /** Provider name for logging/audit. */
  getProviderName(): string;

  /** Persist bytes and return an opaque reference. */
  store(input: StoreInput): Promise<StoredAsset>;

  /**
   * Read bytes back for a previously stored reference.
   * Returns null when the reference is unknown to this provider.
   */
  read(ref: string): Promise<Buffer | null>;

  /** Delete a stored asset. Returns true when something was removed. */
  delete(ref: string): Promise<boolean>;
}
