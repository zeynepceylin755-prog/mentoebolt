import { Response, NextFunction } from 'express';
import { AssetUploadService } from '../../application/services/ingestion/AssetUploadService.js';
import { QuestionIngestionService } from '../../application/services/ingestion/QuestionIngestionService.js';
import { AuthRequest } from '../middleware/auth.js';
import { AuthenticationError } from '../../domain/errors/AuthenticationError.js';
import { InvalidUploadError } from '../../domain/errors/IngestionErrors.js';

/** Decode a header-supplied filename, falling back to the raw value. */
function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * HTTP boundary for student asset upload — Phase 5F.8 (C5).
 *
 * Flow: browser → validate → store (IStorageProvider) → create QuestionIngestion
 * with the secure asset reference. It does NOT call OCR: the created ingestion
 * enters the EXISTING pipeline (which analyses later, via the mock provider in
 * development).
 *
 * Transport: the request body is the RAW file bytes (`application/octet-stream`
 * or the file's own MIME type), parsed by `express.raw` scoped to this route
 * only. Sending raw bytes (rather than base64-in-JSON) is deliberate: the global
 * JSON input sanitizer escapes characters that legitimately occur in binary and
 * would corrupt the payload. A raw Buffer body is left untouched by that
 * middleware.
 *
 * The declared MIME type comes from the `Content-Type` header; the original
 * filename (metadata only, never a path) comes from the `X-Upload-Filename`
 * header. Both are re-validated server-side in AssetUploadService.
 */
export class AssetUploadController {
  constructor(
    private readonly assetUploadService: AssetUploadService,
    private readonly ingestionService: QuestionIngestionService
  ) {}

  uploadAsset = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = this.requireUserId(req);

      const data = req.body;
      if (!Buffer.isBuffer(data)) {
        throw new InvalidUploadError('request body must be raw file bytes');
      }

      const contentType = String(req.headers['content-type'] ?? '');
      // Strip any parameters (e.g. "; charset=...") from the declared type.
      const declaredMimeType = contentType.split(';')[0].trim().toLowerCase();

      const rawFilename = req.headers['x-upload-filename'];
      const originalFilename =
        typeof rawFilename === 'string' ? safeDecode(rawFilename) : undefined;

      const rawSourceId = req.query.sourceId;
      const sourceId =
        typeof rawSourceId === 'string' && rawSourceId.length > 0 ? rawSourceId : undefined;

      const asset = await this.assetUploadService.storeUpload({
        data,
        declaredMimeType,
        originalFilename,
      });

      // Provenance note (C5): the ingestion is created through the existing
      // service with an asset reference only. Origin/trust derive from the
      // QuestionSource (or default), never from upload metadata, so an upload
      // cannot claim MEB / HUMAN_APPROVED.
      const ingestion = await this.ingestionService.createIngestion(userId, {
        ingestMethod: 'IMAGE_UPLOAD',
        originalAssetRef: asset.ref,
        originalAssetMimeType: asset.mimeType,
        originalAssetSizeBytes: asset.sizeBytes,
        sourceId,
      });

      res.status(201).json({
        success: true,
        data: {
          ingestion,
          asset: {
            mimeType: asset.mimeType,
            sizeBytes: asset.sizeBytes,
            contentHash: asset.contentHash,
          },
        },
      });
    } catch (error) {
      next(error);
    }
  };

  private requireUserId(req: AuthRequest): string {
    if (!req.userId) {
      throw new AuthenticationError('Authentication required');
    }
    return req.userId;
  }
}
