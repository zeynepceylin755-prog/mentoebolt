import { Request, Response, NextFunction } from 'express';
import { AssessmentService } from '../../application/services/assessment/AssessmentService.js';
import { AuthRequest } from '../middleware/auth.js';
import { IStudentRepository } from '../../domain/interfaces/IStudentRepository.js';
import { AuthenticationError } from '../../domain/errors/AuthenticationError.js';

export class AssessmentController {
  constructor(
    private readonly assessmentService: AssessmentService,
    private readonly studentRepository: IStudentRepository
  ) {}

  /**
   * Phase 6.7 — resolve the caller's StudentProfile id.
   *
   * Student identity is NEVER taken from the request body: the authenticated
   * User → StudentProfile chain is authoritative, exactly as it is for
   * QuestionAttemptController / RecommendationController / AnalyticsController.
   * A user with no StudentProfile fails closed.
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
      // Phase 6.7: `studentId` in the body is IGNORED. Identity comes from the
      // authenticated principal only, so a student cannot start an assessment
      // attempt as another student.
      const studentId = await this.resolveStudentProfileId(req);
      const { assessmentId } = req.body;
      const result = await this.assessmentService.startAssessment(studentId, assessmentId);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  };

  submitAnswer = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { attemptId, questionId, answer, timeSpentSeconds, confidence } = req.body;
      const userId = req.userId;
      // Phase 6.7: the caller's StudentProfile is passed so the service can
      // verify the referenced assessment attempt belongs to this student.
      const studentId = await this.resolveStudentProfileId(req);
      const idempotencyKey = (req as any).idempotencyKey;

      const result = await this.assessmentService.submitAnswer(
        attemptId,
        questionId,
        answer,
        timeSpentSeconds,
        confidence,
        userId,
        idempotencyKey,
        studentId
      );
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  };

  completeAssessment = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { attemptId } = req.body;
      const userId = req.userId;
      const studentId = await this.resolveStudentProfileId(req);
      const idempotencyKey = (req as any).idempotencyKey;

      const result = await this.assessmentService.completeAssessment(
        attemptId,
        userId,
        idempotencyKey,
        studentId
      );
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  };

  getResults = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { attemptId } = req.params;
      // Phase 6.7: results are scoped to the authenticated student. Reading
      // another student's assessment results is refused (and a non-existent
      // attempt is indistinguishable from an unauthorized one). Staff roles are
      // gated at the route level, not here.
      const studentId = await this.resolveStudentProfileId(req);
      const result = await this.assessmentService.getAssessmentResults(attemptId, studentId);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  };
}
