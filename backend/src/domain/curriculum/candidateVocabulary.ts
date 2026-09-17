/**
 * Curriculum candidate vocabulary — mirrors what Phase 5A documented on the
 * Prisma model `CurriculumCandidate` (schema.prisma, QUESTION INGESTION LAYER
 * comment block):
 *
 *   CandidateLevel    : LEARNING_OUTCOME | PROCESS_COMPONENT
 *   CandidateDecision : PENDING | PRIMARY | SECONDARY | REJECTED
 *   DerivationMethod  : OCR | AI_NORMALIZED | AI_ANCHORED | AI_MAPPED | MANUAL
 *
 * As everywhere else in this codebase these stay plain Strings (no Prisma enum);
 * they are validated at the application boundary, here.
 *
 * NOTE: MicroSkill is deliberately NOT a candidate level. The candidate
 * hierarchy ends at LearningOutcome / ProcessComponent (Phase 5C scope).
 * Question -> MicroSkill belongs to QuestionSkillMapping (Phase 5D).
 */

export const CANDIDATE_LEVELS = {
  LEARNING_OUTCOME: 'LEARNING_OUTCOME',
  PROCESS_COMPONENT: 'PROCESS_COMPONENT',
} as const;

export type CandidateLevel = (typeof CANDIDATE_LEVELS)[keyof typeof CANDIDATE_LEVELS];

export const ALL_CANDIDATE_LEVELS: CandidateLevel[] = Object.values(CANDIDATE_LEVELS);

export const CANDIDATE_DECISIONS = {
  PENDING: 'PENDING',
  PRIMARY: 'PRIMARY',
  SECONDARY: 'SECONDARY',
  REJECTED: 'REJECTED',
} as const;

export type CandidateDecision = (typeof CANDIDATE_DECISIONS)[keyof typeof CANDIDATE_DECISIONS];

export const ALL_CANDIDATE_DECISIONS: CandidateDecision[] = Object.values(CANDIDATE_DECISIONS);

export function isCandidateLevel(value: string): value is CandidateLevel {
  return (ALL_CANDIDATE_LEVELS as string[]).includes(value);
}

export function isCandidateDecision(value: string): value is CandidateDecision {
  return (ALL_CANDIDATE_DECISIONS as string[]).includes(value);
}

/**
 * Decisions that assert the candidate has been settled by a human.
 * A row carrying one of these must have `reviewed = true`.
 */
export const REVIEW_REQUIRED_DECISIONS: CandidateDecision[] = [
  CANDIDATE_DECISIONS.PRIMARY,
  CANDIDATE_DECISIONS.SECONDARY,
  CANDIDATE_DECISIONS.REJECTED,
];

export function decisionRequiresReview(decision: string): boolean {
  return (REVIEW_REQUIRED_DECISIONS as string[]).includes(decision);
}

/** Confidence domain: a finite number in [0, 1]. */
export const CONFIDENCE_MIN = 0;
export const CONFIDENCE_MAX = 1;
