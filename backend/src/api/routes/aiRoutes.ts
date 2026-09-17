import { Router } from 'express';
import { AIController } from '../controllers/AIController.js';
import { AuthMiddleware } from '../middleware/auth.js';
import { validate } from '../middleware/validation.js';
import { z } from 'zod';

// Phase 6.7: `correctAnswer` and `skillId` are no longer part of the contract of
// this diagnostic surface. `correctAnswer` in particular must never be client
// authority — sending it is tolerated but IGNORED (see AIController.analyzeError),
// so a client cannot dictate the canonical answer or the skill identity.
const analyzeErrorSchema = z.object({
  question: z.string().min(1),
  studentAnswer: z.string().min(1),
  difficulty: z.number().int().min(1).max(10),
  timeSpentSeconds: z.number().int().min(0),
  previousAttempts: z.array(z.any()).optional(),
});

// Phase 6.7: the AI recommendation context is derived server-side from the
// authenticated student's own learning state. `studentId`, `currentMastery`,
// `weakSkills`, `strongSkills` and `recentAttempts` are accepted but IGNORED so
// existing clients keep working; only `learningStage` (a UI hint) is read.
const recommendationSchema = z.object({
  studentId: z.string().min(1).optional(),
  learningStage: z.string().optional(),
  currentMastery: z.array(z.any()).optional(),
  weakSkills: z.array(z.any()).optional(),
  strongSkills: z.array(z.any()).optional(),
  recentAttempts: z.array(z.any()).optional(),
});

// Phase 5F.9-D: the explanation surface is answer-suppressing.
// - `correctAnswer` is NOT accepted: the canonical answer must never enter the
//   explanation flow, even if a client tries to supply it.
// - `mode` is restricted to the pedagogical modes; there is deliberately no
//   full-solution mode.
//
// Phase 5F.9-E: an attempt-scoped request adds `attemptId`. When it is present the
// controller IGNORES every other pedagogical field and derives concept / question /
// answer / MicroSkill / ErrorAnalysis / mastery target from the persisted attempt
// owned by the authenticated student. A hostile client therefore cannot choose the
// curriculum identity or the error classification. `studentId` is still never
// accepted: identity comes from the authenticated principal only.
const explanationSchema = z.object({
  attemptId: z.string().min(1).optional(),
  concept: z.string().min(1).optional(),
  skillId: z.string().min(1).optional(),
  difficulty: z.number().int().min(1).max(10).optional(),
  level: z.enum(['beginner', 'intermediate', 'advanced']).optional(),
  question: z.string().optional(),
  studentAnswer: z.string().optional(),
  previousAttempts: z.number().int().min(0).optional(),
  mode: z
    .enum(['HINT', 'SOCRATIC', 'FORMULA_REMINDER', 'MISTAKE_GUIDANCE', 'NEXT_STEP'])
    .optional(),
  skillName: z.string().optional(),
  skillDescription: z.string().optional(),
  errorType: z.string().optional(),
  errorHypothesis: z.string().optional(),
}).refine(
  (value) => value.attemptId !== undefined || (value.concept !== undefined && value.skillId !== undefined),
  {
    message: 'Either attemptId or both concept and skillId are required',
    path: ['attemptId'],
  }
);

export function createAIRoutes(
  aiController: AIController,
  authMiddleware: AuthMiddleware
): Router {
  const router = Router();

  router.use(authMiddleware.authenticate);

  router.post(
    '/ai/analyze-error',
    validate(analyzeErrorSchema),
    aiController.analyzeError
  );

  router.post(
    '/ai/recommendation',
    validate(recommendationSchema),
    aiController.generateRecommendation
  );

  router.post(
    '/ai/explanation',
    validate(explanationSchema),
    aiController.generateExplanation
  );

  return router;
}

/**
 * Phase 5F.9-E — canonical AI router mounting.
 *
 * The public route has always been `/api/v1/ai/ai/explanation` because the AI
 * router is mounted under the `/api/v1/ai` prefix while declaring an `ai/...`
 * path. Renaming it would break every existing client, so the historical path is
 * preserved and the cleaner `/api/v1/ai/explanation` is offered as an ADDITIVE
 * alias of the same handlers. No existing contract is removed or changed; a
 * future API cleanup may retire the doubled prefix.
 */
export function createCanonicalAIRoutes(
  aiController: AIController,
  authMiddleware: AuthMiddleware
): Router {
  const router = Router();

  router.use(authMiddleware.authenticate);

  router.post('/ai/analyze-error', validate(analyzeErrorSchema), aiController.analyzeError);
  router.post('/ai/recommendation', validate(recommendationSchema), aiController.generateRecommendation);
  router.post('/ai/explanation', validate(explanationSchema), aiController.generateExplanation);

  // Additive aliases under the canonical single prefix.
  router.post('/explanation', validate(explanationSchema), aiController.generateExplanation);
  router.post('/analyze-error', validate(analyzeErrorSchema), aiController.analyzeError);
  router.post('/recommendation', validate(recommendationSchema), aiController.generateRecommendation);

  return router;
}
