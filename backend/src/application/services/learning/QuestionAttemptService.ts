import { PrismaClient } from '@prisma/client';
import { logger } from '../../../infrastructure/logging/logger.js';
import { AuthorizationError } from '../../../domain/errors/AuthenticationError.js';


export interface SubmitAnswerDTO {
  studentId: string;
  sessionId?: string;
  sessionQuestionId?: string;
  questionId: string;
  answer: string;
  timeSpentSeconds: number;
  confidence?: number;
  /**
   * Optional explicit QuestionInstance the student is answering. When supplied,
   * the backend verifies ownership and binds the attempt to it. The client may
   * never use it to escape the student's own journey.
   */
  instanceId?: string;
}

/**
 * Phase 6.3 — explicit, backend-owned evaluation state.
 *
 * `EVALUATED` means the backend deterministically established correctness from a
 * canonical `correctAnswer`. `NOT_EVALUABLE` means no canonical answer exists, so
 * correctness CANNOT be determined. This is represented explicitly rather than
 * guessed: the attempt is preserved, but it carries no authoritative correctness
 * signal and therefore never mutates mastery or produces an ErrorAnalysis.
 */
export type AnswerEvaluationState = 'EVALUATED' | 'NOT_EVALUABLE';

/**
 * Safe, student-facing projection of a submitted attempt.
 *
 * Deliberately EXCLUDES: raw model output, internal prompts, provider metadata,
 * and any internal identifiers beyond the attempt id the student already owns.
 * The canonical answer is only echoed once the attempt is EVALUATED, so an
 * unevaluable (open-ended) attempt never leaks a fabricated/empty answer key.
 */
export interface StudentFacingAttemptResult {
  attemptId: string;
  evaluationState: AnswerEvaluationState;
  isCorrect: boolean;
  correctAnswer: string | null;
  errorType: string | null;
}

export interface SubmitAnswerResult extends StudentFacingAttemptResult {
  /** Internal: raw attempt row, used by orchestration only — never returned to HTTP. */
  attempt: any;
}

