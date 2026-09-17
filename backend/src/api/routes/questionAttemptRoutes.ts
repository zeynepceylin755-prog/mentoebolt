import { Router } from 'express';
import { QuestionAttemptController } from '../controllers/QuestionAttemptController.js';
import { AuthMiddleware } from '../middleware/auth.js';
import { validate } from '../middleware/validation.js';
import { idempotencyKeyOptional } from '../middleware/idempotency.js';
import { z } from 'zod';

// NOTE: `studentId` is deliberately NOT accepted here. The backend derives the
// student from the authenticated User → StudentProfile. Likewise no skillId /
// microSkillId / errorPatternId is accepted as authoritative input.
const submitAttemptSchema = z.object({
  questionId: z.string().min(1),
  answer: z.string().min(1),
  timeSpentSeconds: z.number().int().min(0),
  confidence: z.number().min(0).max(1).optional(),
  sessionId: z.string().optional(),
  sessionQuestionId: z.string().optional(),
  // Optional: the caller names the instance it is answering. Ownership is still
  // verified server-side; it cannot be used to answer another student's question.
  instanceId: z.string().optional(),
});

export function createQuestionAttemptRoutes(
  questionAttemptController: QuestionAttemptController,
  authMiddleware: AuthMiddleware
): Router {
  const router = Router();

  router.use(authMiddleware.authenticate);

  router.post(
    '/question-attempts',
    idempotencyKeyOptional(),
    validate(submitAttemptSchema),
    questionAttemptController.submitAttempt
  );

  router.get('/question-attempts/:attemptId', questionAttemptController.getAttempt);

  router.get('/question-attempts', questionAttemptController.getStudentAttempts);

  return router;
}