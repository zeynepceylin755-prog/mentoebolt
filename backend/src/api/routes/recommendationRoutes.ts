import { Router } from 'express';
import { RecommendationController } from '../controllers/RecommendationController.js';
import { AuthMiddleware } from '../middleware/auth.js';

/**
 * Recommendation routes.
 *
 *   GET /api/v1/recommendations/next
 *
 * Follows the existing /api/v1 convention: router-level authenticate. The
 * caller's StudentProfile is resolved server-side from the authenticated user;
 * no studentId is accepted from the request.
 */
export function createRecommendationRoutes(
  recommendationController: RecommendationController,
  authMiddleware: AuthMiddleware
): Router {
  const router = Router();

  router.use(authMiddleware.authenticate);

  router.get('/recommendations/next', recommendationController.getNextRecommendation);

  return router;
}
