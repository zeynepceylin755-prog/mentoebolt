import { Router, raw } from 'express';
import { QuestionIngestionController } from '../controllers/QuestionIngestionController.js';
import { AssetUploadController } from '../controllers/AssetUploadController.js';
import { AuthMiddleware } from '../middleware/auth.js';
import { validate } from '../middleware/validation.js';
import { idempotencyKeyOptional } from '../middleware/idempotency.js';
import { z } from 'zod';

/**
 * Routes follow the existing project convention (see assessmentRoutes.ts):
 *   - mounted under /api/v1
 *   - authMiddleware.authenticate applied to the whole router
 *   - zod `validate` for bodies
 *   - idempotency middleware where a duplicate submission would cause harm
 *
 * Endpoints (brief §16) mapped onto the existing versioning convention:
 *   POST /api/v1/question-ingestions
 *   GET  /api/v1/question-ingestions/:id
 *   POST /api/v1/question-ingestions/:id/transition
 */

const INGESTION_STATES = [
  'INGESTED',
  'EXTRACTED',
  'EXTRACTION_FAILED',
  'NORMALIZED',
  'ANALYZED',
  'MAPPED',
  'REVIEW_REQUIRED',
  'APPROVED',
  'REJECTED',
] as const;

// Phase 6.7: `studentId` is removed from the public ingestion contract. The
// ingestion owner is ALWAYS the authenticated principal (`ingestedByUserId`);
// zod strips unknown keys, so a client-supplied studentId is dropped and can
// never influence ownership.
const createIngestionSchema = z.object({
  ingestMethod: z.enum(['IMAGE_UPLOAD', 'TEXT_PASTE', 'PDF', 'BANK_IMPORT']),
  rawText: z.string().optional(),
  normalizedText: z.string().optional(),
  sourceId: z.string().optional(),
  originalAssetRef: z.string().optional(),
  originalAssetMimeType: z.string().optional(),
  originalAssetSizeBytes: z.number().int().nonnegative().optional(),
  ocrConfidence: z.number().min(0).max(1).optional(),
  parsingConfidence: z.number().min(0).max(1).optional(),
});

const transitionSchema = z.object({
  toState: z.enum(INGESTION_STATES),
  reviewNotes: z.string().max(2000).optional(),
});

const analyzeSchema = z.object({
  ocrText: z.string().optional(),
  ocrConfidence: z.number().min(0).max(1).optional(),
  normalizedText: z.string().optional(),
  skipOcr: z.boolean().optional(),
});

/**
 * Max accepted raw upload size. Kept in sync with the service limit; the raw
 * parser is scoped to the upload route only so no other route's body handling
 * changes.
 */
const MAX_UPLOAD_BYTES = Number(process.env.MAX_UPLOAD_BYTES) || 7 * 1024 * 1024;

export function createQuestionIngestionRoutes(
  ingestionController: QuestionIngestionController,
  authMiddleware: AuthMiddleware,
  assetUploadController?: AssetUploadController
): Router {
  const router = Router();

  router.use(authMiddleware.authenticate);

  // Phase 5F.8 (C): browser upload → validated → stored → ingestion created.
  // Raw binary body (not JSON) so the global JSON sanitizer cannot corrupt the
  // bytes. `express.raw` is applied to THIS route only.
  if (assetUploadController) {
    router.post(
      '/question-ingestions/upload',
      raw({ type: () => true, limit: MAX_UPLOAD_BYTES }),
      assetUploadController.uploadAsset
    );
  }

  router.post(
    '/question-ingestions',
    idempotencyKeyOptional(),
    validate(createIngestionSchema),
    ingestionController.createIngestion
  );

  router.get('/question-ingestions/:id', ingestionController.getIngestion);

  router.post(
    '/question-ingestions/:id/transition',
    idempotencyKeyOptional(),
    validate(transitionSchema),
    ingestionController.transitionIngestion
  );

  router.post(
    '/question-ingestions/:id/analyze',
    idempotencyKeyOptional(),
    validate(analyzeSchema),
    ingestionController.analyzeIngestion
  );

  router.post(
    '/question-ingestions/:id/create-canonical',
    ingestionController.createCanonicalQuestion
  );

  return router;
}
