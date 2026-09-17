import { PrismaClient, Prisma } from '@prisma/client';
import { logger } from '../../../infrastructure/logging/logger.js';
import { IdempotencyService } from '../../../infrastructure/idempotency/IdempotencyService.js';
import { writeAudit } from '../ingestion/ingestionAudit.js';
import {
  isMappingSource,
  RELEVANCE_MIN,
  RELEVANCE_MAX,
  AI_CONFIDENCE_MIN,
  AI_CONFIDENCE_MAX,
} from '../../../domain/skills/mappingVocabulary.js';
import {
  MappingQuestionNotFoundError,
  MappingMicroSkillNotFoundError,
  MicroSkillCurriculumInvalidError,
  DuplicateQuestionSkillMappingError,
  PrimarySkillMappingExistsError,
  InvalidRelevanceError,
  InvalidAiConfidenceError,
  InvalidMappingSourceError,
  InvalidMappingReviewStateError,
  MappingNotFoundError,
  MappingAuthorizationError,
} from '../../../domain/errors/QuestionSkillMappingErrors.js';

export const MAPPING_AUDIT_ACTIONS = {
  QUESTION_SKILL_MAPPING_CREATED: 'QUESTION_SKILL_MAPPING_CREATED',
  QUESTION_SKILL_MAPPING_REVIEWED: 'QUESTION_SKILL_MAPPING_REVIEWED',
  QUESTION_SKILL_MAPPING_REJECTED: 'QUESTION_SKILL_MAPPING_REJECTED',
} as const;

export interface CreateMappingDTO {
  questionId: string;
  microSkillId: string;
  isPrimary?: boolean;
  relevance: number;
  aiConfidence?: number | null;
  mappingSource?: string;
  reviewed?: boolean;
}

export interface ReviewMappingDTO {
  reviewed: boolean;
  isPrimary?: boolean;
  relevance?: number;
  aiConfidence?: number | null;
}

export interface ListMappingFilters {
  isPrimary?: boolean;
  reviewed?: boolean;
}

/** Roles permitted to create or review question skill mappings. */
const MAPPING_STAFF_ROLES = ['ADMIN', 'CONTENT_MANAGER', 'TEACHER'];

export function isMappingStaffRole(role: string | undefined | null): boolean {
  return !!role && MAPPING_STAFF_ROLES.includes(role);
}

/**
 * QuestionSkillMappingService — Phase 5D.
 *
 * The mapping WRITER only. It validates and persists a mapping decision that an
 * authorised caller explicitly supplies. It never infers a MicroSkill from
 * question content: no keyword matching, no regex, no heuristics, no fabricated
 * aiConfidence.
 *
 * I13 is the central invariant:
 *   - a Question has AT MOST ONE PRIMARY mapping
 *   - a Question has 0..N SECONDARY mappings
 *   - a (questionId, microSkillId) pair exists at most once
 */
