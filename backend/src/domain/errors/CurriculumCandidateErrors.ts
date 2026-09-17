import { DomainError } from './DomainError.js';

/**
 * Curriculum candidate lifecycle errors.
 *
 * Follows the existing project convention (each error extends DomainError with
 * its own stable `code`), matching IngestionErrors.ts. No parallel error
 * framework is introduced, and no raw Prisma error ever reaches an API client.
 */

/** The supplied curriculum level is not in the candidate vocabulary. */
export class InvalidCandidateLevelError extends DomainError {
  constructor(level: string) {
    super(
      `Invalid curriculum candidate level: ${level}`,
      'INVALID_CURRICULUM_LEVEL',
      400,
      false
    );
  }
}

/** The supplied decision is not in the candidate decision vocabulary. */
export class InvalidCandidateDecisionError extends DomainError {
  constructor(decision: string) {
    super(
      `Invalid curriculum candidate decision: ${decision}`,
      'INVALID_CANDIDATE_DECISION',
      400,
      false
    );
  }
}

/** The referenced Question does not exist. */
export class CandidateQuestionNotFoundError extends DomainError {
  constructor(questionId: string) {
    super(
      `Question with id ${questionId} not found`,
      'CANDIDATE_QUESTION_NOT_FOUND',
      404,
      false
    );
  }
}

/** The referenced curriculum target (LearningOutcome / ProcessComponent) does not exist. */
export class CurriculumTargetNotFoundError extends DomainError {
  constructor(level: string, targetId: string) {
    super(
      `Curriculum target of level ${level} with id ${targetId} not found`,
      'CURRICULUM_TARGET_NOT_FOUND',
      404,
      false
    );
  }
}

/**
 * A ProcessComponent candidate was supplied together with a parent
 * LearningOutcome that does not actually own that component.
 */
export class ParentConsistencyError extends DomainError {
  constructor(processComponentId: string, learningOutcomeId: string) {
    super(
      `ProcessComponent ${processComponentId} does not belong to LearningOutcome ${learningOutcomeId}`,
      'CURRICULUM_PARENT_MISMATCH',
      409,
      false
    );
  }
}

/** The same (questionId, level, targetId) candidate already exists. */
export class DuplicateCandidateError extends DomainError {
  constructor() {
    super(
      'A curriculum candidate already exists for this question, level and target',
      'DUPLICATE_CURRICULUM_CANDIDATE',
      409,
      false
    );
  }
}

/** The candidate could not be found (or is not visible to the caller). */
export class CandidateNotFoundError extends DomainError {
  constructor(id?: string) {
    super(
      id ? `CurriculumCandidate with id ${id} not found` : 'CurriculumCandidate not found',
      'CURRICULUM_CANDIDATE_NOT_FOUND',
      404,
      false
    );
  }
}

/** Confidence is not a finite number within the allowed range. */
export class InvalidConfidenceError extends DomainError {
  constructor(message: string) {
    super(message, 'INVALID_CONFIDENCE', 400, false);
  }
}

/**
 * The requested decision/review combination is logically impossible, e.g.
 * a settled decision without `reviewed = true`.
 */
export class InvalidReviewStateError extends DomainError {
  constructor(message: string) {
    super(message, 'INVALID_REVIEW_STATE', 409, false);
  }
}

/** The actor is not permitted to mutate curriculum candidates. */
export class CandidateAuthorizationError extends DomainError {
  constructor(message: string = 'Insufficient permissions to modify curriculum candidates') {
    super(message, 'CURRICULUM_CANDIDATE_FORBIDDEN', 403, false);
  }
}
