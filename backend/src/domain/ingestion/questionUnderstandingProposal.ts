/**
 * QuestionUnderstandingProposal — Phase 5E
 *
 * AI-generated proposal for question understanding.
 * This is NOT a verified mapping — it's a candidate that must pass validation
 * and review before becoming canonical knowledge.
 */

export interface QuestionUnderstanding {
  questionType: string;
  mathematicalObjects: string[];
  requestedOperation?: string;
  constraints?: string[];
}

export interface CurriculumCandidateProposal {
  level: 'LEARNING_OUTCOME' | 'PROCESS_COMPONENT';
  targetId: string;
  confidence: number;
  rationale: string;
}

export interface MicroSkillCandidateProposal {
  microSkillId: string;
  confidence: number;
  rationale: string;
}

export interface QuestionUnderstandingProposal {
  ingestionId: string;
  extractedText?: string;
  normalizedText: string;
  questionUnderstanding: QuestionUnderstanding;
  curriculumCandidates: CurriculumCandidateProposal[];
  microSkillCandidates: MicroSkillCandidateProposal[];
  confidence: number;
  warnings: string[];
  modelMetadata: {
    provider: string;
    model: string;
    version: string;
    timestamp: string;
  };
}

/**
 * Validate that a proposal has the required structure.
 * This is a basic structural check, not a semantic validation.
 */
export function isValidProposalStructure(
  proposal: unknown
): proposal is QuestionUnderstandingProposal {
  if (typeof proposal !== 'object' || proposal === null) {
    return false;
  }

  const p = proposal as Record<string, unknown>;

  return (
    typeof p.ingestionId === 'string' &&
    typeof p.normalizedText === 'string' &&
    typeof p.confidence === 'number' &&
    Array.isArray(p.warnings) &&
    typeof p.questionUnderstanding === 'object' &&
    Array.isArray(p.curriculumCandidates) &&
    Array.isArray(p.microSkillCandidates) &&
    typeof p.modelMetadata === 'object'
  );
}
