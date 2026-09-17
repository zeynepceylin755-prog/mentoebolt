import { Router } from 'express';
import { ReviewController } from '../controllers/ReviewController.js';
import { AuthMiddleware } from '../middleware/auth.js';

/**
 * Reviewer routes — Phase 5F.8 (D).
 *
 *   GET /api/v1/review-queue
 *
 * Staff-only. Role enforcement happens both here (authorize) and in
 * ReviewQueueService (defence in depth). Review ACTIONS continue to use the
 * existing endpoints; no new review engine is introduced.
 */
export function createReviewRoutes(
  reviewController: ReviewController,
  authMiddleware: AuthMiddleware
): Router {
  const router = Router();

  router.use(authMiddleware.authenticate);

  router.get(
    '/review-queue',
    authMiddleware.authorize(['ADMIN', 'CONTENT_MANAGER', 'TEACHER']),
    reviewController.listQueue
  );

  return router;
}
