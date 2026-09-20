import { PrismaClient, Prisma } from '@prisma/client';
import { logger } from '../../../infrastructure/logging/logger.js';
import { MasteryCalculationService } from '../../../domain/services/learning/MasteryCalculationService.js';
import { MasteryVersionConflictError } from '../../../domain/errors/MasteryErrors.js';

/** Normalize a date to the start of its UTC day — the LearningProgress key. */
function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/**
 * MasteryApplicationService — Phase 5F.3
 *
 * Turns ONE persisted QuestionAttempt into ONE (idempotent) mastery effect:
 *
 *   QuestionAttempt
 *     -> PRIMARY QuestionSkillMapping -> MicroSkill
 *     -> SkillMastery (optimistic version guard)
 *     -> LearningProgress
 *     -> MasteryAudit
 *
 * INVARIANTS
 * - One attempt yields AT MOST ONE mastery effect (idempotent on attemptId).
 * - The authoritative MicroSkill is the question's PRIMARY mapping only;
 *   SECONDARY mappings are context, never mastery targets.
 * - No mapping / unknown or inactive MicroSkill => NO mastery mutation.
 * - The whole effect (SkillMastery + LearningProgress + MasteryAudit) is atomic
 *   inside ONE interactive transaction owned by this service. It never calls
 *   another service that opens its own transaction.
 * - Only safe metadata is written (no question text / answer / AI content).
 * - No ErrorPattern / ErrorAnalysis is created here (later phase).
 */

export interface ApplyMasteryInput {
  attemptId: string;
}

export interface ApplyMasteryResult {
  applied: boolean;
  reason?:
    | 'ATTEMPT_NOT_FOUND'
    | 'ATTEMPT_NOT_EVALUABLE'
    | 'NO_PRIMARY_MAPPING'
    | 'MICROSKILL_INVALID'
    | 'ALREADY_APPLIED';
  masteryAuditId?: string;
  microSkillId?: string;
  previousMastery?: number;
  newMastery?: number;
}

