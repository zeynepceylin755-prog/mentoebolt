import { PrismaClient } from '@prisma/client';
import { logger } from '../../../infrastructure/logging/logger.js';
import { IdempotencyService } from '../../../infrastructure/idempotency/IdempotencyService.js';
import { IOcrProvider } from '../../../domain/interfaces/ocr/IOcrProvider.js';
import { IQuestionUnderstandingProvider } from '../../../domain/interfaces/ai/IQuestionUnderstandingProvider.js';
import { QuestionNormalizationService } from './QuestionNormalizationService.js';
import { ProposalValidator } from './ProposalValidator.js';
import { CurriculumProposalValidator } from './CurriculumProposalValidator.js';
import { MicroSkillProposalValidator } from './MicroSkillProposalValidator.js';
import { CurriculumCandidateService } from '../curriculum/CurriculumCandidateService.js';
import { QuestionSkillMappingService } from '../skills/QuestionSkillMappingService.js';
import { QuestionIngestionService, isStaffRole } from './QuestionIngestionService.js';
import { QuestionCurriculumMappingService } from './QuestionCurriculumMappingService.js';
import type { QuestionUnderstandingProposal } from '../../../domain/ingestion/questionUnderstandingProposal.js';
import { writeAudit, INGESTION_AUDIT_ACTIONS } from './ingestionAudit.js';
import {
  INGESTION_STATES,
  canTransition,
} from '../../../domain/ingestion/ingestionStateMachine.js';
import {
  OcrProviderError,
  NormalizationError,
  AiAnalysisError,
  ProposalValidationError,
} from '../../../domain/errors/QuestionAnalysisErrors.js';
import { requiresReview } from '../../../domain/ingestion/confidencePolicy.js';
import { NotFoundError } from '../../../domain/errors/NotFoundError.js';
import { ValidationError } from '../../../domain/errors/ValidationError.js';

/**
 * Prisma interactive-transaction timeout for the analysis transaction.
 *
 * Unlike the Prisma default (5s), this transaction performs EXTERNAL provider
 * calls (OCR and/or the question-understanding AI), which routinely take longer
 * than 5 seconds on a real network round trip. The value is derived from the
 * configured provider timeout so a single knob bounds both, with a floor equal
 * to the previous default behaviour.
 */
const ANALYSIS_TRANSACTION_TIMEOUT_MS = Math.max(
  30000,
  Number(process.env.QUESTION_UNDERSTANDING_TIMEOUT_MS) || 0,
  Number(process.env.OCR_TIMEOUT_MS) || 0
);

export const ANALYSIS_AUDIT_ACTIONS = {
  QUESTION_AI_ANALYZED: 'QUESTION_AI_ANALYZED',
  QUESTION_AI_REVIEW_REQUIRED: 'QUESTION_AI_REVIEW_REQUIRED',
  QUESTION_AI_REJECTED: 'QUESTION_AI_REJECTED',
  QUESTION_OCR_COMPLETED: 'QUESTION_OCR_COMPLETED',
  QUESTION_NORMALIZATION_COMPLETED: 'QUESTION_NORMALIZATION_COMPLETED',
} as const;

export interface AnalyzeIngestionDTO {
  /** Optional: provide OCR result if already extracted */
  ocrText?: string;
  ocrConfidence?: number;
  /** Optional: provide normalized text if already normalized */
  normalizedText?: string;
  /** Skip OCR step if text is already provided */
  skipOcr?: boolean;
}

export interface AnalysisResult {
  ingestionId: string;
  state: string;
  requiresReview: boolean;
  proposal?: any;
  warnings: string[];
  curriculumCandidatesCreated: number;
  microSkillCandidatesCreated: number;
}

/**
 * Internal shape returned by the analysis transaction. It carries the validated
 * proposal and the resolved canonical Question id so the candidate/mapping
 * artefacts can be applied AFTER the transaction commits (Phase 5F.2).
 */
interface InternalAnalysisResult extends AnalysisResult {
  /** Validated proposal to persist via QuestionCurriculumMappingService. */
  proposal?: QuestionUnderstandingProposal;
  /** The ingestion's canonical Question, when one already exists. */
  resultingQuestionId: string | null;
}

/**
 * QuestionAnalysisService — Phase 5E
 *
 * Orchestrates the full AI analysis pipeline:
 * OCR → Normalization → AI Understanding → Validation → Proposal Creation
 *
 * Key invariants:
 * - AI NEVER writes directly to QuestionSkillMapping
 * - AI NEVER modifies Question.origin or Question.trust
 * - AI ONLY creates proposals via existing services
 * - All proposals require validation and review
 * - Idempotency is enforced
 * - Audit trail is maintained
 */
