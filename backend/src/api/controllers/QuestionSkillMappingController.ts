import { Response, NextFunction } from 'express';
import { QuestionSkillMappingService } from '../../application/services/skills/QuestionSkillMappingService.js';
import { AuthRequest } from '../middleware/auth.js';
import { AuthenticationError } from '../../domain/errors/AuthenticationError.js';

/**
 * HTTP boundary for the QuestionSkillMapping writer.
 *
 * Thin by design: I13, uniqueness, curriculum-chain validation, provenance and
 * authorization all live in QuestionSkillMappingService, so the invariants hold
 * even when this controller is bypassed.
 */
export class QuestionSkillMappingController {
  constructor(private readonly mappingService: QuestionSkillMappingService) { }

  createMapping = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = this.requireUserId(req);
      const role = req.userRole || 'STUDENT';
      const { questionId } = req.params;
      const idempotencyKey = (req as any).idempotencyKey as string | undefined;

      const result = await this.mappingService.createMapping(
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

  listMappings = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { questionId } = req.params;
      const { isPrimary, reviewed } = req.query as { isPrimary?: string; reviewed?: string };

      const filters: { isPrimary?: boolean; reviewed?: boolean } = {};
      if (isPrimary !== undefined) filters.isPrimary = isPrimary === 'true';
      if (reviewed !== undefined) filters.reviewed = reviewed === 'true';

      const result = await this.mappingService.listMappingsForQuestion(questionId, filters);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  };

  getMapping = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = req.params;
      const result = await this.mappingService.getMapping(id);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  };

  reviewMapping = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = this.requireUserId(req);
      const role = req.userRole || 'STUDENT';
      const { id } = req.params;

      const result = await this.mappingService.reviewMapping(userId, role, id, {
        reviewed: req.body.reviewed,
        isPrimary: req.body.isPrimary,
        relevance: req.body.relevance,
        aiConfidence: req.body.aiConfidence,
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