export class QuestionAttemptService {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Persist an authoritative attempt.
   *
   * @param dbClient Optional transaction client. When the caller already holds an
   *   interactive transaction (e.g. the idempotency middleware), the attempt MUST
   *   be written through THAT client so the write is atomic with the idempotency
   *   record and does not deadlock against an open SQLite transaction.
   */
  async submitAnswer(dto: SubmitAnswerDTO, dbClient?: PrismaClient): Promise<any> {
    const db = (dbClient ?? this.prisma) as PrismaClient;

    // For standalone attempts, sessionId may be 'standalone' and we skip session-specific logic
    const isStandalone = dto.sessionId === 'standalone' || !dto.sessionId;

    if (!isStandalone) {
      const existing = await db.questionAttempt.findFirst({
        where: {
          studentId: dto.studentId,
          questionId: dto.questionId,
          sessionId: dto.sessionId,
        },
        orderBy: { createdAt: 'desc' },
      });

      if (existing) {
        const timeSince = Date.now() - new Date(existing.createdAt).getTime();
        if (timeSince < 5000) {
          throw new Error('Duplicate submission detected');
        }
      }
    }

    const question = await db.question.findUnique({
      where: { id: dto.questionId },
    });

    if (!question) {
      throw new AuthorizationError('Question is not available to this student');
    }

    // Phase 5F.8 / A3: a student may only answer a Question that is legitimately
    // available through their own journey. Merely existing in the Question table
    // is NOT sufficient (that would make every bank question globally
    // answerable). The two real availability relations in the current schema are
    // reused — no new permission model is introduced:
    //   1. a QuestionInstance owned by this student (the upload journey), or
    //   2. a LearningSessionQuestion inside a LearningSession owned by this
    //      student (the practice-session journey).
    const owningInstanceId = await this.assertQuestionAvailableToStudent(
      dto.studentId,
      dto.questionId,
      dto.instanceId,
      db
    );

    // Phase 7.2: an INACTIVE question is not part of the reusable bank, so it is
    // answerable ONLY through the student's own upload instance (the legitimate
    // picture upload journey). It can never be answered via a shared session or
    // another student's relation. Active, non-fixture questions are unaffected.
    if (question.isActive === false && owningInstanceId === null) {
      throw new AuthorizationError('Question is not available to this student');
    }

    // Deterministic backend evaluation. When no canonical answer exists we do
    // NOT guess: the attempt is recorded as NOT_EVALUABLE (see below), which is a
    // distinct state from "incorrect" so that an unevaluable attempt can never
    // masquerade as a wrong answer and never injects a mastery/error signal.
    const evaluation = this.evaluateAnswer(question, dto.answer);
    const isCorrect = evaluation.state === 'EVALUATED' ? evaluation.isCorrect : false;
    const errorType =
      evaluation.state === 'EVALUATED' && !isCorrect
        ? this.detectErrorType(question, dto.answer)
        : null;

    const attempt = await db.questionAttempt.create({
      data: {
        studentId: dto.studentId,
        questionId: dto.questionId,
        sessionId: isStandalone ? null : dto.sessionId,
        sessionQuestionId: dto.sessionQuestionId,
        // Bind the attempt to the instance the student actually owns (when the
        // question is reached through the upload journey). Ownership was already
        // verified above; the id can never point at another student's instance.
        instanceId: owningInstanceId,
        answer: dto.answer,
        isCorrect,
        timeSpentSeconds: dto.timeSpentSeconds,
        confidence: dto.confidence,
        errorType,
        status: 'COMPLETED',
        validatedAt: new Date(),
        // Safe metadata only: the evaluation state and whether a canonical key
        // existed. Never the question text, answer text or AI content.
        metadata: JSON.stringify({
          evaluationState: evaluation.state,
          hasCanonicalAnswer: evaluation.hasCanonicalAnswer,
        }),
      },
    });

    // Only update session-specific data for non-standalone attempts
    if (!isStandalone) {
      if (dto.sessionQuestionId) {
        await db.learningSessionQuestion.update({
          where: { id: dto.sessionQuestionId },
          data: {
            status: 'ANSWERED',
            answeredAt: new Date(),
          },
        });
      }

      await db.learningSession.update({
        where: { id: dto.sessionId },
        data: {
          correctAnswers: { increment: isCorrect ? 1 : 0 },
        },
      });
    }

    logger.info({
      attemptId: attempt.id,
      studentId: dto.studentId,
      questionId: dto.questionId,
      isCorrect,
      errorType,
      evaluationState: evaluation.state,
      isStandalone,
    }, 'Question attempt recorded');

    return {
      attemptId: attempt.id,
      evaluationState: evaluation.state,
      isCorrect,
      // The canonical answer is only revealed for an EVALUATED attempt. An
      // unevaluable (e.g. student-uploaded open-ended) attempt returns null so
      // no fabricated answer key reaches the student.
      correctAnswer: evaluation.state === 'EVALUATED' ? question.correctAnswer : null,
      errorType,
      attempt,
    };
  }

  /**
   * Minimum safe visibility rule for standalone question answering.
   *
   * A Question is available to a student when it appears in that student's
   * journey via an existing relation. Staff/system flows that legitimately do not
   * go through a student journey use their own services (e.g. AssessmentService,
   * which enforces its own assessment-scoped visibility), so this guard is scoped
   * to the student-facing standalone path.
   *
   * Returns the owning QuestionInstance id when the question was reached through
   * the upload journey, so the caller can bind the attempt to that instance.
   */
  private async assertQuestionAvailableToStudent(
    studentId: string,
    questionId: string,
    requestedInstanceId?: string,
    dbClient?: PrismaClient
  ): Promise<string | null> {
    const db = (dbClient ?? this.prisma) as PrismaClient;

    // When the client names an instance, ownership is checked against THAT
    // instance and nothing else — an instance belonging to another student is
    // never accepted, even if the student also happens to own another instance
    // for the same question.
    const instance = requestedInstanceId
      ? await db.questionInstance.findFirst({
          where: { id: requestedInstanceId, studentId, questionId },
          select: { id: true },
        })
      : await db.questionInstance.findFirst({
          where: { studentId, questionId },
          select: { id: true },
        });
    if (instance) {
      return instance.id;
    }

    // A named instance that does not belong to the caller is rejected outright;
    // there is no fall-through to the session relation.
    if (requestedInstanceId) {
      throw new AuthorizationError('Question is not available to this student');
    }

    const sessionQuestion = await db.learningSessionQuestion.findFirst({
      where: {
        questionId,
        session: { studentId },
      },
      select: { id: true },
    });
    if (sessionQuestion) {
      return null;
    }

    // Do not disclose whether the Question exists: a question the caller cannot
    // answer is indistinguishable from one that is not part of their journey.
    throw new AuthorizationError(
      'Question is not available to this student'
    );
  }

