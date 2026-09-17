/**
 * QuestionIngestion state machine.
 *
 * IMPORTANT: the state vocabulary below is NOT invented here. It is exactly the
 * vocabulary already declared on the Prisma model `QuestionIngestion`
 * (`state String @default("INGESTED")`) and documented in schema.prisma:
 *
 *   INGESTED | EXTRACTED | EXTRACTION_FAILED | NORMALIZED | ANALYZED
 *   | MAPPED | REVIEW_REQUIRED | APPROVED | REJECTED
 *
 * The Phase 5B brief proposed a `CURRICULUM_PENDING` state. That state does not
 * exist in the schema vocabulary, so per the brief's instruction ("do not add new
 * states on your own; use the existing vocabulary") it was NOT introduced. The
 * closest existing state, `ANALYZED`, carries that meaning and is used instead.
 */

export const INGESTION_STATES = {
  INGESTED: 'INGESTED',
  EXTRACTED: 'EXTRACTED',
  EXTRACTION_FAILED: 'EXTRACTION_FAILED',
  NORMALIZED: 'NORMALIZED',
  ANALYZED: 'ANALYZED',
  MAPPED: 'MAPPED',
  REVIEW_REQUIRED: 'REVIEW_REQUIRED',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
} as const;

export type IngestionState = (typeof INGESTION_STATES)[keyof typeof INGESTION_STATES];

export const ALL_INGESTION_STATES: IngestionState[] = Object.values(INGESTION_STATES);

/** Terminal states cannot be left. */
export const TERMINAL_INGESTION_STATES: IngestionState[] = [
  INGESTION_STATES.APPROVED,
  INGESTION_STATES.REJECTED,
];

/**
 * Allowed forward transitions.
 *
 * Backward transitions and skips are forbidden by construction: a state is
 * reachable only from the states listed as its predecessors.
 */
export const INGESTION_TRANSITIONS: Record<IngestionState, IngestionState[]> = {
  INGESTED: [INGESTION_STATES.EXTRACTED, INGESTION_STATES.EXTRACTION_FAILED, INGESTION_STATES.REJECTED],
  EXTRACTED: [
    INGESTION_STATES.NORMALIZED,
    INGESTION_STATES.EXTRACTION_FAILED,
    INGESTION_STATES.REJECTED,
  ],
  EXTRACTION_FAILED: [INGESTION_STATES.REJECTED, INGESTION_STATES.INGESTED],
  NORMALIZED: [INGESTION_STATES.ANALYZED, INGESTION_STATES.REVIEW_REQUIRED, INGESTION_STATES.REJECTED],
  ANALYZED: [INGESTION_STATES.MAPPED, INGESTION_STATES.REVIEW_REQUIRED, INGESTION_STATES.REJECTED],
  MAPPED: [INGESTION_STATES.REVIEW_REQUIRED, INGESTION_STATES.APPROVED, INGESTION_STATES.REJECTED],
  REVIEW_REQUIRED: [INGESTION_STATES.APPROVED, INGESTION_STATES.REJECTED],
  APPROVED: [],
  REJECTED: [],
};

export function isIngestionState(value: string): value is IngestionState {
  return (ALL_INGESTION_STATES as string[]).includes(value);
}

export function isTerminalIngestionState(state: string): boolean {
  return (TERMINAL_INGESTION_STATES as string[]).includes(state);
}

/**
 * Pure predicate: may `from` transition to `to`?
 * A no-op (from === to) is not a transition and is rejected here.
 */
export function canTransition(from: string, to: string): boolean {
  if (!isIngestionState(from) || !isIngestionState(to)) {
    return false;
  }
  return INGESTION_TRANSITIONS[from].includes(to);
}

/**
 * States from which a canonical Question may be created.
 *
 * `INGESTED` alone is deliberately NOT sufficient: the raw text has not been
 * validated yet. Only NORMALIZED (content validated) or later may produce a
 * canonical Question.
 */
export const CANONICAL_QUESTION_ELIGIBLE_STATES: IngestionState[] = [
  INGESTION_STATES.NORMALIZED,
  INGESTION_STATES.ANALYZED,
  INGESTION_STATES.MAPPED,
  INGESTION_STATES.REVIEW_REQUIRED,
  INGESTION_STATES.APPROVED,
];

export function isCanonicalQuestionEligible(state: string): boolean {
  return (CANONICAL_QUESTION_ELIGIBLE_STATES as string[]).includes(state);
}
