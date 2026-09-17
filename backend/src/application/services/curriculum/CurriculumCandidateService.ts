import { PrismaClient } from '@prisma/client';
import { logger } from '../../../infrastructure/logging/logger.js';
import { IdempotencyService } from '../../../infrastructure/idempotency/IdempotencyService.js';
import { writeAudit } from '../ingestion/ingestionAudit.js';
import {
  CANDIDATE_LEVELS,
  isCandidateLevel,
  isCandidateDecision,
  decisionRequiresReview,
  CONFIDENCE_MIN,
  CONFIDENCE_MAX,
  type CandidateLevel,
} from '../../../domain/curriculum/candidateVocabulary.js';
import {
  InvalidCandidateLevelError,
  InvalidCandidateDecisionError,
  CandidateQuestionNotFoundError,
  CurriculumTargetNotFoundError,
  ParentConsistencyError,
  DuplicateCandidateError,
  CandidateNotFoundError,
  InvalidConfidenceError,
  InvalidReviewStateError,
  CandidateAuthorizationError,
} from '../../../domain/errors/CurriculumCandidateErrors.js';

export const CANDIDATE_AUDIT_ACTIONS = {
  CURRICULUM_CANDIDATE_CREATED: 'CURRICULUM_CANDIDATE_CREATED',
  CURRICULUM_CANDIDATE_REVIEWED: 'CURRICULUM_CANDIDATE_REVIEWED',
  CURRICULUM_CANDIDATE_REJECTED: 'CURRICULUM_CANDIDATE_REJECTED',
} as const;

export interface CreateCandidateDTO {
  questionId: string;
  level: string;
  targetId: string;
  decision?: string;
  confidence: number;
  reviewed?: boolean;
  method?: string;
  rationale?: string;
  /**
   * Optional parent assertion. The schema does NOT store a parent on the
   * candidate, so when this is supplied it is used purely as a CONSISTENCY
   * CHECK against ProcessComponent.learningOutcomeId — it is never persisted
   * and never silently corrected.
   */
  learningOutcomeId?: string;
}

export interface ReviewCandidateDTO {
  decision: string;
  reviewed: boolean;
  rationale?: string;
  confidence?: number;
}

export interface ListCandidateFilters {
  level?: string;
  decision?: string;
}

/** Roles permitted to create or review curriculum candidates. */
const CANDIDATE_STAFF_ROLES = ['ADMIN', 'CONTENT_MANAGER', 'TEACHER'];

export function isCandidateStaffRole(role: string | undefined | null): boolean {
  return !!role && CANDIDATE_STAFF_ROLES.includes(role);
}

/**
 * CurriculumCandidateService — Phase 5C.
 *
 * A candidate management + validation layer ONLY. It records a curriculum
 * anchor that an authorised caller explicitly supplies. It never infers,
 * guesses or fabricates a curriculum mapping, and it never touches
 * Question.origin / Question.trust.
 */
