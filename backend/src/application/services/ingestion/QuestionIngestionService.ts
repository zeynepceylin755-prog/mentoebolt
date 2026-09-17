import { PrismaClient } from '@prisma/client';
import { logger } from '../../../infrastructure/logging/logger.js';
import { IdempotencyService } from '../../../infrastructure/idempotency/IdempotencyService.js';
import {
  IngestionState,
  INGESTION_STATES,
  canTransition,
  isCanonicalQuestionEligible,
  isTerminalIngestionState,
} from '../../../domain/ingestion/ingestionStateMachine.js';
import {
  QuestionOrigin,
  QuestionTrust,
  QUESTION_TRUST_LEVELS,
  trustWithinCeiling,
  isAutoPromotableOrigin,
} from '../../../domain/ingestion/provenance.js';
import { validateQuestionText } from '../../../domain/ingestion/inputValidation.js';
import {
  IngestionNotFoundError,
  InvalidStateTransitionError,
  ReviewRequiredError,
  TrustCeilingExceededError,
  InvalidIngestionInputError,
  QuestionCreationBlockedError,
  IngestionAuthorizationError,
} from '../../../domain/errors/IngestionErrors.js';
import { NotFoundError } from '../../../domain/errors/NotFoundError.js';
import { ValidationError } from '../../../domain/errors/ValidationError.js';
import { writeAudit, INGESTION_AUDIT_ACTIONS } from './ingestionAudit.js';

export interface CreateIngestionDTO {
  ingestMethod: 'IMAGE_UPLOAD' | 'TEXT_PASTE' | 'PDF' | 'BANK_IMPORT';
  rawText?: string;
  normalizedText?: string;
  sourceId?: string;
  originalAssetRef?: string;
  originalAssetMimeType?: string;
  originalAssetSizeBytes?: number;
  ocrConfidence?: number;
  parsingConfidence?: number;
  /** Student uploading this content. Null when performed by staff/system. */
  studentId?: string;
}

export interface TransitionIngestionDTO {
  toState: IngestionState;
  reviewNotes?: string;
  /** Actor performing the transition. Required for approval-gated states. */
  actorUserId?: string;
  actorRole?: string;
}

export interface Channel {
  userId?: string;
  /** Narrowed Prisma client: either PrismaClient or an active TransactionClient. */
  tx: any;
}

/** Confidence below this value forces the review gate. */
export const LOW_CONFIDENCE_THRESHOLD = 0.5;

