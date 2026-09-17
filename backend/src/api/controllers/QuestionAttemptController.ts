import { Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import { QuestionAttemptService } from '../../application/services/learning/QuestionAttemptService.js';
import { MasteryApplicationService } from '../../application/services/learning/MasteryApplicationService.js';
import { ErrorAnalysisApplicationService } from '../../application/services/learning/ErrorAnalysisApplicationService.js';
import { IdempotencyService } from '../../infrastructure/idempotency/IdempotencyService.js';
import { AuthRequest } from '../middleware/auth.js';
import { IStudentRepository } from '../../domain/interfaces/IStudentRepository.js';
import { AuthenticationError } from '../../domain/errors/AuthenticationError.js';
import { logger } from '../../infrastructure/logging/logger.js';

/**
 * HTTP boundary for standalone QuestionAttempt submission.
 *
 * This enables the real student journey: upload question → analyze → submit answer → mastery/error analysis.
 * Unlike AssessmentService.submitAnswer, this is for individual questions outside assessment context.
 *
 * Phase 6.3 invariants enforced here:
 * - Student identity is derived from the authenticated User → StudentProfile. The
 *   client may never send an authoritative studentId/skillId/microSkillId.
 * - The HTTP layer never returns the raw attempt/DB row or the pipeline result:
 *   only the safe student-facing projection is serialized.
 * - When an `Idempotency-Key` is present, attempt creation and mastery/error
 *   effects run inside the EXISTING idempotency transaction, so a retried request
 *   with the same key produces exactly one business effect. Without a key the
 *   effects are still idempotent per attempt id (the mastery/error services
 *   short-circuit on replay).
 */
export class QuestionAttemptController {
  constructor(
    private readonly questionAttemptService: QuestionAttemptService,
    private readonly masteryApplicationService: MasteryApplicationService,
    private readonly errorAnalysisApplicationService: ErrorAnalysisApplicationService,
    private readonly studentRepository: IStudentRepository,
    private readonly idempotencyService?: IdempotencyService,
    /**
     * Phase 7.4: read-only access used to resolve the display name of an
     * attempt's authoritative PRIMARY MicroSkill. Optional so existing test
     * constructions keep working; when absent the label is simply null.
     */
    private readonly prisma?: PrismaClient
  ) {}

  submitAttempt = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = this.requireUserId(req);
      const studentId = await this.getStudentId(userId);

      const { questionId, answer, timeSpentSeconds, confidence, instanceId } = req.body;
      const sessionId = req.body.sessionId || 'standalone';
      const idempotencyKey = (req as any).idempotencyKey as string | undefined;

      const body = {
        studentId,
        sessionId,
        sessionQuestionId: req.body.sessionQuestionId,
        questionId,
        answer,
        timeSpentSeconds,
        confidence,
        instanceId,
      };

      // Step 1 — persist the authoritative attempt. When an Idempotency-Key is
      // present this runs inside the EXISTING idempotency transaction, so the
      // attempt and the idempotency record share one atomic commit (matching the
      // AssessmentService pattern). Only the attempt write happens here — the
      // mastery/error services own their own transactions and must NOT nest.
      const attempt = idempotencyKey && this.idempotencyService
        ? await this.idempotencyService.execute(
            userId,
            'SUBMIT_QUESTION_ATTEMPT',
            idempotencyKey,
            { questionId, answer, timeSpentSeconds, sessionId, instanceId },
            // The attempt write goes through the idempotency transaction client
            // so it is atomic with the idempotency record (no nested tx).
            async (tx: any) => this.questionAttemptService.submitAnswer(body, tx)
          )
        : await this.questionAttemptService.submitAnswer(body);

      // Step 2 — apply mastery (idempotent per attempt). A failure is logged and
      // never invalidates the attempt that already committed.
      try {
        await this.masteryApplicationService.applyAttemptMastery({ attemptId: attempt.attemptId });
      } catch (error) {
        logger.error({ error, attemptId: attempt.attemptId }, 'Mastery application failed for standalone attempt');
      }

      // Step 3 — error analysis for incorrect attempts (idempotent per attempt).
      try {
        await this.errorAnalysisApplicationService.processAttemptError({ attemptId: attempt.attemptId });
      } catch (error) {
        logger.error({ error, attemptId: attempt.attemptId }, 'Error analysis failed for standalone attempt');
      }

      // Step 4 — build the SAFE student-facing result. AI-failure states are
      // represented honestly (errorAnalysis null, evaluationState explicit).
      // We await the full attempt detail to ensure error analysis is complete
      // before returning, avoiding a race condition where the client receives
      // incomplete information.
      const attemptDetail = await this.questionAttemptService.getAttempt(attempt.attemptId);
      const result = await this.toStudentAttemptView(attemptDetail);

      res.status(201).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  };

  getAttempt = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = this.requireUserId(req);
      const studentId = await this.getStudentId(userId);
      const { attemptId } = req.params;

          const attempt = await this.questionAttemptService.getAttempt(attemptId);

          // Authorization: student can only read their own attempts. A non-existent
          // attempt (null) is indistinguishable from one that is not the caller's.
          if (!attempt || attempt.studentId !== studentId) {
            res.status(403).json({ success: false, error: 'Not authorized to access this attempt' });
            return;
          }

          // The projection resolves the question's curriculum label, so it is
          // awaited: serialising the promise would return `{}` to the client.
          res.json({ success: true, data: await this.toStudentAttemptView(attempt) });
        } catch (error) {
          next(error);
        }
      };

      getStudentAttempts = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
        try {
          const userId = this.requireUserId(req);
          const studentId = await this.getStudentId(userId);
          const limit = parseInt(req.query.limit as string) || 50;

          const attempts = await this.questionAttemptService.getAttemptsForStudent(studentId, limit);
          const views = await Promise.all(
            attempts.map((a) => this.toStudentAttemptView(a))
          );
          res.json({ success: true, data: views });
        } catch (error) {
          next(error);
        }
      };

      /**
       * Phase 6.7 — safe, student-facing projection of a PERSISTED attempt.
       *
       * The GET endpoints previously returned the raw Prisma row, which (a) leaked
       * fields the browser has no business seeing — the canonical `question.correctAnswer`
       * in bulk, the internal `metadata` blob, AI `relatedSkills` / `validationResult` —
       * and (b) did not match the contract the student UI actually consumes (`attemptId`,
       * `evaluationState`). This projection keeps ONLY what the authenticated owner needs
       * and never returns internal identifiers beyond the attempt id they already own.
       *
       * Phase 7.4 — the resolved PRIMARY MicroSkill NAME (never its internal id) is
       * added so the student UI can label a recurring weakness with the curriculum
       * term the student actually studies. It is read from the same authoritative
       * mapping the mastery/error-analysis pipeline uses; when no active PRIMARY
       * mapping exists the field is null and the UI must say "analiz bekleniyor"
       * rather than inventing a topic.
       */
      private async toStudentAttemptView(row: any): Promise<Record<string, unknown>> {
        const evaluationState = this.readEvaluationState(row?.metadata);
        const errorAnalysis = row?.errorAnalysis
          ? {
              errorType: row.errorAnalysis.errorType ?? null,
              hypothesis: row.errorAnalysis.hypothesis ?? null,
              validated: Boolean(row.errorAnalysis.validated),
            }
          : null;

        const skillName = await this.resolvePrimarySkillName(row?.question?.id);

        return {
          attemptId: row.id,
          evaluationState,
          isCorrect: Boolean(row.isCorrect),
          correctAnswer: evaluationState === 'NOT_EVALUABLE' ? null : undefined,
          // The canonical answer is NEVER part of this projection: reading it in bulk
          // would hand out answer keys for the whole journey. Guidance/analysis flows
          // derive what they need server-side.
          questionId: row.questionId ?? null,
          question: row.question ? { id: row.question.id, content: row.question.content } : null,
          // Curriculum label (display only) — the internal microSkillId is not exposed.
          skillName,
          answer: row.answer ?? null,
          errorType: row.errorType ?? null,
          errorAnalysis,
          createdAt: row.createdAt ?? null,
        };
      }

      /**
       * Resolve the display name of the question's authoritative PRIMARY MicroSkill.
       * Read-only and best-effort: a missing mapping is a null label, never a
       * guessed one.
       */
      private async resolvePrimarySkillName(questionId: unknown): Promise<string | null> {
        if (!this.prisma || typeof questionId !== 'string' || questionId.length === 0) {
          return null;
        }
        try {
          const mapping = await this.prisma.questionSkillMapping.findFirst({
            where: { questionId, isPrimary: true },
            orderBy: { createdAt: 'asc' },
          });
          if (!mapping) {
            return null;
          }
          const microSkill = await this.prisma.microSkill.findUnique({
            where: { id: mapping.microSkillId },
          });
          return microSkill && microSkill.isActive ? microSkill.name : null;
        } catch (error) {
          logger.warn({ error, questionId }, 'Primary skill resolution failed for attempt view');
          return null;
        }
      }

      /** Parse the safe evaluation-state blob written at attempt creation. */
      private readEvaluationState(metadata: unknown): string | null {
        if (typeof metadata !== 'string' || metadata.length === 0) {
          return null;
        }
        try {
          const parsed = JSON.parse(metadata);
          return typeof parsed?.evaluationState === 'string' ? parsed.evaluationState : null;
        } catch {
          return null;
        }
      }

  private requireUserId(req: AuthRequest): string {
    if (!req.userId) {
      throw new AuthenticationError('Authentication required');
    }
    return req.userId;
  }

  /**
   * Resolve the caller's StudentProfile id.
   *
   * Phase 5F.8 / A2: this FAILS CLOSED. A User without a StudentProfile is
   * authenticated but is not a student, so no attempt is created. The previous
   * behaviour of falling back to the raw User.id is removed: mastery, error
   * analysis and attempt ownership all key on StudentProfile.id, so using a
   * User.id would silently create orphan/inconsistent records. We never create a
   * StudentProfile implicitly here.
   *
   * The lookup reuses the shared IStudentRepository (the same mechanism already
   * used by RecommendationController) rather than duplicating Prisma access.
   */
  private async getStudentId(userId: string): Promise<string> {
    const student = await this.studentRepository.findByUserId(userId);
    if (!student) {
      throw new AuthenticationError(
        'Student profile not found for authenticated user'
      );
    }
    return student.id;
  }
}