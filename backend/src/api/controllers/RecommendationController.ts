import { Response, NextFunction } from 'express';
import { NextLearningActionService } from '../../application/services/learning/NextLearningActionService.js';
import { AuthRequest } from '../middleware/auth.js';
import { IStudentRepository } from '../../domain/interfaces/IStudentRepository.js';
import { AuthenticationError } from '../../domain/errors/AuthenticationError.js';

/**
 * HTTP boundary for the student's next learning recommendation.
 *
 * Thin by design: the deterministic recommendation logic lives entirely in
 * NextLearningActionService. This controller only maps the authenticated user to
 * their StudentProfile (the identity the mastery tables key on) and returns the
 * service's structured result.
 *
 * Phase 6.5 — the request carries NO authoritative input. `studentId` is never
 * read from the body/query; identity comes from the verified principal only. The
 * endpoint is read-only and deterministic.
 */
export class RecommendationController {
  constructor(
    private readonly nextLearningActionService: NextLearningActionService,
    private readonly studentRepository: IStudentRepository
  ) { }

  getNextRecommendation = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const studentId = await this.resolveStudentProfileId(req);
      const recommendation = await this.nextLearningActionService.getNextAction(studentId);
      res.json({ success: true, data: recommendation });
    } catch (error) {
      next(error);
    }
  };

  private async resolveStudentProfileId(req: AuthRequest): Promise<string> {
    if (!req.userId) {
      throw new AuthenticationError('Authentication required');
    }
    const student = await this.studentRepository.findByUserId(req.userId);
    if (!student) {
      throw new AuthenticationError('Student profile not found for authenticated user');
    }
    return student.id;
  }
}
