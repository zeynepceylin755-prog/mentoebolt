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

  router.get(
    '/analytics/me/progress',
    analyticsController.getMyProgress
  );

  router.get(
    '/analytics/me/skills',
    analyticsController.getAllSkillProgress
  );

  router.get(
    '/analytics/me/weekly',
    analyticsController.getWeeklyProgress
  );

  router.get(
    '/analytics/me/monthly',
    analyticsController.getMonthlyProgress
  );

  router.get(
    '/analytics/me/trends',
    analyticsController.getLearningTrends
  );

  router.get(
    '/analytics/me/analytics',
    analyticsController.getStudentAnalytics
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
