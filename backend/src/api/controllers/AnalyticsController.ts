import { Request, Response, NextFunction } from 'express';
import { ProgressService } from '../../application/services/analytics/ProgressService.js';
import { AnalyticsService } from '../../application/services/analytics/AnalyticsService.js';
import { AuthRequest } from '../middleware/auth.js';

export class AnalyticsController {
  constructor(
    private readonly progressService: ProgressService,
    private readonly analyticsService: AnalyticsService
  ) {}

  getMyProgress = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const studentId = req.userId!;
      const progress = await this.progressService.getStudentProgress(studentId);
      res.json({ success: true, data: progress });
    } catch (error) {
      next(error);
    }
  };

  getStudentProgress = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { studentId } = req.params;
      const progress = await this.progressService.getStudentProgress(studentId);
      res.json({ success: true, data: progress });
    } catch (error) {
      next(error);
    }
  };

  getSkillProgress = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { studentId, skillId } = req.params;
      const progress = await this.progressService.getSkillProgress(studentId, skillId);
      res.json({ success: true, data: progress });
    } catch (error) {
      next(error);
    }
  };

  getAllSkillProgress = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { studentId } = req.params;
      const progress = await this.progressService.getAllSkillProgress(studentId);
      res.json({ success: true, data: progress });
    } catch (error) {
      next(error);
    }
  };

  getWeeklyProgress = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { studentId } = req.params;
      const progress = await this.progressService.getWeeklyProgress(studentId);
      res.json({ success: true, data: progress });
    } catch (error) {
      next(error);
    }
  };

  getMonthlyProgress = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { studentId } = req.params;
      const progress = await this.progressService.getMonthlyProgress(studentId);
      res.json({ success: true, data: progress });
    } catch (error) {
      next(error);
    }
  };

  getStudentAnalytics = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { studentId } = req.params;
      const analytics = await this.analyticsService.getStudentAnalytics(studentId);
      res.json({ success: true, data: analytics });
    } catch (error) {
      next(error);
    }
  };

  getSystemAnalytics = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { startDate, endDate } = req.query;
      const analytics = await this.analyticsService.getSystemAnalytics(
        startDate ? new Date(startDate as string) : undefined,
        endDate ? new Date(endDate as string) : undefined
      );
      res.json({ success: true, data: analytics });
    } catch (error) {
      next(error);
    }
  };

  getLearningTrends = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { studentId } = req.params;
      const { days } = req.query;
      const trends = await this.analyticsService.getStudentLearningTrends(
        studentId,
        days ? parseInt(days as string) : 30
      );
      res.json({ success: true, data: trends });
    } catch (error) {
      next(error);
    }
  };
}
