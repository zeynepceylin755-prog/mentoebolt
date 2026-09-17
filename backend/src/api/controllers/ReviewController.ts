import { Response, NextFunction } from 'express';
import { ReviewQueueService } from '../../application/services/ingestion/ReviewQueueService.js';
import { AuthRequest } from '../middleware/auth.js';
import { AuthenticationError, AuthorizationError } from '../../domain/errors/AuthenticationError.js';
import { isStaffRole } from '../../application/services/ingestion/QuestionIngestionService.js';

/**
 * HTTP boundary for the minimal reviewer queue — Phase 5F.8 (D1).
 *
 * Thin and read-only: it exposes the existing review gate's backlog to staff.
 * The actual approve/reject/candidate/mapping actions are performed through the
 * PRE-EXISTING endpoints (curriculum-candidates/:id/review,
 * question-skill-mappings/:id/review, question-ingestions/:id/transition).
 */
export class ReviewController {
  constructor(private readonly reviewQueueService: ReviewQueueService) { }

  listQueue = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.userId) {
        throw new AuthenticationError('Authentication required');
      }
      const role = req.userRole || 'STUDENT';
      if (!isStaffRole(role)) {
        // Explicit staff gate at the transport too; the service re-checks.
        throw new AuthorizationError('Review queue requires a staff role');
      }

      const limit = parseInt(String(req.query.limit ?? '50'), 10);
      const items = await this.reviewQueueService.listQueue(
        role,
        Number.isFinite(limit) ? limit : 50
      );
      res.json({ success: true, data: items });
    } catch (error) {
      next(error);
    }
  };
}
