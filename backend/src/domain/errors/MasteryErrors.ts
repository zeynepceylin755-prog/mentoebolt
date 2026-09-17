import { DomainError } from './DomainError.js';

/**
 * Mastery application errors — Phase 5F.3.
 *
 * These follow the project convention: a DomainError subclass carrying a stable
 * machine-readable `code` and HTTP status, mirroring ValidationError /
 * NotFoundError / ConflictError. No parallel error framework is introduced.
 */

/** No authoritative (PRIMARY) MicroSkill mapping exists for the attempt's question. */
export class MasteryMicroSkillUnresolvedError extends DomainError {
  constructor(questionId: string) {
    super(
      `No authoritative MicroSkill mapping for question ${questionId}`,
      'MASTERY_MICROSKILL_UNRESOLVED',
      422,
      false
    );
  }
}

/** The resolved MicroSkill is unknown or inactive, so it cannot carry mastery. */
export class MasteryMicroSkillInvalidError extends DomainError {
  constructor(microSkillId: string) {
    super(
      `MicroSkill ${microSkillId} does not exist or is not active`,
      'MASTERY_MICROSKILL_INVALID',
      422,
      false
    );
  }
}

/**
 * Optimistic concurrency conflict: the SkillMastery row changed after it was
 * read, so the conditional update matched no row. The caller must retry against
 * fresh state; silent last-write-wins is never acceptable.
 */
export class MasteryVersionConflictError extends DomainError {
  constructor(studentId: string, skillId: string, expectedVersion: number) {
    super(
      `SkillMastery version conflict for student ${studentId} / skill ${skillId} (expected version ${expectedVersion})`,
      'MASTERY_VERSION_CONFLICT',
      409,
      false
    );
  }
}
