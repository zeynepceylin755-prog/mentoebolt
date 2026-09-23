import { DomainError } from './DomainError.js';

export class OcrProviderError extends DomainError {
  constructor(message: string) {
    super(message, 'OCR_PROVIDER_ERROR');
  }
}

export class NormalizationError extends DomainError {
  constructor(message: string) {
    super(message, 'NORMALIZATION_ERROR');
  }
}

export class InvalidProposalStructureError extends DomainError {
  constructor(message: string) {
    super(message, 'INVALID_PROPOSAL_STRUCTURE');
  }
}

export class InvalidConfidenceError extends DomainError {
  constructor(message: string) {
    super(message, 'INVALID_CONFIDENCE');
  }
}

export class UnknownCurriculumTargetError extends DomainError {
  constructor(level: string, targetId: string) {
    super(`Unknown curriculum target: ${level} with id ${targetId}`, 'UNKNOWN_CURRICULUM_TARGET');
  }
}

export class UnknownMicroSkillError extends DomainError {
  constructor(microSkillId: string) {
    super(`Unknown MicroSkill: ${microSkillId}`, 'UNKNOWN_MICROSKILL');
  }
}

export class CurriculumChainIntegrityError extends DomainError {
  constructor(microSkillId: string, reason: string) {
    super(`Curriculum chain integrity violation for MicroSkill ${microSkillId}: ${reason}`, 'CURRICULUM_CHAIN_INTEGRITY');
  }
}

export class AiAnalysisError extends DomainError {
  constructor(message: string) {
    super(message, 'AI_ANALYSIS_ERROR');
  }
}

/**
 * The AI provider is temporarily unavailable (rate limit / quota / transient
 * outage). Retrying shortly may succeed, so it is reported as 503 with a
 * dedicated code rather than as a generic analysis failure — the student should
 * see "try again in a moment", not "we could not analyse your question".
 *
 * The message is deliberately provider-generic: raw provider text stays in the
 * server logs and is never forwarded to the client.
 */
export class ProviderUnavailableError extends DomainError {
  constructor(message: string = 'The AI provider is temporarily unavailable') {
    super(message, 'AI_PROVIDER_UNAVAILABLE', 503, true);
  }
}

export class ProposalValidationError extends DomainError {
  constructor(message: string) {
    super(message, 'PROPOSAL_VALIDATION_ERROR');
  }
}
