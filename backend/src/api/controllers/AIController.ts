import { Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import { AIErrorAnalysisService } from '../../application/services/ai/AIErrorAnalysisService.js';
import { AIRecommendationService } from '../../application/services/ai/AIRecommendationService.js';
import { AIExplanationService } from '../../application/services/ai/AIExplanationService.js';
import { AuthRequest } from '../middleware/auth.js';
import { IStudentRepository } from '../../domain/interfaces/IStudentRepository.js';
import { AuthenticationError, AuthorizationError } from '../../domain/errors/AuthenticationError.js';
import { NotFoundError } from '../../domain/errors/NotFoundError.js';
import { logger } from '../../infrastructure/logging/logger.js';

export class AIController {
  constructor(
    private readonly errorAnalysisService: AIErrorAnalysisService,
    private readonly recommendationService: AIRecommendationService,
    private readonly explanationService: AIExplanationService,
    /**
     * Phase 5F.9-E: used ONLY to resolve the authoritative context for an
     * attempt-scoped explanation request. The explanation path performs read-only
     * SELECTs; it never writes.
     */
    private readonly prisma: PrismaClient,
    /** Used to derive the caller's StudentProfile id server-side. */
    private readonly studentRepository: IStudentRepository
  ) {}

  /**
   * Diagnostic error-classification surface.
   *
   * Phase 6.7 (authority hardening): `correctAnswer` and `skillId` are NEVER read
   * from the request body. Previously a client could hand the model a canonical
   * answer and a skill identity, giving it authority over the diagnostic. The two
   * fields are now supplied as empty/unknown placeholders so the request carries
   * no client-authoritative answer or skill identity. A caller that needs
   * attempt-scoped, authoritative error analysis should use the persisted-attempt
   * pipeline (ErrorAnalysisApplicationService), which resolves the MicroSkill from
   * the PRIMARY mapping and the canonical answer from the Question row.
   */
  analyzeError = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const {
        question,
        studentAnswer,
        difficulty,
        timeSpentSeconds,
        previousAttempts
      } = req.body;

      const result = await this.errorAnalysisService.analyzeError({
        question,
        studentAnswer,
        // Deliberately NOT taken from the body — see method docs.
        correctAnswer: '',
        skillId: 'unknown',
        difficulty,
        timeSpentSeconds,
        previousAttempts: previousAttempts || [],
      });

      res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * AI recommendation surface.
   *
   * Phase 6.7 (identity hardening): the caller's learning state is NEVER taken
   * from the request body. `studentId`, `currentMastery`, `weakSkills`,
   * `strongSkills` and `recentAttempts` were previously accepted verbatim, which
   * let a client (a) name another student's identity and (b) feed arbitrary
   * mastery into the model. They are now IGNORED — the context is derived from
   * the authenticated student's own persisted Learning State.
   *
   * This endpoint remains a NON-authoritative AI surface. The authoritative,
   * deterministic recommendation is `GET /api/v1/recommendations/next`
   * (NextLearningActionService), which is untouched.
   */
  generateRecommendation = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.userId) {
        throw new AuthenticationError('Authentication required');
      }
      const student = await this.studentRepository.findByUserId(req.userId);
      if (!student) {
        throw new AuthenticationError('Student profile not found for authenticated user');
      }

      const context = await this.buildRecommendationContext(student.id);

      const result = await this.recommendationService.generateRecommendation({
        ...context,
        // learningStage, when supplied, is a UI hint only; it carries no identity
        // or mastery authority and is safe to pass through.
        learningStage: typeof req.body?.learningStage === 'string'
          ? req.body.learningStage
          : 'discovery',
      });

      res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * Derive the AI recommendation context (mastery, weak/strong skills, recent
   * attempts) from the authenticated student's own authoritative learning state.
   * Read-only: only SELECTs are issued.
   */
  private async buildRecommendationContext(studentId: string) {
    const masteries = await this.prisma.skillMastery.findMany({
      where: { studentId },
      orderBy: { lastAttemptAt: 'desc' },
      take: 50,
    });

    const currentMastery = masteries.map((m) => ({
      skillId: m.skillId,
      masteryLevel: m.masteryLevel,
      confidence: m.confidence,
      attempts: m.attempts,
      correctAttempts: m.correctAttempts,
      lastAttemptAt: m.lastAttemptAt,
      trend: m.trend,
    }));

    const weakSkills = currentMastery
      .filter((m) => m.masteryLevel < 40)
      .map((m) => ({ skillId: m.skillId, masteryLevel: m.masteryLevel, confidence: m.confidence }));
    const strongSkills = currentMastery
      .filter((m) => m.masteryLevel > 70)
      .map((m) => ({ skillId: m.skillId, masteryLevel: m.masteryLevel, confidence: m.confidence }));

    const recentRows = await this.prisma.questionAttempt.findMany({
      where: { studentId },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: { questionId: true, isCorrect: true, errorType: true, createdAt: true },
    });
    const recentAttempts = recentRows.map((a) => ({
      questionId: a.questionId,
      // skillId is the PRIMARY MicroSkill of the question, resolved per attempt
      // below; the QuestionAttempt row itself does not carry a skill id.
      skillId: 'unknown',
      isCorrect: a.isCorrect,
      errorType: a.errorType ?? undefined,
      createdAt: a.createdAt,
    }));

    return {
      studentId,
      currentMastery,
      weakSkills,
      strongSkills,
      recentAttempts,
    };
  }

  /**
   * Answer-suppressing explanation / hint / Socratic guidance.
   *
   * Phase 5F.9-E: when the request carries an authoritative `attemptId`, the
   * ENTIRE pedagogical context is derived server-side from the persisted
   * QuestionAttempt that the authenticated student owns:
   *
   *   QuestionAttempt -> Question / QuestionInstance
   *     -> PRIMARY QuestionSkillMapping -> MicroSkill
   *     -> persisted ErrorAnalysis (when the attempt was incorrect)
   *
   * The client may then only choose a mode; its question/answer/skill/error
   * fields are ignored, so a hostile or buggy client can never select the
   * MicroSkill, the error classification, the mastery target or the identity that
   * the guidance is produced against. Ownership is enforced here (403/404), never
   * in the browser.
   *
   * Phase 5F.9-D is preserved: `correctAnswer` is NOT read from the body and has
   * no field on the model contract, so the canonical answer cannot enter the flow.
   */
  generateExplanation = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const {
        attemptId,
        concept,
        question,
        studentAnswer,
        skillId,
        difficulty,
        previousAttempts,
        level,
        mode,
        skillName,
        skillDescription,
        errorType,
        errorHypothesis
      } = req.body;

      // Phase 5F.9-D (security): `correctAnswer` is intentionally NOT read from the
      // request body. The canonical answer must never enter the explanation flow —
      // a client must not be able to inject it into the prompt, and the server does
      // not need it to produce a hint. Unknown body fields are simply ignored.
      //
      // Phase 5F.9-E: `studentId` is likewise never read — identity is derived from
      // the authenticated principal when an attempt is referenced.
      const request = attemptId
        ? await this.buildAttemptScopedRequest(req, attemptId, mode)
        : {
            // Unscoped (concept help) path: the caller describes their own study
            // context explicitly. No identity is involved and nothing is persisted.
            concept,
            question,
            studentAnswer,
            skillId,
            difficulty,
            previousAttempts: previousAttempts || 0,
            level: level || 'intermediate',
            mode,
            skillName,
            skillDescription,
            errorType,
            errorHypothesis,
          };

      const result = await this.explanationService.generateExplanation(request);

      res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * Resolve the authoritative, minimum pedagogical context for a persisted
   * attempt the authenticated student owns. Read-only: only SELECTs are issued.
   *
   * Graceful degradation, never fabrication:
   *  - no PRIMARY mapping / inactive MicroSkill -> the guidance still works using
   *    only the question text, with NO asserted skill identity;
   *  - no persisted ErrorAnalysis -> no error category is asserted, and
   *    MISTAKE_GUIDANCE is downgraded to HINT rather than inventing a diagnosis.
   */
  private async buildAttemptScopedRequest(
    req: AuthRequest,
    rawAttemptId: unknown,
    requestedMode: unknown
  ): Promise<Parameters<AIExplanationService['generateExplanation']>[0]> {
    if (!req.userId) {
      throw new AuthenticationError('Authentication required');
    }
    const attemptId = typeof rawAttemptId === 'string' ? rawAttemptId : String(rawAttemptId);

    const student = await this.studentRepository.findByUserId(req.userId);
    if (!student) {
      throw new AuthenticationError('Student profile not found for authenticated user');
    }

    const attempt = await this.prisma.questionAttempt.findUnique({
      where: { id: attemptId },
      include: { question: true },
    });
    if (!attempt) {
      throw new NotFoundError('Question attempt', attemptId);
    }

    // Ownership is enforced server-side. Another student's attempt is never
    // readable, and is not distinguished from a non-existent one to the caller by
    // the message text beyond a plain authorization error.
    if (attempt.studentId !== student.id) {
      throw new AuthorizationError('Not authorized to request guidance for this attempt');
    }

    // Authoritative MicroSkill: PRIMARY mapping only, exactly as mastery and error
    // analysis resolve it. No mapping => no skill identity is claimed.
    const primaryMapping = await this.prisma.questionSkillMapping.findFirst({
      where: { questionId: attempt.questionId, isPrimary: true },
      orderBy: { createdAt: 'asc' },
    });
    const microSkill = primaryMapping
      ? await this.prisma.microSkill.findUnique({ where: { id: primaryMapping.microSkillId } }
        )
      : null;
    const activeMicroSkill = microSkill && microSkill.isActive ? microSkill : null;

    // Persisted ErrorAnalysis, used ONLY when the attempt is actually incorrect.
    const errorAnalysis = attempt.isCorrect
      ? null
      : await this.prisma.errorAnalysis.findUnique({ where: { attemptId: attempt.id } }
        );

    // Previous attempt count for this (student, question) pair — safe metadata.
    const previousAttempts = await this.prisma.questionAttempt.count({
      where: {
        studentId: attempt.studentId,
        questionId: attempt.questionId,
        id: { not: attempt.id },
      },
    });

    const level: 'beginner' | 'intermediate' | 'advanced' =
      microSkill?.difficulty === 'beginner' || microSkill?.difficulty === 'easy'
        ? 'beginner'
        : microSkill?.difficulty === 'advanced' || microSkill?.difficulty === 'hard'
          ? 'advanced'
          : 'intermediate';

    // A mistake-guidance request with no persisted diagnosis would invite the model
    // to invent a classification, so it degrades to a neutral hint instead.
    const mode =
      requestedMode === 'MISTAKE_GUIDANCE' && !errorAnalysis ? 'HINT' : (requestedMode as string | undefined);

    return {
      attemptId: attempt.id,
      concept: activeMicroSkill?.name ?? 'Genel matematik',
      question: attempt.question.content,
      // The student's own submitted answer is evidence, never an answer key.
      studentAnswer: attempt.answer,
      // Phase 6.4: authoritative correctness (boolean only). It is derived from the
      // persisted attempt; `attempt.question.correctAnswer` is deliberately NEVER
      // read here, so the canonical answer cannot enter the explanation flow.
      studentAnsweredCorrectly: attempt.isCorrect,
      skillId: activeMicroSkill?.id ?? 'unknown',
      difficulty: attempt.question.difficulty ?? 1,
      previousAttempts,
      level,
      mode,
      skillName: activeMicroSkill?.name,
      skillDescription: activeMicroSkill?.description,
      // errorType is the AUTHORITATIVE persisted category; the hypothesis is the
      // previously persisted pedagogical prose. Neither can be supplied by client.
      errorType: errorAnalysis?.errorType,
      errorHypothesis: errorAnalysis?.hypothesis,
    };
  }
}
