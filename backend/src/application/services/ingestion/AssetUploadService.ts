import { IStorageProvider, StoredAsset } from '../../../domain/interfaces/storage/IStorageProvider.js';
import { validateUpload } from '../../../domain/ingestion/uploadValidation.js';
import { InvalidUploadError } from '../../../domain/errors/IngestionErrors.js';
import { logger } from '../../../infrastructure/logging/logger.js';

/**
 * AssetUploadService — Phase 5F.8 (C)
 *
 * The single, reusable entry point for accepting an uploaded binary and turning
 * it into a secure asset reference. It owns NO OCR and NO AI: it validates,
 * hashes and stores, then hands back an opaque `ref` that the existing ingestion
 * pipeline consumes as `QuestionIngestion.originalAssetRef`.
 *
 * Provenance is intentionally NOT decided here. The asset reference is inert
 * metadata; the ingestion's origin/trust come from its QuestionSource and the
 * existing provenance rules, so an upload can never claim MEB/HUMAN_APPROVED.
 */
export interface UploadedAsset {
  /** Opaque storage reference, safe to persist on the ingestion. */
  ref: string;
  mimeType: string;
  sizeBytes: number;
  contentHash: string;
}

export interface AssetUploadInput {
  data: Buffer;
  /** Declared MIME type from the client; verified against content signatures. */
  declaredMimeType: string;
  /**
   * Original filename, kept ONLY as non-authoritative metadata. It is never used
   * as a filesystem path.
   */
  originalFilename?: string;
}

export class AssetUploadService {
  constructor(
    private readonly storageProvider: IStorageProvider,
    private readonly maxBytes: number
  ) {}

  async storeUpload(input: AssetUploadInput): Promise<UploadedAsset> {
    const validation = validateUpload(input.data, input.declaredMimeType, this.maxBytes);

    if (!validation.valid || !validation.mimeType || !validation.extension) {
      throw new InvalidUploadError(reasonToMessage(validation.reason));
    }

    const stored: StoredAsset = await this.storageProvider.store({
      data: input.data,
      mimeType: validation.mimeType,
      extension: validation.extension,
    });

    // The filename is logged only as metadata (never used as a path), and only
    // its basename, to avoid echoing any directory component supplied by a user.
    logger.info(
      {
        provider: this.storageProvider.getProviderName(),
        contentHash: stored.contentHash,
        sizeBytes: stored.sizeBytes,
        mimeType: stored.mimeType,
        originalFilename: safeBasename(input.originalFilename),
      },
      'Uploaded asset stored'
    );

    return {
      ref: stored.ref,
      mimeType: stored.mimeType,
      sizeBytes: stored.sizeBytes,
      contentHash: stored.contentHash,
    };
  }
}

function reasonToMessage(reason?: string): string {
  switch (reason) {
    case 'EMPTY_FILE':
      return 'file is empty';
    case 'UNSUPPORTED_MIME_TYPE':
      return 'unsupported file type (allowed: image/png, image/jpeg, image/webp, application/pdf)';
    case 'CONTENT_TYPE_MISMATCH':
      return 'file content does not match the declared type';
    case 'OVERSIZED':
      return 'file is too large';
    default:
      return 'file could not be accepted';
  }
}

/** Return only the final path segment of a user-supplied filename (metadata only). */
export function safeBasename(filename?: string): string | null {
  if (typeof filename !== 'string' || filename.length === 0) {
    return null;
  }
  const normalized = filename.replace(/\\/g, '/');
  const base = normalized.split('/').pop() ?? '';
  return base.length > 0 ? base : null;
}
