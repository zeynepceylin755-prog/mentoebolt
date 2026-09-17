import { Response, NextFunction } from 'express';
import { CurriculumCandidateService } from '../../application/services/curriculum/CurriculumCandidateService.js';
import { AuthRequest } from '../middleware/auth.js';
import { AuthenticationError } from '../../domain/errors/AuthenticationError.js';

/**
 * HTTP boundary for the Curriculum Candidate layer.
 *
 * Thin by design: every business rule (vocabulary, target integrity, parent
 * consistency, duplicate prevention, review state, authorization) lives in
 * CurriculumCandidateService.
 */
export class CurriculumCandidateController {
  constructor(private readonly candidateService: CurriculumCandidateService) { }

  createCandidate = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = this.requireUserId(req);
      const role = req.userRole || 'STUDENT';
      const { questionId } = req.params;
      const idempotencyKey = (req as any).idempotencyKey as string | undefined;

      const result = await this.candidateService.createCandidate(
        userId,
        role,
        { ...req.body, questionId },
        idempotencyKey
      );

      res.status(201).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  };

  listCandidates = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { questionId } = req.params;
      const { level, decision } = req.query as { level?: string; decision?: string };

      const result = await this.candidateService.listCandidatesForQuestion(questionId, {
        level,
        decision,
      });

      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  };

  getCandidate = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = req.params;
      const result = await this.candidateService.getCandidate(id);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  };

  reviewCandidate = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = this.requireUserId(req);
      const role = req.userRole || 'STUDENT';
      const { id } = req.params;

      const result = await this.candidateService.reviewCandidate(userId, role, id, {
        decision: req.body.decision,
        reviewed: req.body.reviewed,
        rationale: req.body.rationale,
        confidence: req.body.confidence,
      });

      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  };

  private requireUserId(req: AuthRequest): string {
    if (!req.userId) {
      throw new AuthenticationError('Authentication required');
    }
    return req.userId;
  }
}