export class MasteryApplicationService {
  private readonly masteryCalculator = new MasteryCalculationService();

  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Idempotently apply the mastery effect for a QuestionAttempt.
   *
   * The correlation identity is `QuestionAttempt.id` under the `source`
   * 'QUESTION_ATTEMPT'. A pre-existing MasteryAudit with that correlation makes
   * a replay a no-op, so concurrent/duplicate processing cannot double-apply.
   */
  async applyAttemptMastery(input: ApplyMasteryInput): Promise<ApplyMasteryResult> {
    const { attemptId } = input;

    return this.prisma.$transaction(async (tx) => {
      const attempt = await tx.questionAttempt.findUnique({
        where: { id: attemptId },
        include: { question: true },
      });

      if (!attempt) {
        return { applied: false, reason: 'ATTEMPT_NOT_FOUND' };
      }

      // Phase 6.3: an attempt whose correctness could not be established
      // (NOT_EVALUABLE — e.g. a student-uploaded open-ended question with no
      // canonical answer) is NOT an authoritative learning signal. It must never
      // move mastery: doing so would fabricate a mastery delta from a guess.
      if (this.readEvaluationState(attempt.metadata) === 'NOT_EVALUABLE') {
        return { applied: false, reason: 'ATTEMPT_NOT_EVALUABLE' };
      }

      // --- Idempotency guard (inside the same transaction) ---
      // A prior mastery effect for this attempt means: do nothing.
      const already = await tx.masteryAudit.findFirst({
        where: { correlationId: attemptId, source: 'QUESTION_ATTEMPT' },
      });
      if (already) {
        return {
          applied: false,
          reason: 'ALREADY_APPLIED',
          masteryAuditId: already.id,
          microSkillId: already.skillId,
        };
      }

      // --- Resolve the authoritative MicroSkill: PRIMARY mapping only ---
      const primaryMapping = await tx.questionSkillMapping.findFirst({
        where: { questionId: attempt.questionId, isPrimary: true },
        orderBy: { createdAt: 'asc' },
      });
      if (!primaryMapping) {
        // No authoritative signal => never fall back to a synthetic skillId.
        return { applied: false, reason: 'NO_PRIMARY_MAPPING' };
      }

      const microSkill = await tx.microSkill.findUnique({
        where: { id: primaryMapping.microSkillId },
      });
      if (!microSkill || !microSkill.isActive) {
        return { applied: false, reason: 'MICROSKILL_INVALID' };
      }

      // Convention: skillId === microSkillId, and microSkillId carries the FK.
      const skillId = microSkill.id;

      // --- Read current mastery ---
      const current = await tx.skillMastery.findUnique({
        where: { studentId_skillId: { studentId: attempt.studentId, skillId } },
      });

      const currentLevel = current?.masteryLevel ?? 0;
      const currentConfidence = current?.confidence ?? 0;
      const attempts = current?.attempts ?? 0;
      const correctAttempts = current?.correctAttempts ?? 0;
      const evidenceCount = current?.evidenceCount ?? 0;
      const lastAttemptAt = current?.lastAttemptAt ?? null;
      const expectedVersion = current?.version ?? 0;

      const recencyDays = lastAttemptAt
        ? Math.max(0, (Date.now() - new Date(lastAttemptAt).getTime()) / (1000 * 60 * 60 * 24))
        : 30;

      // The mastery math is authoritative and returns a level clamped to [0,100].
      // The clamp is re-asserted here so a future calculator change can never
      // persist an out-of-range score through this path.
      const calculated = this.masteryCalculator.calculate({
        currentLevel,
        currentConfidence,
        isCorrect: attempt.isCorrect,
        difficulty: attempt.question.difficulty ?? 1,
        timeSpent: attempt.timeSpentSeconds,
        attemptsCount: attempts,
        correctAttempts,
        evidenceCount,
        recencyDays,
      });
      const result = {
        ...calculated,
        newLevel: Math.max(0, Math.min(100, calculated.newLevel)),
      };

      const nextReviewAt = new Date(
        Date.now() + this.calculateNextReviewDays(result.newLevel, result.newConfidence, attempt.isCorrect) * 24 * 60 * 60 * 1000
      );

      // --- Atomic writes: SkillMastery + LearningProgress + MasteryAudit ---
      let masteryAuditId: string;
      if (current) {
        // Optimistic concurrency: update only if the version is unchanged.
        const updated = await tx.skillMastery.updateMany({
          where: { id: current.id, version: expectedVersion },
          data: {
            masteryLevel: result.newLevel,
            confidence: result.newConfidence,
            attempts: { increment: 1 },
            correctAttempts: { increment: attempt.isCorrect ? 1 : 0 },
            lastAttemptAt: new Date(),
            trend: result.trend,
            nextReviewAt,
            evidenceCount: result.evidenceCount,
            version: { increment: 1 },
          },
        });
        if (updated.count === 0) {
          throw new MasteryVersionConflictError(attempt.studentId, skillId, expectedVersion);
        }
      } else {
        // First mastery row for this (student, microSkill). A racing insert would
        // violate @@unique([studentId, skillId]); translate it to a conflict.
        try {
          await tx.skillMastery.create({
            data: {
              studentId: attempt.studentId,
              skillId,
              microSkillId: skillId,
              masteryLevel: result.newLevel,
              confidence: result.newConfidence,
              attempts: 1,
              correctAttempts: attempt.isCorrect ? 1 : 0,
              lastAttemptAt: new Date(),
              trend: result.trend,
              nextReviewAt,
              evidenceCount: result.evidenceCount,
              version: 1,
            },
          });
        } catch (error) {
          if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
            throw new MasteryVersionConflictError(attempt.studentId, skillId, 0);
          }
          throw error;
        }
      }

      // LearningProgress is a DAILY snapshot keyed by (studentId, skillId, date).
      // Two attempts on the same day MUST fold into the same row rather than
      // attempt a second insert that violates the unique constraint. The values
      // are absolute backend-owned counters (never a frontend-derived percent).
      const progressDate = startOfUtcDay(new Date());
      await tx.learningProgress.upsert({
        where: {
          studentId_skillId_date: {
            studentId: attempt.studentId,
            skillId,
            date: progressDate,
          },
        },
        create: {
          studentId: attempt.studentId,
          skillId,
          date: progressDate,
          masteryLevel: result.newLevel,
          attemptsCount: 1,
          correctCount: attempt.isCorrect ? 1 : 0,
        },
        update: {
          masteryLevel: result.newLevel,
          attemptsCount: { increment: 1 },
          correctCount: { increment: attempt.isCorrect ? 1 : 0 },
        },
      });

      const audit = await tx.masteryAudit.create({
        data: {
          studentId: attempt.studentId,
          skillId,
          attemptId: attempt.id,
          previousMastery: currentLevel,
          newMastery: result.newLevel,
          reason: attempt.isCorrect ? 'CORRECT_ATTEMPT' : 'INCORRECT_ATTEMPT',
          source: 'QUESTION_ATTEMPT',
          correlationId: attempt.id,
        },
      });
      masteryAuditId = audit.id;

      // Create outbox event for mastery update
      await tx.outboxEvent.create({
        data: {
          eventType: 'MASTERY_UPDATED',
          aggregateType: 'SkillMastery',
          aggregateId: `${attempt.studentId}-${skillId}`,
          payload: JSON.stringify({
            studentId: attempt.studentId,
            skillId,
            previousMastery: currentLevel,
            newMastery: result.newLevel,
            attemptId: attempt.id,
            masteryAuditId: audit.id,
          }),
          status: 'PENDING',
        },
      });

      logger.info(
        {
          attemptId: attempt.id,
          studentId: attempt.studentId,
          microSkillId: skillId,
          previousMastery: currentLevel,
          newMastery: result.newLevel,
        },
        'Mastery applied from question attempt with outbox event'
      );

      return {
        applied: true,
        masteryAuditId,
        microSkillId: skillId,
        previousMastery: currentLevel,
        newMastery: result.newLevel,
      };
    });
  }

  /**
   * Read the Phase 6.3 evaluation state from the safe attempt metadata blob.
   * Absent/unparseable metadata is treated as a normal (evaluated) attempt so
   * that pre-existing attempts keep their historical behaviour.
   */
  private readEvaluationState(metadata: string | null | undefined): string | null {
    if (!metadata) {
      return null;
    }
    try {
      const parsed = JSON.parse(metadata);
      return typeof parsed?.evaluationState === 'string' ? parsed.evaluationState : null;
    } catch {
      return null;
    }
  }

  /**
   * Spaced-repetition review interval. Mirrors the historical MasteryService
   * heuristic (no product semantics changed) but is deterministic-safe: the
   * calculation service owns the mastery math, this only schedules review.
   */
  private calculateNextReviewDays(level: number, confidence: number, isCorrect: boolean): number {
    let baseDays: number;
    if (level >= 80 && confidence >= 0.7) {
      baseDays = 30;
    } else if (level >= 60 && confidence >= 0.5) {
      baseDays = 14;
    } else if (level >= 40) {
      baseDays = 7;
    } else {
      baseDays = 3;
    }
    if (!isCorrect) {
      baseDays = Math.max(1, Math.floor(baseDays / 2));
    }
    return baseDays;
  }
}
