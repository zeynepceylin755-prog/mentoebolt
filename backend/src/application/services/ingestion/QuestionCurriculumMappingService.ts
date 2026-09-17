import { PrismaClient } from '@prisma/client';
import { logger } from '../../../infrastructure/logging/logger.js';
import { CurriculumCandidateService } from '../curriculum/CurriculumCandidateService.js';
import { QuestionSkillMappingService } from '../skills/QuestionSkillMappingService.js';
import { isStaffRole } from './QuestionIngestionService.js';
import { ConflictError } from '../../../domain/errors/ConflictError.js';
import type { QuestionUnderstandingProposal } from '../../../domain/ingestion/questionUnderstandingProposal.js';

/**
 * QuestionCurriculumMappingService — Phase 5F.2
 *
 * A THIN orchestration boundary between the AI analysis pipeline (Phase 5E) and
 * the curriculum/mapping writers (Phase 5C / Phase 5D).
 *
 * Responsibilities (coordination only):
 *   - resolve the REAL canonical Question id for an ingestion (never a placeholder)
 *   - hand validated AI candidates to CurriculumCandidateService
 *   - hand validated AI microskill candidates to QuestionSkillMappingService
 *   - coordinate per-operation idempotency keys
 *   - return a unified count result
 *
 * It deliberately does NOT:
 *   - implement curriculum/MicroSkill/I13/trust/authorization validation
 *     (those stay owned by the child services)
 *   - write QuestionSkillMapping / CurriculumCandidate via Prisma directly
 *   - mutate Question provenance (origin/trust/sourceId)
 *   - invent a Question id (no 'pending' / 'unknown' / 'temp')
 *   - infer student ErrorPatterns
 *
 * TRANSACTION BOUNDARY: this service runs OUTSIDE the analysis transaction. Each
 * child service opens its own transaction. Candidate creation and mapping
 * creation are SEPARATE business operations (a human review boundary sits
 * between them), so they are never wrapped in one transaction.
 */

export interface CurriculumProposalMappingInput {
  actorUserId: string;
  actorRole: string;
  /**
   * The canonical Question the proposal belongs to. MUST be a real id or null.
   * When null, no candidate/mapping is written (nothing is fabricated).
   */
  questionId: string | null;
  proposal: Pick<QuestionUnderstandingProposal, 'curriculumCandidates' | 'microSkillCandidates'>;
  /** Base idempotency key. Per-candidate keys are derived from it. */
  idempotencyKey?: string;
}

export interface CurriculumProposalMappingResult {
  questionId: string | null;
  /** True when a real canonical Question id was available to map against. */
  mapped: boolean;
  /** Machine-readable reason when `mapped` is false. */
  skippedReason?: 'NO_CANONICAL_QUESTION';
  curriculumCandidatesCreated: number;
  microSkillMappingsCreated: number;
}

