import { PrismaClient } from '@prisma/client';
import { INGESTION_STATES } from '../../../domain/ingestion/ingestionStateMachine.js';
import { IngestionAuthorizationError } from '../../../domain/errors/IngestionErrors.js';
import { isStaffRole } from './QuestionIngestionService.js';

/**
 * ReviewQueueService — Phase 5F.8 (D) / D1
 *
 * A READ-ONLY projection of the existing review gate. It does NOT create a
 * second review engine and does NOT decide anything: it assembles, for an
 * authorised reviewer, exactly the context the existing review actions need.
 *
 * The reviewer then acts through the ALREADY-EXISTING services/routes:
 *   - ingestion approve/reject  → POST /question-ingestions/:id/transition
 *   - curriculum candidate      → POST /curriculum-candidates/:id/review
 *   - skill mapping             → POST /question-skill-mappings/:id/review
 *
 * No student private data beyond identifiers and the (already-shared) normalized
 * question text is returned; asset references and raw OCR text are withheld,
 * matching the ingestion projection.
 */
export interface ReviewQueueItem {
  ingestionId: string;
  state: string;
  requiresReview: boolean;
  ingestMethod: string;
  normalizedText: string | null;
  ocrConfidence: number | null;
  parsingConfidence: number | null;
  extractionFailed: boolean;
  sourceId: string | null;
  origin: string | null;
  trustCeiling: string | null;
  resultingQuestionId: string | null;
  question: {
    id: string;
    content: string;
    origin: string | null;
    trust: string;
    isActive: boolean;
  } | null;
  curriculumCandidates: Array<{
    id: string;
    level: string;
    targetId: string;
    decision: string;
    confidence: number;
    reviewed: boolean;
  }>;
  microSkillMappings: Array<{
    id: string;
    microSkillId: string;
    isPrimary: boolean;
    relevance: number;
    reviewed: boolean;
    mappingSource: string;
  }>;
  createdAt: Date;
}

export class ReviewQueueService {
  constructor(private readonly prisma: PrismaClient) { }

  /**
   * List ingestions requiring human review, newest first.
   * Staff-only; reuses the shared isStaffRole rule (no new role is invented).
   */
  async listQueue(actorRole: string, limit = 50): Promise<ReviewQueueItem[]> {
    if (!isStaffRole(actorRole)) {
      throw new IngestionAuthorizationError('Review queue requires a staff role');
    }

    const ingestions = await this.prisma.questionIngestion.findMany({
      where: {
        requiresReview: true,
        state: { notIn: [INGESTION_STATES.APPROVED, INGESTION_STATES.REJECTED] },
      },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 200),
      include: { source: true },
    });

    const items: ReviewQueueItem[] = [];
    for (const ingestion of ingestions) {
      let question: ReviewQueueItem['question'] = null;
      let curriculumCandidates: ReviewQueueItem['curriculumCandidates'] = [];
      let microSkillMappings: ReviewQueueItem['microSkillMappings'] = [];

      if (ingestion.resultingQuestionId) {
        const q = await this.prisma.question.findUnique({
          where: { id: ingestion.resultingQuestionId },
          include: {
            curriculumCandidates: true,
            skillMappings: true,
          },
        });
        if (q) {
          question = {
            id: q.id,
            content: q.content,
            origin: q.origin ?? null,
            trust: q.trust,
            isActive: q.isActive,
          };
          curriculumCandidates = q.curriculumCandidates.map((c) => ({
            id: c.id,
            level: c.level,
            targetId: c.targetId,
            decision: c.decision,
            confidence: c.confidence,
            reviewed: c.reviewed,
          }));
          microSkillMappings = q.skillMappings.map((m) => ({
            id: m.id,
            microSkillId: m.microSkillId,
            isPrimary: m.isPrimary,
            relevance: m.relevance,
            reviewed: m.reviewed,
            mappingSource: m.mappingSource,
          }));
        }
      }

      items.push({
        ingestionId: ingestion.id,
        state: ingestion.state,
        requiresReview: ingestion.requiresReview,
        ingestMethod: ingestion.ingestMethod,
        normalizedText: ingestion.normalizedText ?? null,
        ocrConfidence: ingestion.ocrConfidence ?? null,
        parsingConfidence: ingestion.parsingConfidence ?? null,
        extractionFailed: ingestion.extractionFailed,
        sourceId: ingestion.sourceId ?? null,
        origin: ingestion.source?.origin ?? null,
        trustCeiling: ingestion.source?.trustCeiling ?? null,
        resultingQuestionId: ingestion.resultingQuestionId ?? null,
        question,
        curriculumCandidates,
        microSkillMappings,
        createdAt: ingestion.createdAt,
      });
    }

    return items;
  }
}
