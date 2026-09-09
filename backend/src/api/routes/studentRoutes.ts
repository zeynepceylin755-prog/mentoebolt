import { Router } from 'express';
import { StudentController } from '../controllers/StudentController.js';
import { AuthMiddleware } from '../middleware/auth.js';
import { OwnershipGuard } from '../middleware/ownership.js';

export function createStudentRoutes(
  studentController: StudentController,
  authMiddleware: AuthMiddleware,
  ownershipGuard: OwnershipGuard
): Router {
  const router = Router();

  // Public route for registration (handled by auth routes)
  // Protected routes
  router.get(
    '/students',
    authMiddleware.authenticate,
    authMiddleware.authorize(['ADMIN']),
    studentController.getAllStudents.bind(studentController)
  );

  router.get(
    '/students/me',
    authMiddleware.authenticate,
    studentController.getMyProfile.bind(studentController)
  );

  router.get(
    '/students/:studentId',
    authMiddleware.authenticate,
    ownershipGuard.requireStudentOwnership,
    studentController.getStudentProfile.bind(studentController)
  );

  router.put(
    '/students/:studentId/grade',
    authMiddleware.authenticate,
    ownershipGuard.requireStudentOwnership,
    studentController.updateStudentGrade.bind(studentController)
  );

  return router;
}
