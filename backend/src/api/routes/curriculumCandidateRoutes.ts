import { Router } from 'express';
import { CurriculumCandidateController } from '../controllers/CurriculumCandidateController.js';
import { AuthMiddleware } from '../middleware/auth.js';
import { validate } from '../middleware/validation.js';
import { idempotencyKeyOptional } from '../middleware/idempotency.js';
import { z } from 'zod';

/**
 * Routes follow the existing /api/v1 convention (see assessmentRoutes.ts and
 * questionIngestionRoutes.ts): router-level authenticate, zod body validation,
 * optional Idempotency-Key on mutations.
 *
 * Endpoints (brief §21) adapted to this repository's nested-resource style:
 *   POST /api/v1/questions/:questionId/curriculum-candidates
 *   GET  /api/v1/questions/:questionId/curriculum-candidates
 *   GET  /api/v1/curriculum-candidates/:id
 *   POST /api/v1/curriculum-candidates/:id/review
 *
 * Role gating is enforced in the service layer (see
 * CurriculumCandidateService.assertMayMutate) so the rule holds regardless of
 * the transport; no route-level authorize() is duplicated here.
 *
 * Phase 6.7 (IDOR/info-disclosure): the READ surfaces are staff-only too. A
 * candidate references the curriculum ancestry of a (possibly another
 * student's UNVERIFIED) upload; a student holding a `questionId`/candidate id
 * must not be able to enumerate it. The student journey never reads these
 * endpoints, so this narrows access without breaking any legitimate flow.
 */

/** Staff roles permitted to read curriculum-governance artefacts. */
const CANDIDATE_READ_ROLES = ['ADMIN', 'CONTENT_MANAGER', 'TEACHER'];

const CANDIDATE_LEVELS = ['LEARNING_OUTCOME', 'PROCESS_COMPONENT'] as const;
const CANDIDATE_DECISIONS = ['PENDING', 'PRIMARY', 'SECONDARY', 'REJECTED'] as const;

const createCandidateSchema = z.object({
  level: z.enum(CANDIDATE_LEVELS),
  targetId: z.string().min(1),
  decision: z.enum(CANDIDATE_DECISIONS).optional(),
  confidence: z.number(),
  reviewed: z.boolean().optional(),
  method: z.enum(['OCR', 'AI_NORMALIZED', 'AI_ANCHORED', 'AI_MAPPED', 'MANUAL']).optional(),
  rationale: z.string().max(2000).optional(),
  learningOutcomeId: z.string().min(1).optional(),
});

const reviewCandidateSchema = z.object({
  decision: z.enum(CANDIDATE_DECISIONS),
  reviewed: z.boolean(),
  rationale: z.string().max(2000).optional(),
  confidence: z.number().optional(),
});

export function createCurriculumCandidateRoutes(
  candidateController: CurriculumCandidateController,
  authMiddleware: AuthMiddleware
): Router {
  const router = Router();

  router.use(authMiddleware.authenticate);

  router.post(
    '/questions/:questionId/curriculum-candidates',
    idempotencyKeyOptional(),
    validate(createCandidateSchema),
    candidateController.createCandidate
  );

  router.get(
    '/questions/:questionId/curriculum-candidates',
    authMiddleware.authorize(CANDIDATE_READ_ROLES),
    candidateController.listCandidates
  );

  router.get(
    '/curriculum-candidates/:id',
    authMiddleware.authorize(CANDIDATE_READ_ROLES),
    candidateController.getCandidate
  );

  router.post(
    '/curriculum-candidates/:id/review',
    validate(reviewCandidateSchema),
    candidateController.reviewCandidate
  );

  return router;
}
