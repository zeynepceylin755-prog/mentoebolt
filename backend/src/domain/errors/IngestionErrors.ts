import { DomainError } from './DomainError.js';

/**
 * Ingestion lifecycle errors.
 *
 * These follow the existing project convention: each error extends DomainError
 * with its own stable `code` (see ValidationError / NotFoundError /
 * ConflictError). No parallel error framework is introduced.
 */

/** An ingestion record could not be found (or is not visible to the caller). */
export class IngestionNotFoundError extends DomainError {
  constructor(id?: string) {
    super(
      id ? `QuestionIngestion with id ${id} not found` : 'QuestionIngestion not found',
      'INGESTION_NOT_FOUND',
      404,
      false
    );
  }
}

/** The requested state change is not allowed by the state machine. */
export class InvalidStateTransitionError extends DomainError {
  constructor(from: string, to: string) {
    super(
      `Invalid ingestion state transition: ${from} -> ${to}`,
      'INVALID_STATE_TRANSITION',
      409,
      false
    );
  }
}

/** Approval was attempted while the review gate is still active. */
export class ReviewRequiredError extends DomainError {
  constructor(reason: string) {
    super(
      `Ingestion cannot be approved: ${reason}`,
      'REVIEW_REQUIRED',
      409,
      false
    );
  }
}

/** The target trust level exceeds the source's trust ceiling. */
export class TrustCeilingExceededError extends DomainError {
  constructor(requested: string, ceiling: string) {
    super(
      `Trust level ${requested} exceeds the source trust ceiling ${ceiling}`,
      'TRUST_CEILING_EXCEED',
      409,
      false
    );
  }
}

/** The supplied input is empty, whitespace-only, or otherwise unusable. */
export class InvalidIngestionInputError extends DomainError {
  constructor(message: string) {
    super(message, 'INVALID_INPUT', 400, false);
  }
}

/** A canonical Question may not be produced from the current state/content. */
export class QuestionCreationBlockedError extends DomainError {
  constructor(reason: string) {
    super(
      `Canonical Question creation blocked: ${reason}`,
      'QUESTION_CREATION_BLOCKED',
      409,
      false
    );
  }
}

/** An actor attempted an action they are not permitted to perform. */
export class IngestionAuthorizationError extends DomainError {
  constructor(message: string = 'You do not have access to this ingestion') {
    super(message, 'INGESTION_FORBIDDEN', 403, false);
  }
}

/** An uploaded asset failed validation (type, size or content mismatch). */
export class InvalidUploadError extends DomainError {
  constructor(reason: string) {
    super(`Invalid upload: ${reason}`, 'INVALID_UPLOAD', 400, false);
  }
}