export class QuestionAnalysisService {
  private readonly curriculumMappingService?: QuestionCurriculumMappingService;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly idempotencyService?: IdempotencyService,
    private readonly ocrProvider?: IOcrProvider,
    private readonly aiProvider?: IQuestionUnderstandingProvider,
    private readonly normalizationService?: QuestionNormalizationService,
    private readonly curriculumCandidateService?: CurriculumCandidateService,
    private readonly skillMappingService?: QuestionSkillMappingService,
    private readonly ingestionService?: QuestionIngestionService,
    curriculumMappingService?: QuestionCurriculumMappingService
  ) {
    // Phase 5F.2: candidate/mapping persistence is now owned by the dedicated
    // orchestration service, which runs OUTSIDE the analysis transaction. When
    // no orchestrator is injected we build one from the supplied child services
    // so the boundary is never bypassed.
    this.curriculumMappingService =
      curriculumMappingService ??
      (curriculumCandidateService || skillMappingService
        ? new QuestionCurriculumMappingService(
            prisma,
            curriculumCandidateService,
            skillMappingService
          )
        : undefined);
  }

  /**
   * Analyze a question ingestion through the full pipeline.
   * 
   * Pipeline:
   * 1. OCR (if needed)
   * 2. Normalization
   * 3. AI Understanding
   * 4. Validation
   * 5. Proposal Creation (via existing services)
   * 6. State transition to ANALYZED or REVIEW_REQUIRED
   */
  async analyzeIngestion(
    ingestionId: string,
    actorUserId: string,
    actorRole: string,
    dto: AnalyzeIngestionDTO = {},
    idempotencyKey?: string
  ): Promise<AnalysisResult> {
    // The idempotency boundary wraps ONLY the analysis transaction. Child
    // services (candidate/mapping writers) own their own transactions and are
    // applied AFTER this one has committed (Phase 5F.2 transaction boundary).
    const run = async (tx: any): Promise<InternalAnalysisResult> =>
      this.performAnalysis(tx, ingestionId, actorUserId, actorRole, dto);

    // The analysis transaction contains an EXTERNAL provider call (OCR and/or
    // the question-understanding AI), so the Prisma default 5s interactive
    // timeout is too short for a real network round trip. The bound is derived
    // from the configured provider timeout and never shortens the default.
    const internal: InternalAnalysisResult = this.idempotencyService && idempotencyKey
      ? await this.idempotencyService.execute(
          actorUserId,
          'ANALYZE_QUESTION_INGESTION',
          idempotencyKey,
          { ingestionId, skipOcr: dto.skipOcr },
          run
        )
      : await this.prisma.$transaction(run, { timeout: ANALYSIS_TRANSACTION_TIMEOUT_MS });

    return this.applyProposalAfterAnalysis(internal, actorUserId, actorRole, idempotencyKey);
  }

  /**
   * Phase 5F.2: persist candidate/mapping artefacts for an analysed proposal
   * AFTER the analysis transaction has committed. Each child service opens its
   * own transaction, so there is no nested interactive transaction.
   */
  private async applyProposalAfterAnalysis(
    internal: InternalAnalysisResult,
    actorUserId: string,
    actorRole: string,
    idempotencyKey?: string
  ): Promise<AnalysisResult> {
    const { proposal, resultingQuestionId, ...base } = internal;

    // Public projection: the raw proposal is sanitized; `resultingQuestionId`
    // is an internal coordination field and is never exposed.
    const publicResult: AnalysisResult = {
      ...base,
      proposal: proposal ? this.sanitizeProposal(proposal) : undefined,
    };

    // Only staff may produce curriculum/mapping artefacts, and only when a real
    // canonical Question id is available on the ingestion.
    if (
      !proposal ||
      !this.curriculumMappingService ||
      !isStaffRole(actorRole) ||
      !resultingQuestionId
    ) {
      return publicResult;
    }

    const applied = await this.curriculumMappingService.applyProposal({
      actorUserId,
      actorRole,
      questionId: resultingQuestionId,
      proposal,
      idempotencyKey,
    });

    return {
      ...publicResult,
      curriculumCandidatesCreated: applied.curriculumCandidatesCreated,
      microSkillCandidatesCreated: applied.microSkillMappingsCreated,
    };
  }

  private async performAnalysis(
    tx: any,
    ingestionId: string,
    actorUserId: string,
    actorRole: string,
    dto: AnalyzeIngestionDTO
  ): Promise<InternalAnalysisResult> {
    // Load ingestion
    const ingestion = await tx.questionIngestion.findUnique({
      where: { id: ingestionId },
      include: { source: true },
    });

    if (!ingestion) {
      throw new NotFoundError('QuestionIngestion', ingestionId);
    }

    // Authorization: student can analyze their own, staff can analyze any
    if (!isStaffRole(actorRole) && ingestion.ingestedByUserId !== actorUserId) {
      throw new ValidationError('Not authorized to analyze this ingestion');
    }

    // State validation: must be in a state that allows analysis
    const validStates = [INGESTION_STATES.INGESTED, INGESTION_STATES.EXTRACTED, INGESTION_STATES.NORMALIZED];
    if (!validStates.includes(ingestion.state as any)) {
      throw new ValidationError(`Cannot analyze ingestion in state ${ingestion.state}`);
    }

    const warnings: string[] = [];
    let ocrText = dto.ocrText;
    let ocrConfidence = dto.ocrConfidence;
    let normalizedText = dto.normalizedText;

    // Step 1: OCR (if needed and available)
    if (!dto.skipOcr && !ocrText && this.ocrProvider && ingestion.originalAssetRef) {
      try {
        const ocrResult = await this.ocrProvider.extract({
          assetRef: ingestion.originalAssetRef,
          mimeType: ingestion.originalAssetMimeType || undefined,
        });
        ocrText = ocrResult.text;
        ocrConfidence = ocrResult.confidence;
        warnings.push(...(ocrResult.warnings || []));

        await writeAudit(tx, {
          userId: actorUserId,
          action: ANALYSIS_AUDIT_ACTIONS.QUESTION_OCR_COMPLETED,
          entityType: 'QuestionIngestion',
          entityId: ingestionId,
          details: { confidence: ocrConfidence, warningsCount: ocrResult.warnings?.length },
        });
      } catch (error) {
        throw new OcrProviderError(`OCR extraction failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    // Step 2: Normalization
    if (!normalizedText && ocrText && this.normalizationService) {
      try {
        const normalizationResult = await this.normalizationService.normalize(ocrText, warnings);
        normalizedText = normalizationResult.normalizedText;
        warnings.push(...normalizationResult.warnings);

        await writeAudit(tx, {
          userId: actorUserId,
          action: ANALYSIS_AUDIT_ACTIONS.QUESTION_NORMALIZATION_COMPLETED,
          entityType: 'QuestionIngestion',
          entityId: ingestionId,
          details: {
            parsingConfidence: normalizationResult.parsingConfidence,
            warningsCount: normalizationResult.warnings.length,
          },
        });
      } catch (error) {
        throw new NormalizationError(`Normalization failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    // If we still don't have normalized text, we can't proceed
    if (!normalizedText) {
      throw new ValidationError('No text available for analysis (OCR failed or not provided)');
    }

    // Step 3: Update ingestion with extraction results
    await tx.questionIngestion.update({
      where: { id: ingestionId },
      data: {
        rawExtractedText: ocrText || null,
        ocrConfidence: ocrConfidence || null,
        normalizedText,
        state: INGESTION_STATES.NORMALIZED,
      },
    });

    // Step 4: AI Understanding
    let aiProposal;
    if (this.aiProvider) {
      try {
        // Load curriculum context for the AI
        const curriculumContext = await this.loadCurriculumContext(tx);

        const aiResponse = await this.aiProvider.analyze({
          ingestionId,
          normalizedText,
          curriculumContext,
        });

        aiProposal = aiResponse.proposal;
        warnings.push(...aiResponse.warnings);

        // Step 5: Validate proposal structure
        const proposalValidator = new ProposalValidator();
        const validatedProposal = proposalValidator.validateProposal(aiProposal);
        proposalValidator.validateCurriculumCandidateLevels(validatedProposal);
        proposalValidator.validateNormalizedText(validatedProposal);

        // Step 6: Validate curriculum candidates
        const curriculumValidator = new CurriculumProposalValidator(tx);
        await curriculumValidator.validateProposal(validatedProposal);

        // Step 7: Validate microskill candidates
        const microSkillValidator = new MicroSkillProposalValidator(tx);
        await microSkillValidator.validateProposal(validatedProposal);

        // Step 8: Candidate/mapping artefacts are NOT written inside this
        // transaction (Phase 5F.2). They are applied after commit by
        // QuestionCurriculumMappingService, which composes the existing child
        // services — each of which owns its own transaction. A canonical Question
        // id is required; 'pending' is never used as a substitute.

        // Step 9: Determine final state based on confidence and warnings
        const overallConfidence = validatedProposal.confidence;
        const needsReview = requiresReview(overallConfidence) || warnings.length > 0;
        const nextState = needsReview ? INGESTION_STATES.REVIEW_REQUIRED : INGESTION_STATES.ANALYZED;

        // Step 10: Update ingestion state
        await tx.questionIngestion.update({
          where: { id: ingestionId },
          data: {
            state: nextState,
            requiresReview: needsReview,
          },
        });

        // Step 11: Audit
        await writeAudit(tx, {
          userId: actorUserId,
          action: needsReview
            ? ANALYSIS_AUDIT_ACTIONS.QUESTION_AI_REVIEW_REQUIRED
            : ANALYSIS_AUDIT_ACTIONS.QUESTION_AI_ANALYZED,
          entityType: 'QuestionIngestion',
          entityId: ingestionId,
          details: {
            confidence: overallConfidence,
            warningsCount: warnings.length,
            model: validatedProposal.modelMetadata.model,
          },
        });

        logger.info({
          ingestionId,
          state: nextState,
          confidence: overallConfidence,
          warningsCount: warnings.length,
        }, 'Question analysis completed');

        return {
          ingestionId,
          state: nextState,
          requiresReview: needsReview,
          proposal: validatedProposal,
          warnings,
          resultingQuestionId: ingestion.resultingQuestionId ?? null,
          curriculumCandidatesCreated: 0,
          microSkillCandidatesCreated: 0,
        };
      } catch (error) {
        throw new AiAnalysisError(`AI analysis failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    // No AI provider: just normalize and transition
    await tx.questionIngestion.update({
      where: { id: ingestionId },
      data: {
        state: INGESTION_STATES.NORMALIZED,
        requiresReview: true,
      },
    });

    return {
      ingestionId,
      state: INGESTION_STATES.NORMALIZED,
      requiresReview: true,
      warnings,
      resultingQuestionId: ingestion.resultingQuestionId ?? null,
      curriculumCandidatesCreated: 0,
      microSkillCandidatesCreated: 0,
    };
  }

  /**
   * Load curriculum context for AI provider.
   * Returns canonical curriculum entities from the database.
   */
  private async loadCurriculumContext(tx: any): Promise<any> {
    // The curriculum columns are named `officialCode` / `officialText` in the
    // schema, while the provider contract (IQuestionUnderstandingProvider) uses
    // the neutral `code` / `text` shape. Map explicitly here so the DB column
    // names never leak into the provider contract.
    const learningOutcomeRows = await tx.learningOutcome.findMany({
      select: { id: true, officialCode: true, officialText: true },
      take: 100, // Limit to avoid overwhelming the AI
    });

    const processComponentRows = await tx.processComponent.findMany({
      select: { id: true, officialCode: true, officialText: true, learningOutcomeId: true },
      take: 200,
    });

    const microSkills = await tx.microSkill.findMany({
      select: { id: true, code: true, name: true, description: true, processComponentId: true },
      where: { isActive: true },
      take: 300,
    });

    const learningOutcomes = learningOutcomeRows.map((lo: any) => ({
      id: lo.id,
      code: lo.officialCode,
      text: lo.officialText,
    }));

    const processComponents = processComponentRows.map((pc: any) => ({
      id: pc.id,
      code: pc.officialCode,
      text: pc.officialText,
      learningOutcomeId: pc.learningOutcomeId,
    }));

    return {
      learningOutcomes,
      processComponents,
      microSkills,
    };
  }

  /**
   * Sanitize proposal for API response.
   * Remove sensitive details but keep structure.
   */
  private sanitizeProposal(proposal: any): any {
    return {
      ingestionId: proposal.ingestionId,
      questionUnderstanding: proposal.questionUnderstanding,
      confidence: proposal.confidence,
      warnings: proposal.warnings,
      modelMetadata: proposal.modelMetadata,
      curriculumCandidates: proposal.curriculumCandidates.map((c: any) => ({
        level: c.level,
        confidence: c.confidence,
        rationale: c.rationale,
      })),
      microSkillCandidates: proposal.microSkillCandidates.map((c: any) => ({
        confidence: c.confidence,
        rationale: c.rationale,
      })),
    };
  }
}
