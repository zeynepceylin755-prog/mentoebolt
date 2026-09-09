import { Request, Response, NextFunction } from 'express';
import { AssessmentService } from '../../application/services/assessment/AssessmentService.js';
import { AuthRequest } from '../middleware/auth.js';

export class AssessmentController {
  constructor(private readonly assessmentService: AssessmentService) {}

  createAssessment = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await this.assessmentService.createAssessment(req.body);
      res.status(201).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  };

  addQuestions = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { assessmentId } = req.params;
      const { questionIds } = req.body;
      const result = await this.assessmentService.addQuestionsToAssessment(assessmentId, questionIds);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  };

  publishAssessment = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { assessmentId } = req.params;
      const result = await this.assessmentService.publishAssessment(assessmentId);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  };

  startAssessment = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { studentId, assessmentId } = req.body;
      const result = await this.assessmentService.startAssessment({ studentId, assessmentId });
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  };

  submitAnswer = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { attemptId, questionId, answer, timeSpentSeconds, confidence } = req.body;
      const result = await this.assessmentService.submitAnswer({
        attemptId,
        questionId,
        answer,
        timeSpentSeconds,
        confidence,
      });
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  };

  completeAssessment = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { attemptId } = req.body;
      const result = await this.assessmentService.completeAssessment({ attemptId });
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  };

  getResults = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { attemptId } = req.params;
      const result = await this.assessmentService.getAssessmentResults(attemptId);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  };
}