export class QuestionCurriculumMappingService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly curriculumCandidateService?: CurriculumCandidateService,
    private readonly skillMappingService?: QuestionSkillMappingService
  ) {}

  /**
   * Persist the candidate/mapping artefacts for a validated AI proposal.
   *
   * Staff-only: candidate and mapping mutation are authorised by the child
   * services themselves; this method short-circuits for non-staff so no
   * authorisation rule is bypassed (the child services would reject anyway).
   */
  async applyProposal(input: CurriculumProposalMappingInput): Promise<CurriculumProposalMappingResult> {
    const { actorUserId, actorRole, proposal, idempotencyKey } = input;

    // Only staff may produce curriculum/mapping artefacts. The child services
    // enforce this too; we avoid even attempting it for students.
    if (!isStaffRole(actorRole)) {
      return {
        questionId: input.questionId,
        mapped: false,
        skippedReason: 'NO_CANONICAL_QUESTION',
        curriculumCandidatesCreated: 0,
        microSkillMappingsCreated: 0,
      };
    }

    // Resolve a REAL canonical Question id. Never substitute a placeholder.
    const questionId = await this.resolveCanonicalQuestionId(input.questionId);
    if (!questionId) {
      logger.info(
        { ingestionHint: input.questionId },
        'No canonical Question available; skipping curriculum/mapping artefacts'
      );
      return {
        questionId: null,
        mapped: false,
        skippedReason: 'NO_CANONICAL_QUESTION',
        curriculumCandidatesCreated: 0,
        microSkillMappingsCreated: 0,
      };
    }

    const curriculumCandidatesCreated = await this.createCandidates(
      actorUserId,
      actorRole,
      questionId,
      proposal.curriculumCandidates,
      idempotencyKey
    );

    const microSkillMappingsCreated = await this.createMappings(
      actorUserId,
      actorRole,
      questionId,
      proposal.microSkillCandidates,
      idempotencyKey
    );

    return {
      questionId,
      mapped: true,
      curriculumCandidatesCreated,
      microSkillMappingsCreated,
    };
  }

  /**
   * Confirm the supplied id names an existing canonical Question. Returns null
   * when it is missing (or when no id was supplied) — a missing id is NEVER
   * replaced with a fabricated value.
   */
  private async resolveCanonicalQuestionId(candidateId: string | null): Promise<string | null> {
    if (!candidateId || typeof candidateId !== 'string' || candidateId.trim().length === 0) {
      return null;
    }
    const question = await this.prisma.question.findUnique({
      where: { id: candidateId },
      select: { id: true },
    });
    return question ? question.id : null;
  }

  private async createCandidates(
    actorUserId: string,
    actorRole: string,
    questionId: string,
    candidates: QuestionUnderstandingProposal['curriculumCandidates'],
    baseKey?: string
  ): Promise<number> {
    if (!this.curriculumCandidateService) {
      return 0;
    }

    let created = 0;
    for (let i = 0; i < candidates.length; i++) {
      const candidate = candidates[i];
      try {
        await this.curriculumCandidateService.createCandidate(
          actorUserId,
          actorRole,
          {
            questionId,
            level: candidate.level,
            targetId: candidate.targetId,
            confidence: candidate.confidence,
            method: 'AI_MAPPED',
            rationale: candidate.rationale,
          },
          baseKey ? `${baseKey}:candidate:${i}` : undefined
        );
        created++;
      } catch (error) {
        // An idempotency ConflictError signals caller misuse (same key, different
        // payload) and must propagate. Other rejections (duplicate, invalid
        // curriculum chain, ...) are per-candidate and do not fail the proposal.
        if (error instanceof ConflictError) {
          throw error;
        }
        logger.warn({ error, candidate }, 'AI curriculum candidate rejected');
      }
    }
    return created;
  }

  private async createMappings(
    actorUserId: string,
    actorRole: string,
    questionId: string,
    candidates: QuestionUnderstandingProposal['microSkillCandidates'],
    baseKey?: string
  ): Promise<number> {
    if (!this.skillMappingService) {
      return 0;
    }

    let created = 0;
    for (let i = 0; i < candidates.length; i++) {
      const candidate = candidates[i];
      try {
        await this.skillMappingService.createMapping(
          actorUserId,
          actorRole,
          {
            questionId,
            microSkillId: candidate.microSkillId,
            relevance: candidate.confidence,
            aiConfidence: candidate.confidence,
            // AI-produced mappings are never primary and never human-reviewed.
            isPrimary: false,
            reviewed: false,
            mappingSource: 'AI_MAPPED',
          },
          baseKey ? `${baseKey}:mapping:${i}` : undefined
        );
        created++;
      } catch (error) {
        // See createCandidates: idempotency conflicts propagate; validation
        // rejections are per-candidate and tolerated.
        if (error instanceof ConflictError) {
          throw error;
        }
        logger.warn({ error, candidate }, 'AI microskill mapping rejected');
      }
    }
    return created;
  }
}
