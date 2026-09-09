import { Router } from 'express';
import { AIController } from '../controllers/AIController.js';
import { AuthMiddleware } from '../middleware/auth.js';
import { validate } from '../middleware/validation.js';
import { z } from 'zod';

const analyzeErrorSchema = z.object({
  question: z.string().min(1),
  studentAnswer: z.string().min(1),
  correctAnswer: z.string().min(1),
  skillId: z.string().min(1),
  difficulty: z.number().int().min(1).max(10),
  timeSpentSeconds: z.number().int().min(0),
  previousAttempts: z.array(z.any()).optional(),
});

const recommendationSchema = z.object({
  studentId: z.string().min(1),
  learningStage: z.string().optional(),
  currentMastery: z.array(z.any()).optional(),
  weakSkills: z.array(z.any()).optional(),
  strongSkills: z.array(z.any()).optional(),
  recentAttempts: z.array(z.any()).optional(),
});

const explanationSchema = z.object({
  concept: z.string().min(1),
  skillId: z.string().min(1),
  difficulty: z.number().int().min(1).max(10),
  level: z.enum(['beginner', 'intermediate', 'advanced']).optional(),
  question: z.string().optional(),
  studentAnswer: z.string().optional(),
  correctAnswer: z.string().optional(),
  previousAttempts: z.number().int().min(0).optional(),
});

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
