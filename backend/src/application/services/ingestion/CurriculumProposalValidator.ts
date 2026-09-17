import { QuestionUnderstandingProposal } from '../../../domain/ingestion/questionUnderstandingProposal.js';
import {
  UnknownCurriculumTargetError,
  CurriculumChainIntegrityError,
} from '../../../domain/errors/QuestionAnalysisErrors.js';

/**
 * CurriculumProposalValidator — Phase 5E
 *
 * Validates that AI-proposed curriculum candidates reference real,
 * existing curriculum entities with valid chain integrity.
 * 
 * This validator does NOT create any entities. It only validates.
 */
export class CurriculumProposalValidator {
  constructor(private readonly prisma: any) {}

  /**
   * Validate all curriculum candidates in a proposal.
   * 
   * For each candidate:
   * - Verify the target exists in the database
   * - Verify the full curriculum chain (LO → Theme → CurriculumVersion)
   * - Verify parent consistency (PC → LO)
   * 
   * Rejects the entire proposal if ANY candidate is invalid.
   */
  async validateProposal(proposal: QuestionUnderstandingProposal): Promise<void> {
    for (const candidate of proposal.curriculumCandidates) {
      await this.validateCandidate(candidate);
    }
  }

  /**
   * Validate a single curriculum candidate.
   */
  private async validateCandidate(
    candidate: { level: string; targetId: string }
  ): Promise<void> {
    if (candidate.level === 'LEARNING_OUTCOME') {
      await this.validateLearningOutcome(candidate.targetId);
    } else if (candidate.level === 'PROCESS_COMPONENT') {
      await this.validateProcessComponent(candidate.targetId);
    } else {
      throw new UnknownCurriculumTargetError(candidate.level, candidate.targetId);
    }
  }

  /**
   * Validate a LearningOutcome exists and has a valid chain.
   */
  private async validateLearningOutcome(targetId: string): Promise<void> {
    const lo = await this.prisma.learningOutcome.findUnique({
      where: { id: targetId },
      include: { theme: true },
    });

    if (!lo) {
      throw new UnknownCurriculumTargetError('LEARNING_OUTCOME', targetId);
    }

    // Validate chain: LO → Theme → CurriculumVersion
    if (!lo.theme) {
      throw new CurriculumChainIntegrityError(targetId, 'LearningOutcome has no Theme');
    }

    const version = await this.prisma.curriculumVersion.findUnique({
      where: { id: lo.theme.curriculumVersionId },
    });

    if (!version) {
      throw new CurriculumChainIntegrityError(targetId, 'Theme has no CurriculumVersion');
    }
  }

  /**
   * Validate a ProcessComponent exists and has a valid chain.
   */
  private async validateProcessComponent(targetId: string): Promise<void> {
    const pc = await this.prisma.processComponent.findUnique({
      where: { id: targetId },
      include: {
        learningOutcome: {
          include: { theme: true },
        },
      },
    });

    if (!pc) {
      throw new UnknownCurriculumTargetError('PROCESS_COMPONENT', targetId);
    }

    // Validate chain: PC → LO → Theme → CurriculumVersion
    if (!pc.learningOutcome) {
      throw new CurriculumChainIntegrityError(targetId, 'ProcessComponent has no LearningOutcome');
    }

    if (!pc.learningOutcome.theme) {
      throw new CurriculumChainIntegrityError(targetId, 'LearningOutcome has no Theme');
    }

    const version = await this.prisma.curriculumVersion.findUnique({
      where: { id: pc.learningOutcome.theme.curriculumVersionId },
    });

    if (!version) {
      throw new CurriculumChainIntegrityError(targetId, 'Theme has no CurriculumVersion');
    }
  }
}
