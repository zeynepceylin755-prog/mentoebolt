import { QuestionUnderstandingProposal } from '../../../domain/ingestion/questionUnderstandingProposal.js';
import {
  UnknownMicroSkillError,
  CurriculumChainIntegrityError,
} from '../../../domain/errors/QuestionAnalysisErrors.js';

/**
 * MicroSkillProposalValidator — Phase 5E
 *
 * Validates that AI-proposed MicroSkill candidates reference real,
 * existing MicroSkills with valid curriculum chain integrity.
 * 
 * This validator:
 * - Does NOT create new MicroSkills
 * - Does NOT auto-create missing entities
 * - Rejects proposals with unknown MicroSkills
 */
export class MicroSkillProposalValidator {
  constructor(private readonly prisma: any) {}

  /**
   * Validate all MicroSkill candidates in a proposal.
   * 
   * For each candidate:
   * - Verify the MicroSkill exists
   * - Verify the full chain: MicroSkill → ProcessComponent → LearningOutcome → Theme → CurriculumVersion
   * 
   * Rejects the entire proposal if ANY candidate is invalid.
   */
  async validateProposal(proposal: QuestionUnderstandingProposal): Promise<void> {
    for (const candidate of proposal.microSkillCandidates) {
      await this.validateMicroSkill(candidate.microSkillId);
    }
  }

  /**
   * Validate a single MicroSkill exists and has a valid chain.
   */
  private async validateMicroSkill(microSkillId: string): Promise<void> {
    const microSkill = await this.prisma.microSkill.findUnique({
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

    if (!microSkill) {
      throw new UnknownMicroSkillError(microSkillId);
    }

    // Validate chain: MicroSkill → ProcessComponent → LearningOutcome → Theme → CurriculumVersion
    if (!microSkill.processComponent) {
      throw new CurriculumChainIntegrityError(microSkillId, 'MicroSkill has no ProcessComponent');
    }

    if (!microSkill.processComponent.learningOutcome) {
      throw new CurriculumChainIntegrityError(microSkillId, 'ProcessComponent has no LearningOutcome');
    }

    if (!microSkill.processComponent.learningOutcome.theme) {
      throw new CurriculumChainIntegrityError(microSkillId, 'LearningOutcome has no Theme');
    }

    const version = await this.prisma.curriculumVersion.findUnique({
      where: { id: microSkill.processComponent.learningOutcome.theme.curriculumVersionId },
    });

    if (!version) {
      throw new CurriculumChainIntegrityError(microSkillId, 'Theme has no CurriculumVersion');
    }
  }
}
