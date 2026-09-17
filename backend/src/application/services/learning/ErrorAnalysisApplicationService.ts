import { PrismaClient, Prisma } from '@prisma/client';
import { logger } from '../../../infrastructure/logging/logger.js';
import {
  AIErrorAnalysisService,
  type ErrorAnalysisResult,
} from '../ai/AIErrorAnalysisService.js';
import { writeAudit } from '../ingestion/ingestionAudit.js';
import { CONFIDENCE_THRESHOLDS } from '../../../domain/ingestion/confidencePolicy.js';

/**
 * ErrorAnalysisApplicationService — Phase 5F.4
 *
 * Turns ONE persisted, INCORRECT QuestionAttempt into AT MOST ONE authoritative
 * ErrorAnalysis row, linked to an EXISTING ErrorPattern from the authoritative
 * taxonomy.
 *
 *   QuestionAttempt (incorrect)
 *     -> PRIMARY QuestionSkillMapping -> MicroSkill
 *     -> AI error classification (abstraction)
 *     -> resolve EXISTING ErrorPattern + MicroSkill compatibility
 *     -> ErrorAnalysis (attemptId @unique -> idempotent)
 *
 * HARD RULES
 * - Correct attempts never produce an ErrorAnalysis.
 * - The AI may only CLASSIFY into the existing taxonomy. It can never create or
 *   modify ErrorPattern / ErrorPatternMicroSkill / MicroSkill / curriculum.
 * - An unknown or MicroSkill-incompatible pattern is NOT persisted as an
 *   authoritative classification (errorPatternId stays null; review required).
 * - One attempt = at most one ErrorAnalysis (enforced by attemptId @unique).
 * - The effect owns its OWN transaction and runs AFTER the attempt tx commits.
 * - Audit stores IDs/metadata only, never raw question/answer/AI content.
 */

/** Stable classification states persisted on ErrorAnalysis.validated + metadata. */
export const ERROR_CLASSIFICATION_STATE = {
  CLASSIFIED: 'CLASSIFIED',
  REVIEW_REQUIRED: 'REVIEW_REQUIRED',
  UNCLASSIFIED: 'UNCLASSIFIED',
} as const;

export type ErrorClassificationState =
  (typeof ERROR_CLASSIFICATION_STATE)[keyof typeof ERROR_CLASSIFICATION_STATE];

/**
 * Governance mapping: the AI's coarse `errorType` -> the authoritative
 * ErrorPattern.category vocabulary. This is a FIXED, code-owned table — the AI
 * never proposes a category or a pattern; it only names a coarse error type.
 */
const ERROR_TYPE_TO_CATEGORIES: Record<string, string[]> = {
  CONCEPT: ['CONCEPTUAL_MISUNDERSTANDING'],
  PREREQUISITE: ['CONCEPTUAL_MISUNDERSTANDING', 'REASONING_ERROR'],
  SKILL: ['PROCEDURAL_ERROR', 'STRATEGY_ERROR'],
  OPERATION: ['PROCEDURAL_ERROR', 'CALCULATION_ERROR'],
  CALCULATION: ['CALCULATION_ERROR'],
  READING: ['INTERPRETATION_ERROR', 'PROBLEM_TRANSLATION_ERROR'],
  ATTENTION: ['VERIFICATION_FAILURE', 'CONDITION_OMISSION'],
  OTHER: [],
};

export interface ProcessAttemptErrorInput {
  attemptId: string;
}

export interface ProcessAttemptErrorResult {
  processed: boolean;
  reason?:
    | 'ATTEMPT_NOT_FOUND'
    | 'ATTEMPT_CORRECT'
    | 'ATTEMPT_NOT_EVALUABLE'
    | 'ALREADY_PROCESSED'
    | 'NO_PRIMARY_MAPPING'
    | 'MICROSKILL_INVALID'
    | 'AI_FAILED';
  state?: ErrorClassificationState;
  errorAnalysisId?: string;
  errorPatternId?: string | null;
  microSkillId?: string;
  confidence?: number;
}

