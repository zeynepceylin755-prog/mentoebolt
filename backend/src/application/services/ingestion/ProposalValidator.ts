import { QuestionUnderstandingProposal, isValidProposalStructure } from '../../../domain/ingestion/questionUnderstandingProposal.js';
import { isValidConfidence } from '../../../domain/ingestion/confidencePolicy.js';
import {
  InvalidProposalStructureError,
  InvalidConfidenceError,
} from '../../../domain/errors/QuestionAnalysisErrors.js';

/**
 * ProposalValidator — Phase 5E
 *
 * Validates AI-generated proposals before they are processed.
 * Ensures structure, confidence, and basic integrity.
 */
export class ProposalValidator {
  /**
   * Validate a proposal's structure and basic constraints.
   * 
   * Checks:
   * - Required fields exist
   * - Confidence is valid (0-1, finite)
   * - Arrays are properly typed
   * - No null/undefined in critical fields
   */
  validateProposal(proposal: unknown): QuestionUnderstandingProposal {
    // Structural validation
    if (!isValidProposalStructure(proposal)) {
      throw new InvalidProposalStructureError('Proposal does not match required structure');
    }

    const p = proposal as QuestionUnderstandingProposal;

    // Confidence validation
    if (!isValidConfidence(p.confidence)) {
      throw new InvalidConfidenceError(`Invalid confidence: ${p.confidence}`);
    }

    // Validate individual candidate confidences
    for (const candidate of p.curriculumCandidates) {
      if (!isValidConfidence(candidate.confidence)) {
        throw new InvalidConfidenceError(`Invalid curriculum candidate confidence: ${candidate.confidence}`);
      }
    }

    for (const candidate of p.microSkillCandidates) {
      if (!isValidConfidence(candidate.confidence)) {
        throw new InvalidConfidenceError(`Invalid microskill candidate confidence: ${candidate.confidence}`);
      }
    }

    // Validate question understanding structure
    if (!p.questionUnderstanding.questionType || typeof p.questionUnderstanding.questionType !== 'string') {
      throw new InvalidProposalStructureError('questionUnderstanding.questionType is required');
    }

    if (!Array.isArray(p.questionUnderstanding.mathematicalObjects)) {
      throw new InvalidProposalStructureError('questionUnderstanding.mathematicalObjects must be an array');
    }

    // Validate model metadata
    if (!p.modelMetadata.provider || typeof p.modelMetadata.provider !== 'string') {
      throw new InvalidProposalStructureError('modelMetadata.provider is required');
    }

    if (!p.modelMetadata.model || typeof p.modelMetadata.model !== 'string') {
      throw new InvalidProposalStructureError('modelMetadata.model is required');
    }

    return p;
  }

  /**
   * Validate that all curriculum candidates use valid levels.
   */
  validateCurriculumCandidateLevels(proposal: QuestionUnderstandingProposal): void {
    const validLevels = ['LEARNING_OUTCOME', 'PROCESS_COMPONENT'];

    for (const candidate of proposal.curriculumCandidates) {
      if (!validLevels.includes(candidate.level)) {
        throw new InvalidProposalStructureError(
          `Invalid curriculum candidate level: ${candidate.level}`
        );
      }
    }
  }

  /**
   * Validate that normalized text is not empty or placeholder.
   */
  validateNormalizedText(proposal: QuestionUnderstandingProposal): void {
    if (!proposal.normalizedText || proposal.normalizedText.trim().length === 0) {
      throw new InvalidProposalStructureError('normalizedText cannot be empty');
    }

    // Check for common placeholders
    const placeholders = ['placeholder', 'lorem ipsum', 'test question', 'sample text'];
    const lowerText = proposal.normalizedText.toLowerCase();
    for (const placeholder of placeholders) {
      if (lowerText.includes(placeholder)) {
        throw new InvalidProposalStructureError('normalizedText appears to be placeholder text');
      }
    }
  }
}
