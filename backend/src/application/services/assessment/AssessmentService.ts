import { PrismaClient } from '@prisma/client';
import { logger } from '../../../infrastructure/logging/logger.js';
import { IdempotencyService } from '../../../infrastructure/idempotency/IdempotencyService.js';
import { MasteryApplicationService } from '../learning/MasteryApplicationService.js';
import { ErrorAnalysisApplicationService } from '../learning/ErrorAnalysisApplicationService.js';
import { AIErrorAnalysisService } from '../ai/AIErrorAnalysisService.js';
import { NotFoundError } from '../../../domain/errors/NotFoundError.js';
import { ValidationError } from '../../../domain/errors/ValidationError.js';

export interface CreateAssessmentDTO {
  title: string;
  description?: string;
  type: 'DIAGNOSTIC' | 'FORMATIVE' | 'SUMMATIVE' | 'PRACTICE';
  skillIds: string[];
  topicIds?: string[];
  timeLimitMinutes?: number;
  passingScore?: number;
  metadata?: Record<string, unknown>;
}

export class AssessmentService {
  private readonly masteryApplicationService: MasteryApplicationService;
  private readonly errorAnalysisApplicationService: ErrorAnalysisApplicationService;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly idempotencyService?: IdempotencyService,
    masteryApplicationService?: MasteryApplicationService,
    errorAnalysisApplicationService?: ErrorAnalysisApplicationService
  ) {
    // Phase 5F.3: mastery is applied from a persisted QuestionAttempt. The
    // mastery effect owns its own transaction and runs AFTER the attempt write
    // commits, so no interactive transaction is nested.
    this.masteryApplicationService =
      masteryApplicationService ?? new MasteryApplicationService(prisma);
    // Phase 5F.4: attempt-level error analysis, likewise post-commit.
    this.errorAnalysisApplicationService =
      errorAnalysisApplicationService ??
      new ErrorAnalysisApplicationService(prisma, new AIErrorAnalysisService());
  }

  async createAssessment(dto: CreateAssessmentDTO): Promise<any> {
    const assessment = await this.prisma.assessment.create({
      data: {
        title: dto.title,
        description: dto.description,
        type: dto.type,
        status: 'DRAFT',
        skillIds: JSON.stringify(dto.skillIds),
        topicIds: dto.topicIds ? JSON.stringify(dto.topicIds) : null,
        totalQuestions: 0,
        timeLimitMinutes: dto.timeLimitMinutes,
        passingScore: dto.passingScore,
        isActive: true,
        metadata: dto.metadata ? JSON.stringify(dto.metadata) : null,
      },
    });

    logger.info({ assessmentId: assessment.id, type: assessment.type }, 'Assessment created');
    return assessment;
  }

  async addQuestionsToAssessment(assessmentId: string, questionIds: string[]): Promise<any> {
    const assessment = await this.prisma.assessment.findUnique({
      where: { id: assessmentId },
    });

    if (!assessment) {
      throw new Error('Assessment not found');
    }

    if (assessment.status === 'PUBLISHED') {
      throw new Error('Cannot add questions to published assessment');
    }

    const results = [];
    for (let i = 0; i < questionIds.length; i++) {
      const result = await this.prisma.assessmentQuestion.create({
        data: {
          assessmentId,
          questionId: questionIds[i],
          order: i + 1,
          points: 1,
        },
      });
      results.push(result);
    }

    await this.prisma.assessment.update({
      where: { id: assessmentId },
      data: {
        totalQuestions: { increment: questionIds.length },
      },
    });

    logger.info({ assessmentId, questionCount: questionIds.length }, 'Questions added to assessment');
    return results;
  }

  async publishAssessment(assessmentId: string): Promise<any> {
    const assessment = await this.prisma.assessment.findUnique({
      where: { id: assessmentId },
      include: { questions: true },
    });

    if (!assessment) {
      throw new Error('Assessment not found');
    }

    if (assessment.questions.length === 0) {
      throw new Error('Cannot publish assessment with no questions');
    }

    return this.prisma.assessment.update({
      where: { id: assessmentId },
      data: { status: 'PUBLISHED' },
    });
  }

  async startAssessment(studentId: string, assessmentId: string): Promise<any> {
    const assessment = await this.prisma.assessment.findUnique({
      where: { id: assessmentId },
    });

    if (!assessment) {
      throw new Error('Assessment not found');
    }

    if (assessment.status !== 'PUBLISHED') {
      throw new Error('Assessment is not published');
    }

    const existing = await this.prisma.assessmentAttempt.findUnique({
      where: {
        studentId_assessmentId: {
          studentId,
          assessmentId,
        },
      },
    });

    if (existing && existing.status === 'IN_PROGRESS') {
      return existing;
    }

    if (existing && existing.status === 'COMPLETED') {
      throw new Error('Assessment already completed');
    }

    const attempt = await this.prisma.assessmentAttempt.create({
      data: {
        studentId,
        assessmentId,
        startedAt: new Date(),
        status: 'IN_PROGRESS',
      },
    });

    logger.info({ attemptId: attempt.id, assessmentId }, 'Assessment started');
    return attempt;
  }

  async submitAnswer(
    attemptId: string,
    questionId: string,
    answer: string,
    timeSpentSeconds: number,
    confidence?: number,
    userId?: string,
    idempotencyKey?: string,
    /** Phase 6.7: authenticated StudentProfile id, used to enforce ownership. */
    studentId?: string
  ): Promise<any> {
    // Phase 6.7 (IDOR): when a student identity is supplied, the referenced
    // assessment attempt MUST belong to that student. Enforced up-front so a
    // hostile client cannot answer another student's attempt.
    if (studentId) {
      await this.assertAttemptOwnership(attemptId, studentId);
    }

    // If idempotency is provided, use the idempotency service
    const result = this.idempotencyService && userId && idempotencyKey
      ? await this.idempotencyService.execute(
          userId,
          'SUBMIT_ASSESSMENT_ANSWER',
          idempotencyKey,
          { attemptId, questionId, answer, timeSpentSeconds, confidence },
          async (tx) => {
            return this.submitAnswerInternal(tx, attemptId, questionId, answer, timeSpentSeconds, confidence, studentId);
          }
        )
      : await this.submitAnswerInternal(this.prisma, attemptId, questionId, answer, timeSpentSeconds, confidence, studentId);

    // Phase 5F.3: apply the mastery effect OUTSIDE the attempt transaction. The
    // effect is idempotent on the QuestionAttempt id, so a retry/replay is a
    // no-op and can never double-count mastery.
    const questionAttemptId = result?.questionAttemptId;
    if (questionAttemptId) {
      try {
        await this.masteryApplicationService.applyAttemptMastery({ attemptId: questionAttemptId });
      } catch (error) {
        // Mastery is a downstream learning signal; a mastery failure (e.g. a
        // concurrent version conflict) must not fail the answer submission that
        // already succeeded. It is logged and can be retried idempotently.
        logger.error({ error, questionAttemptId }, 'Mastery application failed for attempt');
      }

      // Phase 5F.4: attempt-level error analysis. Runs after the attempt tx has
      // committed, owns its own transaction, and is idempotent per attempt. A
      // correct attempt is a no-op; a failure never corrupts the attempt/mastery.
      try {
        await this.errorAnalysisApplicationService.processAttemptError({ attemptId: questionAttemptId });
      } catch (error) {
        logger.error({ error, questionAttemptId }, 'Error analysis failed for attempt');
      }
    }

    return result;
  }

  private async submitAnswerInternal(
    prismaClient: PrismaClient,
    attemptId: string,
    questionId: string,
    answer: string,
    timeSpentSeconds: number,
    confidence?: number,
    studentId?: string
  ): Promise<any> {
    // If we are already inside a transaction (e.g. the idempotency service
    // opened one and passed us its `tx`), Prisma's TransactionClient has no
    // `$transaction` method. In that case run inline so we do not attempt a
    // nested transaction and do not lose atomicity with the caller's tx.
    if (typeof (prismaClient as any).$transaction !== 'function') {
      return this.performSubmitAnswer(prismaClient as any, attemptId, questionId, answer, timeSpentSeconds, confidence, studentId);
    }
    return prismaClient.$transaction(async (tx) => {
      return this.performSubmitAnswer(tx as any, attemptId, questionId, answer, timeSpentSeconds, confidence, studentId);
    });
  }

  private async performSubmitAnswer(
    tx: PrismaClient,
    attemptId: string,
    questionId: string,
    answer: string,
    timeSpentSeconds: number,
    confidence?: number,
    studentId?: string
  ): Promise<any> {
    {
      const attempt = await tx.assessmentAttempt.findUnique({
        where: { id: attemptId },
        include: {
          assessment: true,
          questionAttempts: true,
        },
      });

      if (!attempt) {
        throw new NotFoundError('Assessment attempt', attemptId);
      }

      // Phase 6.7 (defence in depth): re-assert ownership inside the write path.
      this.assertOwnershipOf(attempt, studentId);

      if (attempt.status !== 'IN_PROGRESS') {
        throw new ValidationError('Assessment is not in progress');
      }

      const assessmentQuestion = await tx.assessmentQuestion.findUnique({
        where: {
          assessmentId_questionId: {
            assessmentId: attempt.assessmentId,
            questionId,
          },
        },
        include: { question: true },
      });

      if (!assessmentQuestion) {
        throw new ValidationError('Question is not part of this assessment');
      }

      const existing = attempt.questionAttempts.find(q => q.questionId === questionId);
      if (existing) {
        throw new ValidationError('Question already answered');
      }

      const isCorrect = assessmentQuestion.question.correctAnswer === answer;

      const questionAttempt = await tx.questionAttempt.create({
        data: {
          studentId: attempt.studentId,
          questionId,
          assessmentAttemptId: attemptId,
          answer,
          isCorrect,
          timeSpentSeconds,
          confidence,
          status: 'COMPLETED',
          validatedAt: new Date(),
        },
      });

      const answers = attempt.answers ? JSON.parse(attempt.answers) : [];
      answers.push({
        questionId,
        answer,
        isCorrect,
        timeSpentSeconds,
      });

      await tx.assessmentAttempt.update({
        where: { id: attemptId },
        data: {
          answers: JSON.stringify(answers),
        },
      });

      // Create outbox event for assessment answer
      await tx.outboxEvent.create({
        data: {
          eventType: 'ASSESSMENT_ANSWER_SUBMITTED',
          aggregateType: 'QuestionAttempt',
          aggregateId: questionAttempt.id,
          payload: JSON.stringify({
            attemptId,
            questionAttemptId: questionAttempt.id,
            questionId,
            isCorrect,
            assessmentAttemptId: attemptId,
            studentId: attempt.studentId,
          }),
          status: 'PENDING',
        },
      });

      logger.info({
        attemptId,
        questionId,
        isCorrect,
      }, 'Assessment answer submitted transactionally with outbox event');

      return {
        attemptId,
        // Phase 5F.3: the persisted QuestionAttempt id is the correlation
        // identity for the mastery effect applied after this tx commits.
        questionAttemptId: questionAttempt.id,
        questionId,
        isCorrect,
        correctAnswer: assessmentQuestion.question.correctAnswer,
      };
    }
  }

  async completeAssessment(
    attemptId: string,
    userId?: string,
    idempotencyKey?: string,
    /** Phase 6.7: authenticated StudentProfile id, used to enforce ownership. */
    studentId?: string
  ): Promise<any> {
    // Phase 6.7 (IDOR): a student may only complete their own attempt.
    if (studentId) {
      await this.assertAttemptOwnership(attemptId, studentId);
    }

    // If idempotency is provided, use the idempotency service
    if (this.idempotencyService && userId && idempotencyKey) {
      return this.idempotencyService.execute(
        userId,
        'COMPLETE_ASSESSMENT',
        idempotencyKey,
        { attemptId },
        async (tx) => {
          return this.completeAssessmentInternal(tx, attemptId, studentId);
        }
      );
    }

    // Fall back to non-idempotent execution
    return this.completeAssessmentInternal(this.prisma, attemptId, studentId);
  }

  private async completeAssessmentInternal(
    prismaClient: PrismaClient,
    attemptId: string,
    studentId?: string
  ): Promise<any> {
    // See submitAnswerInternal: avoid nested transactions when an outer
    // transaction client (without `$transaction`) is supplied.
    if (typeof (prismaClient as any).$transaction !== 'function') {
      return this.performCompleteAssessment(prismaClient as any, attemptId, studentId);
    }
    return prismaClient.$transaction(async (tx) => {
      return this.performCompleteAssessment(tx as any, attemptId, studentId);
    });
  }

  private async performCompleteAssessment(
    tx: PrismaClient,
    attemptId: string,
    studentId?: string
  ): Promise<any> {
    {
      const attempt = await tx.assessmentAttempt.findUnique({
        where: { id: attemptId },
        include: {
          assessment: {
            include: {
              questions: {
                include: {
                  question: true,
                },
              },
            },
          },
          questionAttempts: {
            include: {
              question: true,
            },
          },
        },
      });

      if (!attempt) {
        throw new NotFoundError('Assessment attempt', attemptId);
      }

      // Phase 6.7 (defence in depth): re-assert ownership inside the write path.
      this.assertOwnershipOf(attempt, studentId);

      if (attempt.status === 'COMPLETED') {
        throw new ValidationError('Assessment already completed');
      }

      if (attempt.status !== 'IN_PROGRESS') {
        throw new ValidationError('Assessment is not in progress');
      }

      let totalScore = 0;
      let maxScore = 0;
      const skillScores = new Map<string, { correct: number; total: number }>();

      for (const q of attempt.questionAttempts) {
        const points = attempt.assessment.questions.find(aq => aq.questionId === q.questionId)?.points || 1;
        maxScore += points;
        if (q.isCorrect) {
          totalScore += points;
        }

        // Track skill-level scoring for AssessmentResult
        if (q.question.skillId) {
          const current = skillScores.get(q.question.skillId) || { correct: 0, total: 0 };
          skillScores.set(q.question.skillId, {
            correct: current.correct + (q.isCorrect ? 1 : 0),
            total: current.total + 1,
          });
        }
      }

      const percentageScore = maxScore > 0 ? (totalScore / maxScore) * 100 : 0;
      const timeSpentSeconds = Math.floor((Date.now() - new Date(attempt.startedAt).getTime()) / 1000);

      const completed = await tx.assessmentAttempt.update({
        where: { id: attemptId },
        data: {
          status: 'COMPLETED',
          completedAt: new Date(),
          score: totalScore,
          maxScore,
          percentageScore,
          timeSpentSeconds,
        },
      });

      // Create AssessmentResult entries for each skill
      for (const [skillId, scores] of skillScores.entries()) {
        await tx.assessmentResult.create({
          data: {
            assessmentAttemptId: attemptId,
            studentId: attempt.studentId,
            skillId,
            score: scores.correct,
            maxScore: scores.total,
            percentageScore: scores.total > 0 ? (scores.correct / scores.total) * 100 : 0,
            attempts: scores.total,
            correctAttempts: scores.correct,
          },
        });
      }

      // Create DiagnosticResult if this is a diagnostic assessment
      if (attempt.assessment.type === 'DIAGNOSTIC') {
        await tx.diagnosticResult.create({
          data: {
            assessmentAttemptId: attemptId,
            studentId: attempt.studentId,
            overallScore: percentageScore,
            overallConfidence: 0.8, // TODO: Calculate from AI or rules
            summary: `Diagnostic completed with ${percentageScore.toFixed(1)}% overall score`,
            skillResults: JSON.stringify(Object.fromEntries(skillScores.entries())),
          },
        });
      }

      // Create outbox event for assessment completion
      await tx.outboxEvent.create({
        data: {
          eventType: 'ASSESSMENT_COMPLETED',
          aggregateType: 'AssessmentAttempt',
          aggregateId: attemptId,
          payload: JSON.stringify({
            attemptId,
            studentId: attempt.studentId,
            assessmentId: attempt.assessmentId,
            score: totalScore,
            percentageScore,
            skillResults: Object.fromEntries(skillScores.entries()),
          }),
          status: 'PENDING',
        },
      });

      logger.info({
        attemptId,
        score: totalScore,
        percentageScore,
        skillResultsCount: skillScores.size,
      }, 'Assessment completed transactionally with results and outbox event');

      return completed;
    }
  }

  /**
   * Read assessment results.
   *
   * Phase 6.7: when a student identity is supplied (the student-facing route
   * always supplies it), the attempt MUST belong to that student. A non-owner is
   * refused with 404 semantics so the existence of another student's attempt is
   * not disclosed.
   */
  async getAssessmentResults(attemptId: string, studentId?: string): Promise<any> {
    const attempt = await this.prisma.assessmentAttempt.findUnique({
      where: { id: attemptId },
      include: {
        assessment: true,
        questionAttempts: {
          include: {
            question: true,
          },
        },
      },
    });

    if (!attempt) {
      throw new NotFoundError('Assessment attempt', attemptId);
    }

    if (studentId && attempt.studentId !== studentId) {
      // Deliberately indistinguishable from "not found".
      throw new NotFoundError('Assessment attempt', attemptId);
    }

    return this.toStudentResultsView(attempt);
  }

  /**
   * Phase 6.7 (answer-leakage hardening): the student-facing results projection
   * must not carry the canonical `correctAnswer`. The raw attempt row includes
   * `questionAttempts[].question`, and a Question row holds the answer key —
   * returning it in bulk would hand out canonical answers that guidance/correctness
   * flows deliberately keep server-side. Only the fields the student needs are
   * projected; the answer key is omitted for every nested question.
   */
  private toStudentResultsView(attempt: any): any {
    return {
      ...attempt,
      questionAttempts: Array.isArray(attempt.questionAttempts)
        ? attempt.questionAttempts.map((qa: any) => ({
            ...qa,
            question: qa.question
              ? {
                  id: qa.question.id,
                  content: qa.question.content,
                  type: qa.question.type,
                  difficulty: qa.question.difficulty,
                }
              : qa.question,
          }))
        : attempt.questionAttempts,
    };
  }

  /**
   * Phase 6.7 (IDOR guard): verify an assessment attempt belongs to the given
   * StudentProfile. A missing attempt or a non-owner both surface as NotFound so
   * the existence of another student's attempt is not disclosed.
   */
  private async assertAttemptOwnership(attemptId: string, studentId: string): Promise<void> {
    const attempt = await this.prisma.assessmentAttempt.findUnique({
      where: { id: attemptId },
      select: { studentId: true },
    });
    if (!attempt || attempt.studentId !== studentId) {
      throw new NotFoundError('Assessment attempt', attemptId);
    }
  }

  /** Same rule, applied to an already-loaded attempt row. */
  private assertOwnershipOf(attempt: { studentId: string }, studentId?: string): void {
    if (studentId && attempt.studentId !== studentId) {
      throw new NotFoundError('Assessment attempt', 'unauthorized');
    }
  }
}
