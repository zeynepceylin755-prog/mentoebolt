import { Router } from 'express';
import { QuestionSkillMappingController } from '../controllers/QuestionSkillMappingController.js';
import { AuthMiddleware } from '../middleware/auth.js';
import { validate } from '../middleware/validation.js';
import { idempotencyKeyOptional } from '../middleware/idempotency.js';
import { ALL_MAPPING_SOURCES } from '../../domain/skills/mappingVocabulary.js';
import { z } from 'zod';

/**
 * Routes follow the existing /api/v1 nested-resource convention established by
 * questionIngestionRoutes.ts and curriculumCandidateRoutes.ts.
 *
 *   POST /api/v1/questions/:questionId/skill-mappings
 *   GET  /api/v1/questions/:questionId/skill-mappings
 *   GET  /api/v1/question-skill-mappings/:id
 *   POST /api/v1/question-skill-mappings/:id/review
 *
 * Role gating is enforced in the service layer so the rule holds regardless of
 * transport; no duplicate route-level authorize() is added.
 *
 * Phase 6.7 (IDOR/info-disclosure): the READ surfaces are staff-only too. A
 * mapping is a governance artefact and its `questionId` can point at another
 * student's UNVERIFIED upload; a student having a `questionId` must not turn
 * into the ability to enumerate the knowledge-mapping of that question. The
 * student journey never reads these endpoints (it only consumes the mapping
 * server-side), so this narrows access without breaking any legitimate flow.
 *
 * No DELETE route: the repository defines no deletion semantics for knowledge
 * mappings, so none is invented here.
 */

/** Staff roles permitted to read mapping governance artefacts. */
const MAPPING_READ_ROLES = ['ADMIN', 'CONTENT_MANAGER', 'TEACHER'];

// The allowed `mappingSource` vocabulary is owned by mappingVocabulary.ts (the
// same list the service validates against). Deriving the enum from it keeps the
// HTTP boundary and the domain layer from drifting apart.
const MAPPING_SOURCES = ALL_MAPPING_SOURCES as [string, ...string[]];

const createMappingSchema = z.object({
  microSkillId: z.string().min(1),
  isPrimary: z.boolean().optional(),
  relevance: z.number(),
  aiConfidence: z.number().nullable().optional(),
  mappingSource: z.enum(MAPPING_SOURCES).optional(),
  reviewed: z.boolean().optional(),
});

const reviewMappingSchema = z.object({
  reviewed: z.boolean(),
  isPrimary: z.boolean().optional(),
  relevance: z.number().optional(),
  aiConfidence: z.number().nullable().optional(),
});

export function createQuestionSkillMappingRoutes(
  mappingController: QuestionSkillMappingController,
  authMiddleware: AuthMiddleware
): Router {
  const router = Router();

  router.use(authMiddleware.authenticate);

  router.post(
    '/questions/:questionId/skill-mappings',
    idempotencyKeyOptional(),
    validate(createMappingSchema),
    mappingController.createMapping
  );

  router.get(
    '/questions/:questionId/skill-mappings',
    authMiddleware.authorize(MAPPING_READ_ROLES),
    mappingController.listMappings
  );

  router.get(
    '/question-skill-mappings/:id',
    authMiddleware.authorize(MAPPING_READ_ROLES),
    mappingController.getMapping
  );

  router.post(
    '/question-skill-mappings/:id/review',
    validate(reviewMappingSchema),
    mappingController.reviewMapping
  );

  return router;
}
