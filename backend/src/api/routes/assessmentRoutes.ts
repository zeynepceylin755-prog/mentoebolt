import { Router } from 'express';
import { AssessmentController } from '../controllers/AssessmentController.js';
import { AuthMiddleware } from '../middleware/auth.js';
import { OwnershipGuard } from '../middleware/ownership.js';
import { validate } from '../middleware/validation.js';
import { idempotencyKeyRequired } from '../middleware/idempotency.js';
import { z } from 'zod';

const createAssessmentSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  type: z.enum(['DIAGNOSTIC', 'FORMATIVE', 'SUMMATIVE', 'PRACTICE']),
  skillIds: z.array(z.string()),
  topicIds: z.array(z.string()).optional(),
  timeLimitMinutes: z.number().int().positive().optional(),
  passingScore: z.number().min(0).max(100).optional(),
});

const addQuestionsSchema = z.object({
  questionIds: z.array(z.string()).min(1),
});

// Phase 6.7: `studentId` is no longer authoritative. It is accepted (optional)
// for backward compatibility with existing clients but is IGNORED — the
// authenticated User → StudentProfile chain determines the attempt owner.
const startAssessmentSchema = z.object({
  studentId: z.string().min(1).optional(),
  assessmentId: z.string().min(1),
});

const submitAnswerSchema = z.object({
  attemptId: z.string().min(1),
  questionId: z.string().min(1),
  answer: z.string().min(1),
  timeSpentSeconds: z.number().int().min(0),
  confidence: z.number().min(0).max(1).optional(),
});

const completeAssessmentSchema = z.object({
  attemptId: z.string().min(1),
});

export function createAssessmentRoutes(
  assessmentController: AssessmentController,
  authMiddleware: AuthMiddleware,
  ownershipGuard: OwnershipGuard
): Router {
  const router = Router();

  router.use(authMiddleware.authenticate);

  router.post(
    '/assessments',
    authMiddleware.authorize(['ADMIN', 'CONTENT_MANAGER']),
    validate(createAssessmentSchema),
    assessmentController.createAssessment
  );

  router.post(
    '/assessments/:assessmentId/questions',
    authMiddleware.authorize(['ADMIN', 'CONTENT_MANAGER']),
    validate(addQuestionsSchema),
    assessmentController.addQuestions
  );

  router.put(
    '/assessments/:assessmentId/publish',
    authMiddleware.authorize(['ADMIN', 'CONTENT_MANAGER']),
    assessmentController.publishAssessment
  );

  router.post(
    '/assessments/start',
    validate(startAssessmentSchema),
    assessmentController.startAssessment
  );

  router.post(
    '/assessments/submit-answer',
    idempotencyKeyRequired(),
    validate(submitAnswerSchema),
    assessmentController.submitAnswer
  );

  router.post(
    '/assessments/complete',
    idempotencyKeyRequired(),
    validate(completeAssessmentSchema),
    assessmentController.completeAssessment
  );

  router.get(
    '/assessments/results/:attemptId',
    assessmentController.getResults
  );

  return router;
}