  /**
   * Authoritative answer evaluation.
   *
   * Phase 6 limitation: For OPEN_ENDED questions from student uploads,
   * the system cannot objectively score answers without a canonical correctAnswer.
   * In such cases, the attempt is preserved but correctness cannot be determined.
   *
   * Evaluation rules:
   * - MULTIPLE_CHOICE: exact string match (case-insensitive, trimmed)
   * - CALCULATION: normalized string match (whitespace removed, lowercased)
   * - OPEN_ENDED: exact match when a canonical answer exists; otherwise NOT_EVALUABLE
   * - Other types: exact string match as fallback
   *
   * AI is NEVER used for authoritative scoring. When the backend cannot
   * deterministically establish correctness, it says so explicitly
   * (`NOT_EVALUABLE`) instead of inventing a scoring mechanism.
   */
  private evaluateAnswer(
    question: any,
    answer: string
  ): { state: AnswerEvaluationState; isCorrect: boolean; hasCanonicalAnswer: boolean } {
    const canonical =
      typeof question.correctAnswer === 'string' ? question.correctAnswer.trim() : '';

    if (canonical === '') {
      // No canonical answer available - correctness cannot be established.
      logger.warn(
        { questionId: question.id, questionType: question.type },
        'Answer not evaluable: no canonical correctAnswer available'
      );
      return { state: 'NOT_EVALUABLE', isCorrect: false, hasCanonicalAnswer: false };
    }

    const normalized = answer.trim();
    if (question.type === 'MULTIPLE_CHOICE') {
      return {
        state: 'EVALUATED',
        isCorrect: normalized.toLowerCase() === canonical.toLowerCase(),
        hasCanonicalAnswer: true,
      };
    }
    if (question.type === 'CALCULATION') {
      const normalizedAnswer = normalized.replace(/\s/g, '').toLowerCase();
      const normalizedCorrect = canonical.replace(/\s/g, '').toLowerCase();
      return {
        state: 'EVALUATED',
        isCorrect: normalizedAnswer === normalizedCorrect,
        hasCanonicalAnswer: true,
      };
    }
    // Exact match for any remaining type that has a canonical answer.
    return {
      state: 'EVALUATED',
      isCorrect: normalized === canonical,
      hasCanonicalAnswer: true,
    };
  }

  private detectErrorType(question: any, answer: string): string | null {
    if (!answer || answer.trim() === '') {
      return 'ATTENTION';
    }

    const hasNumbers = /\d/.test(answer);
    const hasOperators = /[+\-*/=]/.test(answer);

    if (question.type === 'CALCULATION') {
      if (hasNumbers && !hasOperators) {
        return 'CALCULATION';
      }
      return 'OPERATION';
    }

    if (question.type === 'MULTIPLE_CHOICE') {
      return 'CONCEPT';
    }

    return 'OTHER';
  }

  async getAttempt(attemptId: string): Promise<any> {
    return this.prisma.questionAttempt.findUnique({
      where: { id: attemptId },
      include: {
        question: {
          include: {
            options: true,
          },
        },
        errorAnalysis: true,
      },
    });
  }

  async getAttemptsForStudent(studentId: string, limit: number = 50): Promise<any[]> {
    return this.prisma.questionAttempt.findMany({
      where: { studentId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: {
        question: {
          include: {
            options: true,
          },
        },
        errorAnalysis: true,
      },
    });
  }
}
