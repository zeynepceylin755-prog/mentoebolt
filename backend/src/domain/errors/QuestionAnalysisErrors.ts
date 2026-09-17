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

export class ProposalValidationError extends DomainError {
  constructor(message: string) {
    super(message, 'PROPOSAL_VALIDATION_ERROR');
  }
}
