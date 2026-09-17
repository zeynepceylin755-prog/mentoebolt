import { Response, NextFunction } from 'express';
import { ProgressService } from '../../application/services/analytics/ProgressService.js';
import { AnalyticsService } from '../../application/services/analytics/AnalyticsService.js';
import { AuthRequest } from '../middleware/auth.js';
import { IStudentRepository } from '../../domain/interfaces/IStudentRepository.js';
import { AuthenticationError } from '../../domain/errors/AuthenticationError.js';

export class AnalyticsController {
  constructor(
    private readonly progressService: ProgressService,
    private readonly analyticsService: AnalyticsService,
    private readonly studentRepository: IStudentRepository
  ) {}

  /**
   * Resolve the authenticated user's StudentProfile id.
   *
   * The analytics/mastery tables key on StudentProfile.id, NOT User.id, so the
   * authenticated `req.userId` (a User.id) must be mapped to its profile. This
   * mirrors the identity resolution already used by OwnershipGuard and
   * QuestionAttemptController; a user with no student profile is refused rather
   * than silently querying with the wrong identity.
   */
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

  getMyProgress = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const studentId = await this.resolveStudentProfileId(req);
      const progress = await this.progressService.getStudentProgress(studentId);
      res.json({ success: true, data: progress });
    } catch (error) {
      next(error);
    }
  };

  getMySkillProgress = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const studentId = await this.resolveStudentProfileId(req);
      const progress = await this.progressService.getAllSkillProgress(studentId);
      res.json({ success: true, data: progress });
    } catch (error) {
      next(error);
    }
  };

  getMyWeeklyProgress = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const studentId = await this.resolveStudentProfileId(req);
      const progress = await this.progressService.getWeeklyProgress(studentId);
      res.json({ success: true, data: progress });
    } catch (error) {
      next(error);
    }
  };

  getMyMonthlyProgress = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const studentId = await this.resolveStudentProfileId(req);
      const progress = await this.progressService.getMonthlyProgress(studentId);
      res.json({ success: true, data: progress });
    } catch (error) {
      next(error);
    }
  };

  getMyLearningTrends = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const studentId = await this.resolveStudentProfileId(req);
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

  getMyAnalytics = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const studentId = await this.resolveStudentProfileId(req);
      const analytics = await this.analyticsService.getStudentAnalytics(studentId);
      res.json({ success: true, data: analytics });
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
