/**
 * Next-learning recommendation policy — Phase 6.5
 *
 * The DETERMINISTIC decision contract for "Şimdi ne çalışmalıyım?".
 *
 * This module contains ONLY pure types, thresholds and reason/action vocabularies.
 * It performs no I/O and imports no infrastructure, so the decision rules stay
 * explainable, unit-testable and free of any LLM influence.
 *
 * BOUNDARY (non-negotiable): the authoritative next action is decided here, from
 * persisted learning state alone. An AI provider may later reword the `reason`
 * text, but it must never choose the action, the MicroSkill or the priority.
 */

/** The authoritative action vocabulary (Phase 6.5 §10). */
export const ACTION_TYPES = [
  'CONTINUE_SESSION',
  'REMEDIATE_ERROR',
  'REVIEW_SKILL',
  'PRACTICE_SKILL',
  'PROGRESS_CURRICULUM',
  'MAINTAIN_SKILL',
  'ONBOARDING',
] as const;

export type ActionType = (typeof ACTION_TYPES)[number];

/** Machine-readable, deterministic reason codes (Phase 6.5 §11). */
export const REASON_CODES = [
  'ACTIVE_SESSION',
  'LOW_MASTERY',
  'REPEATED_ERROR',
  'RECENT_REGRESSION',
  'DEVELOPING_SKILL',
  'CURRICULUM_PROGRESS',
  'MAINTENANCE',
  'INSUFFICIENT_EVIDENCE',
] as const;

export type ReasonCode = (typeof REASON_CODES)[number];

export type TrendDirection = 'IMPROVING' | 'STABLE' | 'DECLINING';

/** Bounded, explainable evidence attached to a recommendation. */
export interface RecommendationEvidence {
  mastery?: number;
  evidenceCount?: number;
  recentIncorrectCount?: number;
  repeatedErrorPattern?: boolean;
  trend?: TrendDirection;
}

/**
 * The authoritative, structured recommendation. The API returns this (plus the
 * hierarchy ids needed to act on it). The student-facing wording lives in
 * `explanation` and never exposes algorithm terminology.
 */
export interface NextLearningRecommendation {
  actionType: ActionType;
  microSkillId?: string;
  /**
   * Phase 7.4 — the human-readable curriculum label for `microSkillId`,
   * resolved server-side from the authoritative MicroSkill.
   *
   * Additive and optional so the contract stays backwards compatible: existing
   * consumers keep working, and the field is `null`/absent when no MicroSkill is
   * resolvable rather than falling back to the internal id. The frontend must
   * never have to render `ms-1` as if it were a topic.
   */
  topicName?: string | null;
  processComponentId?: string;
  learningOutcomeId?: string;
  themeId?: string;
  /** Present only for CONTINUE_SESSION. */
  sessionId?: string;
  /** The student-facing (or human-readable) reason text. */
  reason: string;
  /** Deterministic machine-readable reason code — always corresponds to evidence. */
  reasonCode: ReasonCode;
  /** Higher = more urgent. Bounded 1..100. */
  priority: number;
  evidence: RecommendationEvidence;
  estimatedTimeMinutes: number;
}

// ------------------------------------------------------------------ thresholds

/**
 * Evidence volume bands (Phase 6.5 §5). `evidenceCount` is the persisted number of
 * observations that support a mastery row.
 */
export const EVIDENCE = {
  /** Below this, a conclusion is not yet trustworthy. */
  MIN_LOW: 1,
  /** Enough evidence to identify a learning direction. */
  DEVELOPING: 3,
  /** Repeated observations support a stable conclusion. */
  STRONG: 6,
} as const;

/** Mastery bands (0..100). */
export const MASTERY = {
  /** A clearly weak skill. */
  WEAK: 40,
  /** The developing band: [WEAK, DEVELOPING). */
  DEVELOPING: 70,
  /** A strong, presumably mastered skill. */
  STRONG: 70,
  /** Below this, a strong skill is considered to have regressed meaningfully. */
  REGRESSION_FLOOR: 60,
} as const;

/** Deterministic regression rule (Phase 6.5 §4 P4 / §8). */
export const REGRESSION = {
  /** Persisted mastery must have dropped by at least this many points... */
  MIN_DROP: 10,
  /** ...relative to this recent evidence floor to count as a decline. */
  MIN_PRIOR_EVIDENCE: 4,
} as const;

/** Repeated-error rule (Phase 6.5 §4 P3 / §6). */
export const REPEATED_ERROR = {
  /** At least this many incorrect attempts on the skill... */
  MIN_INCORRECT: 2,
  /** ...within the recency window... */
  WINDOW_DAYS: 30,
  /** ...with this many DISTINCT ErrorAnalysis rows is a repeated pattern. */
  MIN_ANALYSES: 2,
} as const;

/** Recency window for "recent" attempt evidence, in days. Documented, bounded. */
export const RECENT_WINDOW_DAYS = 30;

/**
 * Bounded recency weighting (§7): a recent mistake can raise urgency but can never
 * fully override strong historical mastery. Expressed as a multiplier ceiling.
 */
export const RECENCY = {
  /** Maximum urgency bonus a burst of recent incorrect answers may add. */
  MAX_BONUS: 15,
  /** Each recent incorrect attempt adds this much urgency, capped at MAX_BONUS. */
  PER_INCORRECT: 5,
} as const;

/** Priority base values per reason/action (§10 — deterministic, bounded 1..100). */
export const PRIORITY_BASE: Record<ActionType, number> = {
  CONTINUE_SESSION: 100,
  REMEDIATE_ERROR: 80,
  REVIEW_SKILL: 70,
  PRACTICE_SKILL: 60,
  PROGRESS_CURRICULUM: 40,
  MAINTAIN_SKILL: 25,
  ONBOARDING: 20,
};

/** Estimated effort per action, in minutes. Deterministic. */
export const ESTIMATED_MINUTES: Record<ActionType, number> = {
  CONTINUE_SESSION: 5,
  REMEDIATE_ERROR: 20,
  REVIEW_SKILL: 12,
  PRACTICE_SKILL: 15,
  PROGRESS_CURRICULUM: 20,
  MAINTAIN_SKILL: 8,
  ONBOARDING: 15,
};

/** True when a reason code is one the policy allows. */
export function isReasonCode(value: unknown): value is ReasonCode {
  return typeof value === 'string' && (REASON_CODES as readonly string[]).includes(value);
}

/**
 * Assert the action/reason pairing is legitimate. Guards against a reason/action
 * mismatch (§22) — e.g. LOW_MASTERY must never accompany MAINTAIN_SKILL.
 */
const ALLOWED_REASON_FOR_ACTION: Record<ActionType, readonly ReasonCode[]> = {
  CONTINUE_SESSION: ['ACTIVE_SESSION'],
  REMEDIATE_ERROR: ['REPEATED_ERROR', 'LOW_MASTERY'],
  REVIEW_SKILL: ['RECENT_REGRESSION'],
  PRACTICE_SKILL: ['LOW_MASTERY', 'DEVELOPING_SKILL'],
  PROGRESS_CURRICULUM: ['CURRICULUM_PROGRESS'],
  MAINTAIN_SKILL: ['MAINTENANCE'],
  ONBOARDING: ['INSUFFICIENT_EVIDENCE'],
};

export function isActionReasonConsistent(action: ActionType, reason: ReasonCode): boolean {
  return ALLOWED_REASON_FOR_ACTION[action].includes(reason);
}
