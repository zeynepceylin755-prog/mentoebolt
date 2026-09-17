import { QuestionUnderstandingProposal } from '../../../domain/ingestion/questionUnderstandingProposal.js';

/**
 * Question Understanding Provider Interface — Phase 5E
 *
 * Specialized AI provider for mathematical question understanding.
 * Unlike generic IAIProvider, this is domain-specific and returns
 * structured curriculum/microskill proposals.
 */

export interface QuestionUnderstandingRequest {
  ingestionId: string;
  normalizedText: string;
  /** Available curriculum context for the AI to reference */
  curriculumContext?: {
    learningOutcomes: Array<{ id: string; code: string; text: string }>;
    processComponents: Array<{ id: string; code: string; text: string; learningOutcomeId: string }>;
    microSkills: Array<{ id: string; code: string; name: string; description: string; processComponentId: string }>;
  };
}

export interface QuestionUnderstandingResponse {
  proposal: QuestionUnderstandingProposal;
  /** Overall confidence in the AI's understanding */
  confidence: number;
  /** Warnings about the analysis (e.g., ambiguous content, low confidence) */
  warnings: string[];
}

export interface IQuestionUnderstandingProvider {
  /** Get the provider name for logging/audit */
  getProviderName(): string;
  
  /** Get the model name being used */
  getModelName(): string;
  
  /** Get the provider version */
  getVersion(): string;
  
  /**
   * Analyze a normalized question and generate understanding proposals.
   * 
   * The provider MUST:
   * - Return structured output matching QuestionUnderstandingProposal
   * - Only use existing curriculum IDs (never fabricate new ones)
   * - Include confidence scores for all proposals
   * - Generate warnings for ambiguous or uncertain content
   * 
   * The provider MUST NOT:
   * - Create new LearningOutcome, ProcessComponent, or MicroSkill
   * - Modify question origin or trust
   * - Write directly to QuestionSkillMapping
   */
  analyze(request: QuestionUnderstandingRequest): Promise<QuestionUnderstandingResponse>;
  
  /** Check if the provider is available/configured */
  isAvailable(): Promise<boolean>;
}
