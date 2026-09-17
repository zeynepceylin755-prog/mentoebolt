/**
 * Provenance: origin / derivation / trust are three INDEPENDENT axes.
 *
 *   origin      : WHERE the question came from      (never changes automatically)
 *   derivation  : WHICH automated steps touched it  (append-only)
 *   trust       : HOW FAR it has been verified      (monotonic promotion, gated)
 *
 * The vocabulary mirrors what Phase 5A documented in schema.prisma. Like every
 * other status/type field in this codebase, these are plain Strings — no Prisma
 * enum was introduced.
 */

export const QUESTION_ORIGINS = {
  MEB: 'MEB',
  MENTORA_MANUAL: 'MENTORA_MANUAL',
  LICENSED_BANK: 'LICENSED_BANK',
  TEACHER_CREATED: 'TEACHER_CREATED',
  STUDENT_UPLOADED: 'STUDENT_UPLOADED',
} as const;

export type QuestionOrigin = (typeof QUESTION_ORIGINS)[keyof typeof QUESTION_ORIGINS];

export const QUESTION_TRUST_LEVELS = {
  UNVERIFIED: 'UNVERIFIED',
  EXTRACTED: 'EXTRACTED',
  NORMALIZED: 'NORMALIZED',
  AI_ANALYZED: 'AI_ANALYZED',
  HUMAN_APPROVED: 'HUMAN_APPROVED',
  REJECTED: 'REJECTED',
} as const;

export type QuestionTrust = (typeof QUESTION_TRUST_LEVELS)[keyof typeof QUESTION_TRUST_LEVELS];

/** Ordered from least to most trusted. Used to compare trust levels. */
export const TRUST_ORDER: QuestionTrust[] = [
  QUESTION_TRUST_LEVELS.REJECTED,
  QUESTION_TRUST_LEVELS.UNVERIFIED,
  QUESTION_TRUST_LEVELS.EXTRACTED,
  QUESTION_TRUST_LEVELS.NORMALIZED,
  QUESTION_TRUST_LEVELS.AI_ANALYZED,
  QUESTION_TRUST_LEVELS.HUMAN_APPROVED,
];

export function trustRank(trust: string): number {
  const index = (TRUST_ORDER as string[]).indexOf(trust);
  return index === -1 ? -1 : index;
}

/** True when `candidate` is at least as trusted as `ceiling`. */
export function trustWithinCeiling(candidate: string, ceiling: string): boolean {
  const candidateRank = trustRank(candidate);
  const ceilingRank = trustRank(ceiling);
  if (candidateRank === -1 || ceilingRank === -1) {
    return false;
  }
  return candidateRank <= ceilingRank;
}

export const DERIVATION_METHODS = {
  OCR: 'OCR',
  AI_NORMALIZED: 'AI_NORMALIZED',
  AI_ANCHORED: 'AI_ANCHORED',
  AI_MAPPED: 'AI_MAPPED',
  MANUAL: 'MANUAL',
} as const;

export type DerivationMethod = (typeof DERIVATION_METHODS)[keyof typeof DERIVATION_METHODS];

/**
 * Origins that may never reach the Mentora bank automatically.
 * Enforced in the service layer (see QuestionIngestionService.evaluateApprovalGates).
 */
export const NON_AUTO_PROMOTABLE_ORIGINS: QuestionOrigin[] = [
  QUESTION_ORIGINS.STUDENT_UPLOADED,
];

export function isAutoPromotableOrigin(origin: string | null | undefined): boolean {
  if (!origin) {
    return false;
  }
  return !(NON_AUTO_PROMOTABLE_ORIGINS as string[]).includes(origin);
}
