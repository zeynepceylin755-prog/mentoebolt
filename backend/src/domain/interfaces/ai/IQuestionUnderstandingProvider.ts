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
  /**
   * Normalized question text.
   *
   * Required for TEXT_PASTE. For IMAGE_UPLOAD it is OPTIONAL: the question may
   * exist only as an image, in which case the provider receives the image
   * content part instead (see `image`).
   */
  normalizedText?: string;
  /**
   * Optional image input for an IMAGE_UPLOAD ingestion.
   *
   * The bytes are supplied by the caller from the storage abstraction — the
   * provider NEVER resolves a filesystem path itself and NEVER receives a
   * `local://...` reference as if it were content. This keeps the storage
   * boundary in one place (QuestionAnalysisService) and lets the provider stay a
   * transport-only adapter.
   */
  image?: {
    /** Verified MIME type of the image (e.g. image/png). */
    mimeType: string;
    /** Raw image bytes. Never logged. */
    data: Buffer;
    /** Opaque asset reference, for metadata/logging only — never sent as content. */
    assetRef: string;
  };
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