export class QuestionSkillMappingService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly idempotencyService?: IdempotencyService
  ) {}

  // ------------------------------------------------------------------ create

  async createMapping(
    actorUserId: string,
    actorRole: string,
    dto: CreateMappingDTO,
    idempotencyKey?: string
  ): Promise<any> {
    this.assertMayMutate(actorRole);

    // --- Pure input validation, before any transaction is opened ---
    this.assertValidRelevance(dto.relevance);

    const isPrimary = dto.isPrimary ?? false;
    const mappingSource = dto.mappingSource ?? 'MANUAL_REVIEW';
    if (!isMappingSource(mappingSource)) {
      throw new InvalidMappingSourceError(String(mappingSource));
    }

    // aiConfidence: null is valid and meaningful (non-AI/manual mapping).
    if (dto.aiConfidence !== undefined && dto.aiConfidence !== null) {
      this.assertValidAiConfidence(dto.aiConfidence);
    }

    const reviewed = dto.reviewed ?? false;

    const run = (tx: any) =>
      this.performCreateMapping(tx, actorUserId, dto, isPrimary, mappingSource, reviewed);

    if (this.idempotencyService && idempotencyKey) {
      return this.idempotencyService.execute(
        actorUserId,
        'CREATE_QUESTION_SKILL_MAPPING',
        idempotencyKey,
        {
          questionId: dto.questionId,
          microSkillId: dto.microSkillId,
          isPrimary,
          relevance: dto.relevance,
          mappingSource,
        },
        run
      );
    }

    return this.prisma.$transaction(run);
  }

  private async performCreateMapping(
    tx: any,
    actorUserId: string,
    dto: CreateMappingDTO,
    isPrimary: boolean,
    mappingSource: string,
    reviewed: boolean
  ): Promise<any> {
    // --- Question integrity ---
    const question = await tx.question.findUnique({ where: { id: dto.questionId } });
    if (!question) {
      throw new MappingQuestionNotFoundError(dto.questionId);
    }

    // --- MicroSkill integrity + curriculum chain ---
    await this.resolveAndValidateMicroSkill(tx, dto.microSkillId);

    // --- (questionId, microSkillId) uniqueness, mirrored from @@unique ---
    const existing = await tx.questionSkillMapping.findUnique({
      where: {
        questionId_microSkillId: {
          questionId: dto.questionId,
          microSkillId: dto.microSkillId,
        },
      },
    });
    if (existing) {
      throw new DuplicateQuestionSkillMappingError();
    }

    // --- I13: at most one PRIMARY per Question ---
    if (isPrimary) {
      await this.assertNoExistingPrimary(tx, dto.questionId);
    }

    // The uniqueness check above is a read-then-write; the database's
    // @@unique([questionId, microSkillId]) is the real guard under concurrency.
    // P2002 is translated into the same domain error so callers never see raw
    // Prisma errors.
    let mapping: any;
    try {
      mapping = await tx.questionSkillMapping.create({
        data: {
          questionId: dto.questionId,
          microSkillId: dto.microSkillId,
          relevance: dto.relevance,
          isPrimary,
          aiConfidence: dto.aiConfidence ?? null,
          mappingSource,
          reviewed,
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new DuplicateQuestionSkillMappingError();
      }
      throw error;
    }

    await writeAudit(tx, {
      userId: actorUserId,
      action: MAPPING_AUDIT_ACTIONS.QUESTION_SKILL_MAPPING_CREATED,
      entityType: 'QuestionSkillMapping',
      entityId: mapping.id,
      details: {
        questionId: dto.questionId,
        microSkillId: dto.microSkillId,
        isPrimary,
        mappingSource,
        relevance: dto.relevance,
      },
    });

    logger.info(
      {
        mappingId: mapping.id,
        questionId: dto.questionId,
        microSkillId: dto.microSkillId,
        isPrimary,
      },
      'QuestionSkillMapping created'
    );

    return this.toPublic(mapping);
  }

  // -------------------------------------------------------------- read paths

  async getMapping(mappingId: string): Promise<any> {
    const mapping = await this.prisma.questionSkillMapping.findUnique({
      where: { id: mappingId },
    });
    if (!mapping) {
      throw new MappingNotFoundError(mappingId);
    }
    return this.toPublic(mapping);
  }

  /**
   * List mappings for a canonical Question.
   * Returns PRIMARY and SECONDARY rows distinguishable via `isPrimary`.
   */
  async listMappingsForQuestion(
    questionId: string,
    filters: ListMappingFilters = {}
  ): Promise<any[]> {
    const question = await this.prisma.question.findUnique({ where: { id: questionId } });
    if (!question) {
      throw new MappingQuestionNotFoundError(questionId);
    }

    const where: Record<string, unknown> = { questionId };
    if (filters.isPrimary !== undefined) where.isPrimary = filters.isPrimary;
    if (filters.reviewed !== undefined) where.reviewed = filters.reviewed;

    const mappings = await this.prisma.questionSkillMapping.findMany({
      where,
      orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
    });

    return mappings.map((m) => this.toPublic(m));
  }

  // ----------------------------------------------------------------- review

  /**
   * Update review state and/or relevance/aiConfidence of an existing mapping.
   *
   * Flipping a mapping to PRIMARY runs the same I13 check as creation, so this
   * path cannot be used to smuggle in a second PRIMARY row.
   */
  async reviewMapping(
    actorUserId: string,
    actorRole: string,
    mappingId: string,
    dto: ReviewMappingDTO
  ): Promise<any> {
    this.assertMayMutate(actorRole);

    if (dto.relevance !== undefined) {
      this.assertValidRelevance(dto.relevance);
    }
    if (dto.aiConfidence !== undefined && dto.aiConfidence !== null) {
      this.assertValidAiConfidence(dto.aiConfidence);
    }
    // An unreviewed mapping may not claim a reviewer; and a mapping that is
    // being un-reviewed must not keep a stale assurance.
    if (typeof dto.reviewed !== 'boolean') {
      throw new InvalidMappingReviewStateError('reviewed must be a boolean');
    }

    return this.prisma.$transaction(async (tx) =>
      this.performReviewMapping(tx, actorUserId, mappingId, dto)
    );
  }

  private async performReviewMapping(
    tx: any,
    actorUserId: string,
    mappingId: string,
    dto: ReviewMappingDTO
  ): Promise<any> {
    const mapping = await tx.questionSkillMapping.findUnique({ where: { id: mappingId } });
    if (!mapping) {
      throw new MappingNotFoundError(mappingId);
    }

    // Re-validate the MicroSkill chain on every mutation, so a mapping can never
    // be re-settled against a curriculum row that has since disappeared.
    await this.resolveAndValidateMicroSkill(tx, mapping.microSkillId);

    const willBePrimary = dto.isPrimary ?? mapping.isPrimary;

    // I13 applies to promotion: promote only if no OTHER primary exists.
    if (willBePrimary && !mapping.isPrimary) {
      await this.assertNoExistingPrimary(tx, mapping.questionId);
    }

    const updated = await tx.questionSkillMapping.update({
      where: { id: mappingId },
      data: {
        reviewed: dto.reviewed,
        isPrimary: willBePrimary,
        relevance: dto.relevance ?? mapping.relevance,
        // null is a meaningful value (non-AI/manual mapping), so only an
        // explicitly undefined field leaves the stored value untouched.
        aiConfidence: dto.aiConfidence === undefined ? mapping.aiConfidence : dto.aiConfidence,
      },
    });

    await writeAudit(tx, {
      userId: actorUserId,
      action:
        dto.reviewed === false && mapping.reviewed === true
          ? MAPPING_AUDIT_ACTIONS.QUESTION_SKILL_MAPPING_REJECTED
          : MAPPING_AUDIT_ACTIONS.QUESTION_SKILL_MAPPING_REVIEWED,
      entityType: 'QuestionSkillMapping',
      entityId: mappingId,
      details: {
        questionId: mapping.questionId,
        microSkillId: mapping.microSkillId,
        fromPrimary: mapping.isPrimary,
        toPrimary: willBePrimary,
        reviewed: dto.reviewed,
      },
    });

    logger.info({ mappingId, reviewed: dto.reviewed }, 'QuestionSkillMapping reviewed');

    return this.toPublic(updated);
  }

  // ---------------------------------------------------- integrity primitives

  /**
   * Validate MicroSkill existence AND that its full curriculum chain resolves:
   *   MicroSkill -> ProcessComponent -> LearningOutcome -> Theme -> CurriculumVersion
   *
   * The chain is never repaired and no missing entity is ever created.
   */
  private async resolveAndValidateMicroSkill(tx: any, microSkillId: string): Promise<any> {
    let microSkill: any;
    try {
      microSkill = await tx.microSkill.findUnique({
        where: { id: microSkillId },
        include: {
          processComponent: {
            include: {
              learningOutcome: {
                include: { theme: true },
              },
            },
          },
        },
      });
    } catch (error) {
      // A dangling soft reference (e.g. processComponentId pointing at a row
      // that no longer exists) makes the nested include fail at the ORM level
      // (an inconsistent-query error). Translate ANY Prisma error here into a
      // domain error so raw Prisma messages never escape to an API client.
      const isPrismaError =
        error instanceof Prisma.PrismaClientKnownRequestError ||
        error instanceof Prisma.PrismaClientUnknownRequestError ||
        error instanceof Prisma.PrismaClientValidationError ||
        (error instanceof Error && error.constructor.name.startsWith('PrismaClient'));

      if (isPrismaError) {
        throw new MicroSkillCurriculumInvalidError(
          microSkillId,
          'referenced curriculum row is missing'
        );
      }
      throw error;
    }

    if (!microSkill) {
      throw new MappingMicroSkillNotFoundError(microSkillId);
    }

    const pc = microSkill.processComponent;
    if (!pc) {
      throw new MicroSkillCurriculumInvalidError(microSkillId, 'missing ProcessComponent');
    }

    const lo = pc.learningOutcome;
    if (!lo) {
      throw new MicroSkillCurriculumInvalidError(microSkillId, 'missing LearningOutcome');
    }

    const theme = lo.theme;
    if (!theme) {
      throw new MicroSkillCurriculumInvalidError(microSkillId, 'missing Theme');
    }

    const version = await tx.curriculumVersion.findUnique({ where: { id: theme.curriculumVersionId } });
    if (!version) {
      throw new MicroSkillCurriculumInvalidError(microSkillId, 'missing CurriculumVersion');
    }

    return microSkill;
  }

  /** I13: assert the question has no existing PRIMARY mapping. */
  private async assertNoExistingPrimary(tx: any, questionId: string): Promise<void> {
    const existingPrimary = await tx.questionSkillMapping.findFirst({
      where: { questionId, isPrimary: true },
    });
    if (existingPrimary) {
      throw new PrimarySkillMappingExistsError();
    }
  }

  // ----------------------------------------------------------------- guards

  private assertMayMutate(actorRole: string): void {
    if (!isMappingStaffRole(actorRole)) {
      throw new MappingAuthorizationError();
    }
  }

  private assertValidRelevance(value: unknown): void {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new InvalidRelevanceError('relevance must be a finite number');
    }
    if (value < RELEVANCE_MIN || value > RELEVANCE_MAX) {
      throw new InvalidRelevanceError(
        `relevance must be between ${RELEVANCE_MIN} and ${RELEVANCE_MAX}`
      );
    }
  }

  private assertValidAiConfidence(value: unknown): void {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new InvalidAiConfidenceError('aiConfidence must be a finite number');
    }
    if (value < AI_CONFIDENCE_MIN || value > AI_CONFIDENCE_MAX) {
      throw new InvalidAiConfidenceError(
        `aiConfidence must be between ${AI_CONFIDENCE_MIN} and ${AI_CONFIDENCE_MAX}`
      );
    }
  }

  // ------------------------------------------------------------ projection

  /**
   * The schema has NO reviewedByUserId on QuestionSkillMapping, so none is
   * exposed. Question.content is never included.
   */
  private toPublic(mapping: any): any {
    return {
      id: mapping.id,
      questionId: mapping.questionId,
      microSkillId: mapping.microSkillId,
      isPrimary: mapping.isPrimary,
      primaryType: mapping.isPrimary ? 'PRIMARY' : 'SECONDARY',
      relevance: mapping.relevance,
      aiConfidence: mapping.aiConfidence ?? null,
      mappingSource: mapping.mappingSource,
      reviewed: mapping.reviewed,
      createdAt: mapping.createdAt,
      updatedAt: mapping.updatedAt,
    };
  }
}
