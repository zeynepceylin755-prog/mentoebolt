import { Response, NextFunction } from 'express';
import { QuestionIngestionService } from '../../application/services/ingestion/QuestionIngestionService.js';
import { QuestionAnalysisService } from '../../application/services/ingestion/QuestionAnalysisService.js';
import { AuthRequest } from '../middleware/auth.js';
import { AuthenticationError } from '../../domain/errors/AuthenticationError.js';

/**
 * HTTP boundary for the Question Ingestion lifecycle.
 *
 * Thin by design: all business rules (state machine, trust, review gate,
 * authorization scoping) live in QuestionIngestionService. The controller only
 * translates HTTP <-> service calls.
 */
export class QuestionIngestionController {
  constructor(
    private readonly ingestionService: QuestionIngestionService,
    private readonly analysisService?: QuestionAnalysisService
  ) { }

  createIngestion = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = this.requireUserId(req);
      const idempotencyKey = (req as any).idempotencyKey as string | undefined;

      const result = await this.ingestionService.createIngestion(
        userId,
        req.body,
        idempotencyKey
      );

      res.status(201).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  };

  getIngestion = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = this.requireUserId(req);
      const role = req.userRole || 'STUDENT';
      const { id } = req.params;

      const result = await this.ingestionService.getIngestion(id, userId, role);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  };

  transitionIngestion = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = this.requireUserId(req);
      const role = req.userRole || 'STUDENT';
      const { id } = req.params;
      const idempotencyKey = (req as any).idempotencyKey as string | undefined;

      const result = await this.ingestionService.transitionIngestion(
        id,
        userId,
        role,
        {
          toState: req.body.toState,
          reviewNotes: req.body.reviewNotes,
          actorUserId: userId,
          actorRole: role,
        },
        idempotencyKey
      );

      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  };

  analyzeIngestion = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    if (!this.analysisService) {
      res.status(503).json({ success: false, error: 'Analysis service not configured' });
      return;
    }

    try {
      const userId = this.requireUserId(req);
      const role = req.userRole || 'STUDENT';
      const { id } = req.params;
      const idempotencyKey = (req as any).idempotencyKey as string | undefined;

      const result = await this.analysisService.analyzeIngestion(
        id,
        userId,
        role,
        req.body,
        idempotencyKey
      );

      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  };

  createCanonicalQuestion = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = this.requireUserId(req);
      const role = req.userRole || 'STUDENT';
      const { id } = req.params;

      const result = await this.ingestionService.createCanonicalQuestionFromIngestion(
        id,
        userId,
        role
      );

      res.status(201).json({ success: true, data: result });
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