export class QuestionIngestionService {
  /**
   * A blocked trust promotion detected inside a transaction that is about to
   * roll back. Recorded here so the audit entry can be written afterwards,
   * outside the failed transaction, and therefore survive.
   */
  private lastBlockedTrustAttempt:
    | { userId: string | null; details: Record<string, unknown> }
    | null = null;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly idempotencyService?: IdempotencyService
  ) {}

  // ------------------------------------------------------------------ create

  /**
   * Create a QuestionIngestion record.
   *
   * Transaction + idempotency boundary (brief §12): when an idempotency key is
   * supplied the IdempotencyRecord claim and the ingestion insert share ONE
   * transaction, so a duplicated request can never produce a second row.
   * The existing IdempotencyService is reused — no new abstraction.
   */
  async createIngestion(
    userId: string,
    dto: CreateIngestionDTO,
    idempotencyKey?: string
  ): Promise<any> {
    if (!dto.ingestMethod) {
      throw new ValidationError('ingestMethod is required');
    }

    // Validate raw input up-front (deterministic, no AI).
    // An empty string is treated the same as absent input: it carries no
    // information and must never silently create a usable ingestion.
    const rawText = normalizeOptionalText(dto.rawText);
    const normalizedText = normalizeOptionalText(dto.normalizedText);

    if (rawText === null && normalizedText === null && !dto.originalAssetRef) {
      throw new InvalidIngestionInputError(
        'An ingestion requires rawText, normalizedText or an asset reference'
      );
    }

    // Raw text that is present but unusable is recorded as an extraction
    // failure rather than rejected outright, so the caller can retry with a
    // better capture. Normalized text, however, must be genuinely usable or the
    // ingestion is refused up front.
    if (rawText !== null && !validateQuestionText(rawText).valid && normalizedText === null) {
      throw new InvalidIngestionInputError(
        `rawText is not usable (${validateQuestionText(rawText).reason})`
      );
    }

    const payload = {
      ingestMethod: dto.ingestMethod,
      rawText,
      normalizedText,
      sourceId: dto.sourceId ?? null,
      studentId: dto.studentId ?? null,
    };

    const run = (tx: any) => this.performCreateIngestion(tx, userId, dto, rawText, normalizedText);

    if (this.idempotencyService && idempotencyKey) {
      return this.idempotencyService.execute(
        userId,
        'CREATE_QUESTION_INGESTION',
        idempotencyKey,
        payload,
        run
      );
    }

    return this.prisma.$transaction(run);
  }

  private async performCreateIngestion(
    tx: any,
    userId: string,
    dto: CreateIngestionDTO,
    rawText: string | null,
    normalizedText: string | null
  ): Promise<any> {
    // A source, when supplied, must exist and be active.
    let source: any = null;
    if (dto.sourceId) {
      source = await tx.questionSource.findUnique({ where: { id: dto.sourceId } });
      if (!source) {
        throw new NotFoundError('QuestionSource', dto.sourceId);
      }
      if (!source.isActive) {
        throw new InvalidIngestionInputError('QuestionSource is not active');
      }
    }

    const extractionFailed = rawText !== null && !validateQuestionText(rawText).valid && !normalizedText;

    const ingestion = await tx.questionIngestion.create({
      data: {
        sourceId: dto.sourceId ?? null,
        ingestedByUserId: userId,
        ingestMethod: dto.ingestMethod,
        originalAssetRef: dto.originalAssetRef ?? null,
        originalAssetMimeType: dto.originalAssetMimeType ?? null,
        originalAssetSizeBytes: dto.originalAssetSizeBytes ?? null,
        rawExtractedText: rawText,
        ocrConfidence: dto.ocrConfidence ?? null,
        extractionFailed,
        extractionErrorMessage: extractionFailed ? 'Extracted text failed validation' : null,
        normalizedText,
        parsingConfidence: dto.parsingConfidence ?? null,
        state: extractionFailed ? INGESTION_STATES.EXTRACTION_FAILED : INGESTION_STATES.INGESTED,
        requiresReview: true,
      },
    });

    await writeAudit(tx, {
      userId,
      action: INGESTION_AUDIT_ACTIONS.INGESTION_CREATED,
      entityType: 'QuestionIngestion',
      entityId: ingestion.id,
      details: { ingestMethod: dto.ingestMethod, state: ingestion.state, sourceId: dto.sourceId ?? null },
    });

    logger.info(
      { ingestionId: ingestion.id, userId, ingestMethod: dto.ingestMethod, state: ingestion.state },
      'QuestionIngestion created'
    );

    return this.toPublicIngestion(ingestion);
  }

  // -------------------------------------------------------------------- read

  /**
   * Load an ingestion the caller is allowed to see.
   *
   * A student may only read their own ingestions; staff roles may read any.
   */
  async getIngestion(
    ingestionId: string,
    actorUserId: string,
    actorRole: string
  ): Promise<any> {
    const ingestion = await this.prisma.questionIngestion.findUnique({
      where: { id: ingestionId },
    });

    if (!ingestion) {
      throw new IngestionNotFoundError(ingestionId);
    }

    this.assertCanRead(ingestion, actorUserId, actorRole);
    return this.toPublicIngestion(ingestion);
  }

  private assertCanRead(ingestion: any, actorUserId: string, actorRole: string): void {
    if (isStaffRole(actorRole)) {
      return;
    }
    if (ingestion.ingestedByUserId && ingestion.ingestedByUserId === actorUserId) {
      return;
    }
    // Never disclose existence of another user's record.
    throw new IngestionNotFoundError(ingestion.id);
  }

  // -------------------------------------------------------------- transition

  /**
   * Apply a state transition.
   *
   * Atomicity (brief §12): the whole transition — state change, trust
   * validation, canonical Question creation and QuestionInstance creation —
   * runs in a single transaction. A failure at any point leaves no partial
   * state.
   */
  async transitionIngestion(
    ingestionId: string,
    actorUserId: string,
    actorRole: string,
    dto: TransitionIngestionDTO,
    idempotencyKey?: string
  ): Promise<any> {
    this.lastBlockedTrustAttempt = null;

    const run = async (tx: any) => {
      try {
        return await this.performTransition(tx, ingestionId, actorUserId, actorRole, dto);
      } catch (error) {
        // The transaction will roll back, so any audit row written inside it is
        // lost. Emit the blocked-promotion audit outside the transaction now.
        await this.flushBlockedTrustAudit(ingestionId);
        throw error;
      }
    };

    if (this.idempotencyService && idempotencyKey) {
      return this.idempotencyService.execute(
        actorUserId,
        'TRANSITION_QUESTION_INGESTION',
        idempotencyKey,
        { ingestionId, toState: dto.toState, reviewNotes: dto.reviewNotes ?? null },
        run
      );
    }

    return this.prisma.$transaction(run);
  }

  /**
   * Persist a TRUST_PROMOTION_ATTEMPT audit row after a rollback, when a blocked
   * attempt was detected. Best-effort: a failure here must not mask the original
   * domain error.
   */
  private async flushBlockedTrustAudit(ingestionId: string): Promise<void> {
    const pending = this.lastBlockedTrustAttempt;
    this.lastBlockedTrustAttempt = null;
    if (!pending) {
      return;
    }
    try {
      await this.prisma.auditLog.create({
        data: {
          userId: pending.userId,
          action: INGESTION_AUDIT_ACTIONS.TRUST_PROMOTION_ATTEMPT,
          entityType: 'QuestionIngestion',
          entityId: ingestionId,
          details: JSON.stringify(pending.details),
        },
      });
    } catch {
      // Never let audit failure mask the original error.
    }
  }

  private async performTransition(
    tx: any,
    ingestionId: string,
    actorUserId: string,
    actorRole: string,
    dto: TransitionIngestionDTO
  ): Promise<any> {
    const ingestion = await tx.questionIngestion.findUnique({
      where: { id: ingestionId },
      include: { source: true },
    });

    if (!ingestion) {
      throw new IngestionNotFoundError(ingestionId);
    }

    const from: string = ingestion.state;
    const to: string = dto.toState;

    // Approving and rejecting are review actions: staff only.
    if (to === INGESTION_STATES.APPROVED || to === INGESTION_STATES.REJECTED) {
      if (!isStaffRole(actorRole)) {
        throw new IngestionAuthorizationError(
          `${to} requires an ADMIN or CONTENT_MANAGER role`
        );
      }
    } else {
      // Non-review transitions are still scoped to the owner (or staff).
      this.assertCanRead(ingestion, actorUserId, actorRole);
    }

    if (isTerminalIngestionState(from)) {
      throw new InvalidStateTransitionError(from, to);
    }

    if (!canTransition(from, to)) {
      throw new InvalidStateTransitionError(from, to);
    }

    if (to === INGESTION_STATES.APPROVED) {
      await this.evaluateApprovalGates(ingestion);
    }

    // Entering the review state is what arms the review flag. A staff approval
    // is the human decision that discharges it (see evaluateApprovalGates).
    let nextRequiresReview = ingestion.requiresReview;
    if (to === INGESTION_STATES.REVIEW_REQUIRED) {
      nextRequiresReview = true;
    } else if (to === INGESTION_STATES.APPROVED) {
      nextRequiresReview = false;
    }

    if (to === INGESTION_STATES.NORMALIZED) {
      const validation = validateQuestionText(ingestion.normalizedText);
      if (!validation.valid) {
        throw new QuestionCreationBlockedError(
          `normalizedText is not usable (${validation.reason})`
        );
      }
    }

    const updated = await tx.questionIngestion.update({
      where: { id: ingestionId },
      data: {
        state: to,
        reviewNotes: dto.reviewNotes ?? ingestion.reviewNotes,
        requiresReview: nextRequiresReview,
      },
    });

    await writeAudit(tx, {
      userId: actorUserId,
      action:
        to === INGESTION_STATES.APPROVED
          ? INGESTION_AUDIT_ACTIONS.INGESTION_APPROVED
          : to === INGESTION_STATES.REJECTED
            ? INGESTION_AUDIT_ACTIONS.INGESTION_REJECTED
            : INGESTION_AUDIT_ACTIONS.INGESTION_STATE_CHANGED,
      entityType: 'QuestionIngestion',
      entityId: ingestionId,
      details: { from, to, actorRole },
    });

    logger.info({ ingestionId, from, to, actorUserId }, 'QuestionIngestion state changed');
    return this.toPublicIngestion(updated);
  }

  // ---------------------------------------------------------- approval gates

  /**
   * Enforce every pre-condition for APPROVED.
   *
   * These are the safety invariants of the layer. They are checked in the
   * service layer, not the controller, so they hold regardless of the caller.
   */
  private async evaluateApprovalGates(ingestion: any): Promise<void> {
    const validation = validateQuestionText(ingestion.normalizedText);

    if (!validation.valid) {
      throw new QuestionCreationBlockedError(
        `normalizedText is not usable (${validation.reason})`
      );
    }

    if (ingestion.extractionFailed) {
      throw new ReviewRequiredError('extraction failed');
    }

    if (
      ingestion.ocrConfidence !== null &&
      ingestion.ocrConfidence !== undefined &&
      ingestion.ocrConfidence < LOW_CONFIDENCE_THRESHOLD
    ) {
      throw new ReviewRequiredError('OCR confidence is below threshold');
    }

    if (
      ingestion.parsingConfidence !== null &&
      ingestion.parsingConfidence !== undefined &&
      ingestion.parsingConfidence < LOW_CONFIDENCE_THRESHOLD
    ) {
      throw new ReviewRequiredError('parsing confidence is below threshold');
    }

    if (ingestion.source) {
      const ceiling = ingestion.source.trustCeiling;
      if (!trustWithinCeiling(QUESTION_TRUST_LEVELS.HUMAN_APPROVED, ceiling)) {
        // Record the blocked attempt so it survives the transaction rollback.
        // This must happen OUTSIDE the failing transaction, hence the dedicated
        // prisma write rather than writeAudit(tx, ...).
        this.lastBlockedTrustAttempt = {
          userId: ingestion.ingestedByUserId ?? null,
          details: {
            attempted: QUESTION_TRUST_LEVELS.HUMAN_APPROVED,
            ceiling,
            origin: ingestion.source.origin,
          },
        };
        throw new TrustCeilingExceededError(QUESTION_TRUST_LEVELS.HUMAN_APPROVED, ceiling);
      }
    }
  }

  // ------------------------------------------------------- canonical question

  /**
   * Create (or reuse) the canonical Question and the student instance.
   *
   * Reachable only from a state that has passed human review, and only for
   * content that passed validation. Never produces a curriculum mapping or an
   * AI-derived artefact.
   *
   * Phase 5F.5 — review states that may yield a canonical Question:
   *   - APPROVED: the fully-promoted state for auto-promotable origins
   *     (MEB, MENTORA_MANUAL, ...).
   *   - REVIEW_REQUIRED: the terminal review state for NON auto-promotable
   *     origins (STUDENT_UPLOADED). Those sources carry a trust ceiling below
   *     HUMAN_APPROVED, so APPROVED is intentionally unreachable for them
   *     (schema-proposal §103). Student-uploaded content therefore produces its
   *     canonical Question at REVIEW_REQUIRED, where a staff reviewer acts, and
   *     the produced Question stays non-bank-visible (isActive=false,
   *     trust=UNVERIFIED). This keeps the review gate intact: nothing is created
   *     from the pre-review states NORMALIZED / ANALYZED / MAPPED.
   */
  async createCanonicalQuestionFromIngestion(
    ingestionId: string,
    actorUserId: string,
    actorRole: string
  ): Promise<{ question: any; instance: any | null }> {
    return this.prisma.$transaction(async (tx) =>
      this.performCanonicalQuestionCreation(tx, ingestionId, actorUserId, actorRole)
    );
  }

  private async performCanonicalQuestionCreation(
    tx: any,
    ingestionId: string,
    actorUserId: string,
    actorRole: string
  ): Promise<{ question: any; instance: any | null }> {
    const ingestion = await tx.questionIngestion.findUnique({
      where: { id: ingestionId },
      include: { source: true },
    });

    if (!ingestion) {
      throw new IngestionNotFoundError(ingestionId);
    }

    // Authorization (Phase 5F.8 / A1): canonicalization is an ownership-scoped
    // action. A student may only canonicalize an ingestion they uploaded; staff
    // roles may operate on any ingestion under the existing review model. This
    // uses the SAME assertCanRead rule as the read/transition paths — no parallel
    // authorization logic is introduced, and the state machine / trust gates
    // below are unaffected (a non-owner simply never reaches them).
    this.assertCanRead(ingestion, actorUserId, actorRole);

    // Eligibility is by state alone; INGESTED (and every pre-review state) is
    // explicitly not eligible to produce a canonical Question.
    if (!isCanonicalQuestionEligible(ingestion.state)) {
      throw new QuestionCreationBlockedError(`state ${ingestion.state} is not question-eligible`);
    }

    // Beyond raw eligibility, the ingestion must have reached a reviewed state.
    // APPROVED is available to every origin; REVIEW_REQUIRED is additionally
    // accepted ONLY for non auto-promotable origins (student uploads), for which
    // APPROVED is structurally unreachable because their trust ceiling sits below
    // HUMAN_APPROVED. Pre-review states (NORMALIZED / ANALYZED / MAPPED) are never
    // sufficient, so the human review gate is never bypassed.
    const origin: QuestionOrigin | null = ingestion.source?.origin ?? null;
    const isReviewedState =
      ingestion.state === INGESTION_STATES.APPROVED ||
      (ingestion.state === INGESTION_STATES.REVIEW_REQUIRED &&
        origin !== null &&
        !isAutoPromotableOrigin(origin));

    if (!isReviewedState) {
      throw new QuestionCreationBlockedError(
        `ingestion is in state ${ingestion.state}; a reviewed state (APPROVED` +
          (origin !== null && !isAutoPromotableOrigin(origin)
            ? ' or REVIEW_REQUIRED for non auto-promotable origins'
            : '') +
          ') is required to produce a canonical Question'
      );
    }

    const validation = validateQuestionText(ingestion.normalizedText);
    if (!validation.valid) {
      throw new QuestionCreationBlockedError(
        `normalizedText is not usable (${validation.reason})`
      );
    }

    // Idempotent: an ingestion may yield at most one canonical question
    // (QuestionIngestion.resultingQuestionId is @unique).
    if (ingestion.resultingQuestionId) {
      const existing = await tx.question.findUnique({
        where: { id: ingestion.resultingQuestionId },
      });
      if (existing) {
        return { question: this.toPublicQuestion(existing), instance: null };
      }
    }

    const trust: QuestionTrust =
      origin && isAutoPromotableOrigin(origin)
        ? QUESTION_TRUST_LEVELS.HUMAN_APPROVED
        : QUESTION_TRUST_LEVELS.UNVERIFIED;

    // Phase 5F.5 dedup decision: `Question.canonicalKey` is deliberately NOT
    // derived from the student asset reference. Two schema-level reasons:
    //   1) an uploaded photo is not a reliable content identity (the same page
    //      can be re-photographed), so keying on it risks merging distinct items;
    //   2) QuestionIngestion.resultingQuestionId is @unique, so two ingestions
    //      cannot point at one canonical Question without a schema change.
    // Automated photo dedup was explicitly deferred in the Phase 5 design, so
    // cross-ingestion canonical reuse is reported as a known limitation here.
    const question = await tx.question.create({
      data: {
        content: validation.trimmed as string,
        type: 'OPEN_ENDED',
        difficulty: 1,
        skillId: 'unmapped',
        correctAnswer: '',
        sourceId: ingestion.sourceId ?? null,
        origin,
        trust,
        isFixture: false,
        isActive: false,
      },
    });

    await tx.questionIngestion.update({
      where: { id: ingestionId },
      data: { resultingQuestionId: question.id },
    });

    // Student submission -> an instance. Bank/system ingestion -> no instance.
    let instance: any = null;
    if (ingestion.ingestedByUserId) {
      const student = await tx.studentProfile.findUnique({
        where: { userId: ingestion.ingestedByUserId },
      });
      if (student) {
        instance = await tx.questionInstance.create({
          data: {
            questionId: question.id,
            ingestionId: ingestion.id,
            studentId: student.id,
            assetRef: ingestion.originalAssetRef ?? null,
            assetMimeType: ingestion.originalAssetMimeType ?? null,
          },
        });
      }
    }

    logger.info(
      { ingestionId, questionId: question.id, instanceId: instance?.id ?? null, actorUserId },
      'Canonical Question created from ingestion'
    );

    return {
      question: this.toPublicQuestion(question),
      instance: instance ? this.toPublicInstance(instance) : null,
    };
  }

  // ------------------------------------------------------------- projections

  /**
   * Public projections. Internal columns are not exposed:
   * `rawExtractedText` and the asset reference are withheld from API responses.
   */
  private toPublicIngestion(ingestion: any): any {
    return {
      id: ingestion.id,
      state: ingestion.state,
      ingestMethod: ingestion.ingestMethod,
      sourceId: ingestion.sourceId ?? null,
      normalizedText: ingestion.normalizedText ?? null,
      ocrConfidence: ingestion.ocrConfidence ?? null,
      parsingConfidence: ingestion.parsingConfidence ?? null,
      extractionFailed: ingestion.extractionFailed,
      requiresReview: ingestion.requiresReview,
      reviewNotes: ingestion.reviewNotes ?? null,
      resultingQuestionId: ingestion.resultingQuestionId ?? null,
      createdAt: ingestion.createdAt,
      updatedAt: ingestion.updatedAt,
    };
  }

  private toPublicQuestion(question: any): any {
    return {
      id: question.id,
      content: question.content,
      type: question.type,
      difficulty: question.difficulty,
      trust: question.trust,
      origin: question.origin ?? null,
      isActive: question.isActive,
    };
  }

  private toPublicInstance(instance: any): any {
    return {
      id: instance.id,
      questionId: instance.questionId,
      ingestionId: instance.ingestionId ?? null,
      studentId: instance.studentId ?? null,
      uploadedAt: instance.uploadedAt,
    };
  }
}

/** Staff roles permitted to perform review actions. */
export function isStaffRole(role: string | undefined | null): boolean {
  return role === 'ADMIN' || role === 'CONTENT_MANAGER' || role === 'TEACHER';
}

/**
 * Coerce optional text input: undefined/null/empty-string all become null.
 * This is what makes `rawText: ''` behave as "absent" rather than as content.
 */
function normalizeOptionalText(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== 'string') {
    return null;
  }
  return value.length === 0 ? null : value;
}