export class CurriculumCandidateService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly idempotencyService?: IdempotencyService
  ) { }

  // ------------------------------------------------------------------ create

  async createCandidate(
    actorUserId: string,
    actorRole: string,
    dto: CreateCandidateDTO,
    idempotencyKey?: string
  ): Promise<any> {
    this.assertMayMutate(actorRole);

    // Validate everything cheaply and deterministically BEFORE opening a
    // transaction. These checks are pure input validation.
    if (!isCandidateLevel(dto.level)) {
      throw new InvalidCandidateLevelError(String(dto.level));
    }

    const decision = dto.decision ?? 'PENDING';
    if (!isCandidateDecision(decision)) {
      throw new InvalidCandidateDecisionError(String(decision));
    }

    this.assertValidConfidence(dto.confidence);

    const reviewed = dto.reviewed ?? false;
    this.assertReviewState(decision, reviewed);

    const run = (tx: any) => this.performCreateCandidate(tx, actorUserId, dto, decision, reviewed);

    if (this.idempotencyService && idempotencyKey) {
      return this.idempotencyService.execute(
        actorUserId,
        'CREATE_CURRICULUM_CANDIDATE',
        idempotencyKey,
        {
          questionId: dto.questionId,
          level: dto.level,
          targetId: dto.targetId,
          decision,
          confidence: dto.confidence,
        },
        run
      );
    }

    return this.prisma.$transaction(run);
  }

  private async performCreateCandidate(
    tx: any,
    actorUserId: string,
    dto: CreateCandidateDTO,
    decision: string,
    reviewed: boolean
  ): Promise<any> {
    // --- Question integrity ---
    const question = await tx.question.findUnique({ where: { id: dto.questionId } });
    if (!question) {
      throw new CandidateQuestionNotFoundError(dto.questionId);
    }

    // --- Target integrity + parent consistency ---
    await this.resolveAndValidateTarget(tx, dto);

    // --- Duplicate prevention (mirror of @@unique([questionId, level, targetId])) ---
    const existing = await tx.curriculumCandidate.findUnique({
      where: {
        questionId_level_targetId: {
          questionId: dto.questionId,
          level: dto.level,
          targetId: dto.targetId,
        },
      },
    });
    if (existing) {
      throw new DuplicateCandidateError();
    }

    const candidate = await tx.curriculumCandidate.create({
      data: {
        questionId: dto.questionId,
        level: dto.level,
        targetId: dto.targetId,
        confidence: dto.confidence,
        decision,
        method: dto.method ?? 'MANUAL',
        rationale: dto.rationale ?? null,
        reviewed,
        reviewedByUserId: reviewed ? actorUserId : null,
      },
    });

    await writeAudit(tx, {
      userId: actorUserId,
      action: CANDIDATE_AUDIT_ACTIONS.CURRICULUM_CANDIDATE_CREATED,
      entityType: 'CurriculumCandidate',
      entityId: candidate.id,
      details: {
        questionId: dto.questionId,
        level: dto.level,
        targetId: dto.targetId,
        decision,
        method: candidate.method,
      },
    });

    logger.info(
      { candidateId: candidate.id, questionId: dto.questionId, level: dto.level, decision },
      'CurriculumCandidate created'
    );

    return this.toPublic(candidate);
  }

  // -------------------------------------------------------------- read paths

  async getCandidate(candidateId: string): Promise<any> {
    const candidate = await this.prisma.curriculumCandidate.findUnique({
      where: { id: candidateId },
    });
    if (!candidate) {
      throw new CandidateNotFoundError(candidateId);
    }
    return this.toPublic(candidate);
  }

  async listCandidatesForQuestion(
    questionId: string,
    filters: ListCandidateFilters = {}
  ): Promise<any[]> {
    const question = await this.prisma.question.findUnique({ where: { id: questionId } });
    if (!question) {
      throw new CandidateQuestionNotFoundError(questionId);
    }

    if (filters.level !== undefined && !isCandidateLevel(filters.level)) {
      throw new InvalidCandidateLevelError(String(filters.level));
    }
    if (filters.decision !== undefined && !isCandidateDecision(filters.decision)) {
      throw new InvalidCandidateDecisionError(String(filters.decision));
    }

    const where: Record<string, unknown> = { questionId };
    if (filters.level !== undefined) where.level = filters.level;
    if (filters.decision !== undefined) where.decision = filters.decision;

    const candidates = await this.prisma.curriculumCandidate.findMany({
      where,
      orderBy: [{ createdAt: 'asc' }],
    });

    return candidates.map((c) => this.toPublic(c));
  }

  // ----------------------------------------------------------------- review

  /**
   * Settle a candidate's decision. Staff only.
   *
   * The candidate's target is re-validated on every mutation so a candidate can
   * never be settled against a curriculum row that no longer exists.
   */
  async reviewCandidate(
    actorUserId: string,
    actorRole: string,
    candidateId: string,
    dto: ReviewCandidateDTO
  ): Promise<any> {
    this.assertMayMutate(actorRole);

    if (!isCandidateDecision(dto.decision)) {
      throw new InvalidCandidateDecisionError(String(dto.decision));
    }

    if (dto.confidence !== undefined) {
      this.assertValidConfidence(dto.confidence);
    }

    this.assertReviewState(dto.decision, dto.reviewed);

    return this.prisma.$transaction(async (tx) =>
      this.performReviewCandidate(tx, actorUserId, candidateId, dto)
    );
  }

  private async performReviewCandidate(
    tx: any,
    actorUserId: string,
    candidateId: string,
    dto: ReviewCandidateDTO
  ): Promise<any> {
    const candidate = await tx.curriculumCandidate.findUnique({ where: { id: candidateId } });
    if (!candidate) {
      throw new CandidateNotFoundError(candidateId);
    }

    // Re-validate target integrity and parent consistency on mutation.
    await this.resolveAndValidateTarget(tx, {
      questionId: candidate.questionId,
      level: candidate.level,
      targetId: candidate.targetId,
    });

    const updated = await tx.curriculumCandidate.update({
      where: { id: candidateId },
      data: {
        decision: dto.decision,
        reviewed: dto.reviewed,
        reviewedByUserId: dto.reviewed ? actorUserId : null,
        rationale: dto.rationale ?? candidate.rationale,
        confidence: dto.confidence ?? candidate.confidence,
      },
    });

    await writeAudit(tx, {
      userId: actorUserId,
      action:
        dto.decision === 'REJECTED'
          ? CANDIDATE_AUDIT_ACTIONS.CURRICULUM_CANDIDATE_REJECTED
          : CANDIDATE_AUDIT_ACTIONS.CURRICULUM_CANDIDATE_REVIEWED,
      entityType: 'CurriculumCandidate',
      entityId: candidateId,
      details: { fromDecision: candidate.decision, toDecision: dto.decision, reviewed: dto.reviewed },
    });

    logger.info(
      { candidateId, from: candidate.decision, to: dto.decision },
      'CurriculumCandidate reviewed'
    );

    return this.toPublic(updated);
  }

  // ---------------------------------------------------- integrity primitives

  /**
   * Validate that `targetId` exists at the declared `level`, and that a
   * ProcessComponent actually sits under its asserted parent LearningOutcome.
   *
   * The schema stores no parent column on the candidate, so parent
   * consistency is DERIVED from ProcessComponent.learningOutcomeId, exactly as
   * the Phase 5C brief allows. A mismatch is rejected, never silently fixed.
   */
  private async resolveAndValidateTarget(
    tx: any,
    dto: { questionId: string; level: string; targetId: string; learningOutcomeId?: string }
  ): Promise<void> {
    if (dto.level === CANDIDATE_LEVELS.LEARNING_OUTCOME) {
      const lo = await tx.learningOutcome.findUnique({ where: { id: dto.targetId } });
      if (!lo) {
        throw new CurriculumTargetNotFoundError(dto.level, dto.targetId);
      }
      // A parent assertion is meaningless for a LearningOutcome target.
      if (dto.learningOutcomeId && dto.learningOutcomeId !== lo.id) {
        throw new ParentConsistencyError(dto.targetId, dto.learningOutcomeId);
      }
      return;
    }

    if (dto.level === CANDIDATE_LEVELS.PROCESS_COMPONENT) {
      const pc = await tx.processComponent.findUnique({ where: { id: dto.targetId } });
      if (!pc) {
        throw new CurriculumTargetNotFoundError(dto.level, dto.targetId);
      }
      // Parent consistency: the asserted parent must be the real parent.
      if (dto.learningOutcomeId && pc.learningOutcomeId !== dto.learningOutcomeId) {
        throw new ParentConsistencyError(dto.targetId, dto.learningOutcomeId);
      }
      return;
    }

    // Should be unreachable: level was validated before the transaction.
    throw new InvalidCandidateLevelError(String(dto.level));
  }

  // ------------------------------------------------------------- guards

  private assertMayMutate(actorRole: string): void {
    if (!isCandidateStaffRole(actorRole)) {
      throw new CandidateAuthorizationError();
    }
  }

  private assertValidConfidence(value: unknown): void {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new InvalidConfidenceError('confidence must be a finite number');
    }
    if (value < CONFIDENCE_MIN || value > CONFIDENCE_MAX) {
      throw new InvalidConfidenceError(
        `confidence must be between ${CONFIDENCE_MIN} and ${CONFIDENCE_MAX}`
      );
    }
  }

  /**
   * A settled decision (PRIMARY / SECONDARY / REJECTED) asserts a human
   * judgement, so it may not be stored with `reviewed = false`. PENDING is the
   * un-settled state and is the only decision valid while unreviewed.
   */
  private assertReviewState(decision: string, reviewed: boolean): void {
    if (decisionRequiresReview(decision) && reviewed !== true) {
      throw new InvalidReviewStateError(
        `decision ${decision} requires reviewed = true`
      );
    }
  }

  // ------------------------------------------------------------ projection

  /** Internal columns are not exposed; the targetId stays, the question text does not. */
  private toPublic(candidate: any): any {
    return {
      id: candidate.id,
      questionId: candidate.questionId,
      level: candidate.level,
      targetId: candidate.targetId,
      confidence: candidate.confidence,
      decision: candidate.decision,
      method: candidate.method,
      rationale: candidate.rationale ?? null,
      reviewed: candidate.reviewed,
      reviewedByUserId: candidate.reviewedByUserId ?? null,
      createdAt: candidate.createdAt,
      updatedAt: candidate.updatedAt,
    };
  }
}

export type { CandidateLevel };
