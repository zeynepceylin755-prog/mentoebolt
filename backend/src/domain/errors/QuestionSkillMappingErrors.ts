import { DomainError } from './DomainError.js';

/**
 * QuestionSkillMapping writer errors.
 *
 * Follows the existing project convention (each error extends DomainError with
 * its own stable `code`), matching IngestionErrors.ts and
 * CurriculumCandidateErrors.ts. No raw Prisma error ever reaches an API client.
 */

/** The referenced Question does not exist. */
export class MappingQuestionNotFoundError extends DomainError {
  constructor(questionId: string) {
    super(
      `Question with id ${questionId} not found`,
      'QUESTION_NOT_FOUND',
      404,
      false
    );
  }
}

/** The referenced MicroSkill does not exist. */
export class MappingMicroSkillNotFoundError extends DomainError {
  constructor(microSkillId: string) {
    super(
      `MicroSkill with id ${microSkillId} not found`,
      'MICROSKILL_NOT_FOUND',
      404,
      false
    );
  }
}

/**
 * The MicroSkill exists but its curriculum chain is broken or incomplete:
 * a MicroSkill must resolve MicroSkill -> ProcessComponent -> LearningOutcome
 * -> Theme -> CurriculumVersion.
 */
export class MicroSkillCurriculumInvalidError extends DomainError {
  constructor(microSkillId: string, detail: string) {
    super(
      `MicroSkill ${microSkillId} has an invalid curriculum chain: ${detail}`,
      'MICROSKILL_CURRICULUM_INVALID',
      409,
      false
    );
  }
}

/** A mapping already exists for this (questionId, microSkillId) pair. */
export class DuplicateQuestionSkillMappingError extends DomainError {
  constructor() {
    super(
      'A skill mapping already exists for this question and micro skill',
      'DUPLICATE_QUESTION_SKILL_MAPPING',
      409,
      false
    );
  }
}

/** The question already has a PRIMARY mapping and another was requested. */
export class PrimarySkillMappingExistsError extends DomainError {
  constructor() {
    super(
      'This question already has a PRIMARY skill mapping',
      'PRIMARY_SKILL_MAPPING_EXISTS',
      409,
      false
    );
  }
}

/** relevance is not a finite number within the allowed range. */
export class InvalidRelevanceError extends DomainError {
  constructor(message: string) {
    super(message, 'INVALID_RELEVANCE', 400, false);
  }
}

/** aiConfidence is not a finite number within the allowed range. */
export class InvalidAiConfidenceError extends DomainError {
  constructor(message: string) {
    super(message, 'INVALID_AI_CONFIDENCE', 400, false);
  }
}

/** mappingSource is not in the allowed vocabulary. */
export class InvalidMappingSourceError extends DomainError {
  constructor(source: string) {
    super(
      `Invalid mapping source: ${source}`,
      'INVALID_SOURCE',
      400,
      false
    );
  }
}

/** The requested review state is logically impossible. */
export class InvalidMappingReviewStateError extends DomainError {
  constructor(message: string) {
    super(message, 'INVALID_REVIEW_STATE', 409, false);
  }
}

/** The mapping could not be found. */
export class MappingNotFoundError extends DomainError {
  constructor(id?: string) {
    super(
      id ? `QuestionSkillMapping with id ${id} not found` : 'QuestionSkillMapping not found',
      'QUESTION_SKILL_MAPPING_NOT_FOUND',
      404,
      false
    );
  }
}

/** The actor is not permitted to mutate question skill mappings. */
export class MappingAuthorizationError extends DomainError {
  constructor(message: string = 'Insufficient permissions to modify question skill mappings') {
    super(message, 'QUESTION_SKILL_MAPPING_FORBIDDEN', 403, false);
  }
}