export class ErrorAnalysisApplicationService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly aiErrorAnalysisService?: AIErrorAnalysisService
  ) {}

  async processAttemptError(input: ProcessAttemptErrorInput): Promise<ProcessAttemptErrorResult> {
    const { attemptId } = input;

    const attempt = await this.prisma.questionAttempt.findUnique({
      where: { id: attemptId },
      include: { question: true },
    });

    if (!attempt) {
      return { processed: false, reason: 'ATTEMPT_NOT_FOUND' };
    }

    // Rule 1: a correct attempt is never an error signal.
    if (attempt.isCorrect) {
      return { processed: false, reason: 'ATTEMPT_CORRECT' };
    }

    // Rule 1b (Phase 6.3): an attempt whose correctness could not be established
    // (NOT_EVALUABLE) is NOT an authoritative "incorrect" signal. Analysing it
    // would invite the model to diagnose a mistake that was never established, so
    // it is treated like a correct attempt: no ErrorAnalysis is produced.
    if (this.readEvaluationState(attempt.metadata) === 'NOT_EVALUABLE') {
      return { processed: false, reason: 'ATTEMPT_NOT_EVALUABLE' };
    }

    // Rule 2: idempotency — an existing ErrorAnalysis for this attempt is final.
    const already = await this.prisma.errorAnalysis.findUnique({ where: { attemptId } });
    if (already) {
      return {
        processed: false,
        reason: 'ALREADY_PROCESSED',
        errorAnalysisId: already.id,
        errorPatternId: already.errorPatternId,
      };
    }

    // Rule 3: resolve the authoritative MicroSkill from the PRIMARY mapping.
    const primaryMapping = await this.prisma.questionSkillMapping.findFirst({
      where: { questionId: attempt.questionId, isPrimary: true },
      orderBy: { createdAt: 'asc' },
    });
    if (!primaryMapping) {
      return { processed: false, reason: 'NO_PRIMARY_MAPPING' };
    }
    const microSkill = await this.prisma.microSkill.findUnique({
      where: { id: primaryMapping.microSkillId },
    });
    if (!microSkill || !microSkill.isActive) {
      return { processed: false, reason: 'MICROSKILL_INVALID' };
    }

    // Rule 4: obtain a classification through the AI abstraction. A failure is
    // never allowed to corrupt the attempt or mastery; it yields no analysis.
    let aiResult: ErrorAnalysisResult | null = null;
    if (this.aiErrorAnalysisService) {
      try {
        const previousRows = await this.prisma.questionAttempt.findMany({
          where: { studentId: attempt.studentId, questionId: attempt.questionId, id: { not: attempt.id } },
          select: { isCorrect: true, errorType: true, timeSpentSeconds: true },
          orderBy: { createdAt: 'desc' },
          take: 5,
        });
        aiResult = await this.aiErrorAnalysisService.analyzeError({
          question: attempt.question.content,
          studentAnswer: attempt.answer,
          correctAnswer: attempt.question.correctAnswer,
          skillId: microSkill.id,
          // The authoritative MicroSkill context (already resolved by the
          // backend) is handed to the model so it can reason about the skill —
          // the AI still cannot override or choose the MicroSkill.
          skillName: microSkill.name,
          skillDescription: microSkill.description,
          difficulty: attempt.question.difficulty ?? 1,
          previousAttempts: previousRows.map((r) => ({
            isCorrect: r.isCorrect,
            errorType: r.errorType ?? undefined,
            timeSpentSeconds: r.timeSpentSeconds,
          })),
          timeSpentSeconds: attempt.timeSpentSeconds,
        });
      } catch (error) {
        logger.error({ error, attemptId }, 'AI error analysis failed');
        return { processed: false, reason: 'AI_FAILED', microSkillId: microSkill.id };
      }
    }

    if (!aiResult) {
      return { processed: false, reason: 'AI_FAILED', microSkillId: microSkill.id };
    }

    // Rule 5: resolve the AI classification against the EXISTING taxonomy and
    // verify MicroSkill compatibility. No taxonomy entity is ever created.
    const decision = await this.resolvePattern(aiResult, microSkill.id);

    // Rule 6: persist exactly one ErrorAnalysis, atomically with its audit.
    const state: ErrorClassificationState = decision.patternId
      ? ERROR_CLASSIFICATION_STATE.CLASSIFIED
      : aiResult.confidence >= CONFIDENCE_THRESHOLDS.MEDIUM_MIN
        ? ERROR_CLASSIFICATION_STATE.REVIEW_REQUIRED
        : ERROR_CLASSIFICATION_STATE.UNCLASSIFIED;

    try {
      const created = await this.prisma.$transaction(async (tx) => {
        const analysis = await tx.errorAnalysis.create({
          data: {
            attemptId: attempt.id,
            studentId: attempt.studentId,
            errorPatternId: decision.patternId,
            errorType: decision.validatedErrorType,
            confidence: aiResult!.confidence,
            // Hypothesis is model-generated prose about the *error*, not raw
            // question/answer content; it is stored on the analysis, never audit.
            hypothesis: aiResult!.hypothesis,
            relatedSkills: JSON.stringify(aiResult!.relatedSkills ?? []),
            validated: decision.patternId !== null,
            metadata: JSON.stringify({
              state,
              model: aiResult!.metadata?.model ?? null,
              version: aiResult!.metadata?.version ?? null,
            }),
          },
        });

        // Audit: IDs and metadata only — never raw question/answer/AI content.
        await writeAudit(tx, {
          userId: null,
          action: 'ERROR_ANALYSIS_CREATED',
          entityType: 'ErrorAnalysis',
          entityId: analysis.id,
          details: {
            attemptId: attempt.id,
            studentId: attempt.studentId,
            microSkillId: microSkill.id,
            errorPatternId: decision.patternId,
            state,
            confidence: aiResult!.confidence,
          },
        });

        return analysis;
      });

      logger.info(
        { attemptId: attempt.id, errorAnalysisId: created.id, state },
        'ErrorAnalysis persisted'
      );

      return {
        processed: true,
        state,
        errorAnalysisId: created.id,
        errorPatternId: decision.patternId,
        microSkillId: microSkill.id,
        confidence: aiResult.confidence,
      };
    } catch (error) {
      // A racing insert on attemptId @unique means another worker already
      // persisted the authoritative analysis — treat as already processed.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const existing = await this.prisma.errorAnalysis.findUnique({ where: { attemptId: attempt.id } });
        return {
          processed: false,
          reason: 'ALREADY_PROCESSED',
          errorAnalysisId: existing?.id,
          errorPatternId: existing?.errorPatternId ?? null,
        };
      }
      throw error;
    }
  }

  /**
   * Read the Phase 6.3 evaluation state from the safe attempt metadata blob.
   * Absent/unparseable metadata is treated as a normal (evaluated) attempt.
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
   * Resolve the AI classification to an EXISTING, active ErrorPattern that is
   * compatible with the authoritative MicroSkill. Returns patternId=null when
   * no authoritative pattern can be justified — never fabricates taxonomy.
   */
  private async resolvePattern(
    aiResult: ErrorAnalysisResult,
    microSkillId: string
  ): Promise<{ patternId: string | null; validatedErrorType: string }> {
    const categories = ERROR_TYPE_TO_CATEGORIES[aiResult.errorType] ?? [];
    if (categories.length === 0) {
      return { patternId: null, validatedErrorType: aiResult.errorType };
    }

    // Candidate patterns must be active AND linked to the authoritative
    // MicroSkill through the existing ErrorPatternMicroSkill join.
    const compatible = await this.prisma.errorPattern.findMany({
      where: {
        isActive: true,
        category: { in: categories },
        microSkills: { some: { microSkillId } },
      },
      orderBy: [{ confidence: 'desc' }, { code: 'asc' }],
    });

    if (compatible.length === 0) {
      return { patternId: null, validatedErrorType: aiResult.errorType };
    }

    return { patternId: compatible[0].id, validatedErrorType: aiResult.errorType };
  }
}
