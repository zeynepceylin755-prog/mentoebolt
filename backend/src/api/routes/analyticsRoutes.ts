import { Router } from 'express';
import { AnalyticsController } from '../controllers/AnalyticsController.js';
import { AuthMiddleware } from '../middleware/auth.js';
import { OwnershipGuard } from '../middleware/ownership.js';

export function createAnalyticsRoutes(
  analyticsController: AnalyticsController,
  authMiddleware: AuthMiddleware,
  ownershipGuard: OwnershipGuard
): Router {
  const router = Router();

  router.use(authMiddleware.authenticate);

  // `/me/*` routes resolve the caller's StudentProfile from the authenticated
  // user; they never accept a studentId from the request.
  router.get(
    '/analytics/me/progress',
    analyticsController.getMyProgress
  );

  router.get(
    '/analytics/me/skills',
    analyticsController.getMySkillProgress
  );

  router.get(
    '/analytics/me/weekly',
    analyticsController.getMyWeeklyProgress
  );

  router.get(
    '/analytics/me/monthly',
    analyticsController.getMyMonthlyProgress
  );

  router.get(
    '/analytics/me/trends',
    analyticsController.getMyLearningTrends
  );

  router.get(
    '/analytics/me/analytics',
    analyticsController.getMyAnalytics
  );

  router.get(
    '/analytics/:studentId/progress',
    ownershipGuard.requireStudentOwnership,
    analyticsController.getStudentProgress
  );

  router.get(
    '/analytics/:studentId/skills',
    ownershipGuard.requireStudentOwnership,
    analyticsController.getAllSkillProgress
  );

  router.get(
    '/analytics/:studentId/weekly',
    ownershipGuard.requireStudentOwnership,
    analyticsController.getWeeklyProgress
  );

  router.get(
    '/analytics/:studentId/monthly',
    ownershipGuard.requireStudentOwnership,
    analyticsController.getMonthlyProgress
  );

  router.get(
    '/analytics/:studentId/trends',
    ownershipGuard.requireStudentOwnership,
    analyticsController.getLearningTrends
  );

  router.get(
    '/analytics/:studentId/analytics',
    ownershipGuard.requireStudentOwnership,
    analyticsController.getStudentAnalytics
  );

  router.get(
    '/admin/analytics/system',
    authMiddleware.authorize(['ADMIN']),
    analyticsController.getSystemAnalytics
  );

  return router;
}
