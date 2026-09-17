import {
  validateQuestionText,
  type TextValidationResult,
} from '../ingestion/inputValidation.js';
import {
  QUESTION_ORIGINS,
  type QuestionOrigin,
} from '../ingestion/provenance.js';

/**
 * Question content quality gate — Phase 7.2
 *
 * A DETERMINISTIC, side-effect-free classifier that says how trustworthy a
 * canonical Question's *content* is. It never calls AI, never reads the
 * database, and never mutates anything: the same input always yields the same
 * result.
 *
 * It exists so that every Question entering Mentora can be given an honest,
 * deterministic quality verdict:
 *
 *   VALID            — structurally usable, non-placeholder content.
 *   REVIEW_REQUIRED  — possibly usable, but something is uncertain (e.g. a
 *                      conservative placeholder suspicion). A human must decide.
 *   INVALID          — definitively unusable (empty / whitespace / too short /
 *                      a known literal placeholder / a detected fixture marker).
 *
 * IMPORTANT BOUNDARIES
 * - This classification is NOT authoritative for mastery, scoring or progress.
 *   It is a content-quality signal only.
 * - Fixture detection is CONSERVATIVE. A false positive (marking a real question
 *   as a fixture) is more damaging than a false negative, so genuine-looking
 *   mathematics is never flagged as a fixture.
 * - When a suspicion exists but is not conclusive, the result is
 *   REVIEW_REQUIRED — never an automatic INVALID.
 */

export const QUESTION_QUALITY = {
  VALID: 'VALID',
  REVIEW_REQUIRED: 'REVIEW_REQUIRED',
  INVALID: 'INVALID',
} as const;

export type QuestionQuality = (typeof QUESTION_QUALITY)[keyof typeof QUESTION_QUALITY];

export type QualityReason =
  | 'OK'
  | 'EMPTY'
  | 'WHITESPACE_ONLY'
  | 'TOO_SHORT'
  | 'PLACEHOLDER'
  | 'NOT_A_STRING'
  | 'FIXTURE_MARKER'
  | 'SUSPECTED_PLACEHOLDER';

export interface QuestionQualityResult {
  quality: QuestionQuality;
  reason: QualityReason;
  /** True only when the content is confidently fixture/demo material. */
  isFixtureLike: boolean;
  /** The trimmed content, present whenever the input was a string. */
  trimmed?: string;
}

/**
 * Repository-specific fixture markers. A question carrying one of these is a
 * development/demo artifact, never real content.
 *
 * These are matched as whole-token markers (case-insensitive), not as substrings
 * of genuine prose, so a legitimate question is not accidentally rejected.
 */
const FIXTURE_MARKERS: RegExp[] = [
  /\bfixture\b/i,
  /\bdemo\s+question\b/i,
  /\bseed\s+question\b/i,
  /\bsample\s+question\b/i,
  /\btest\s+question\b/i,
  /\btestfixture\b/i,
  /\bTEST_FIXTURE\b/,
  /\bplaceholder\b/i,
  /\btodo\b/i,
  /\bquestion\s*#?\s*\d+\b/i,
  /\bsoru\s*#?\s*\d+\b/i,
  /\börnek\s+soru\b/i,
  /\bdemo\b/i,
];

/**
 * Deterministic arithmetic-drill placeholder shape: a bare "What is a + b?"
 * style prompt, or a lone arithmetic expression, with no mathematical context.
 * Detected as a SUSPICION (REVIEW_REQUIRED), never an automatic rejection, so a
 * genuinely short drill is not destroyed.
 */
const ARITHMETIC_DRILL_PATTERNS: RegExp[] = [
  /^(?:what\s+is\s+)?\d+\s*[+\-*/x×÷]\s*\d+\s*\??$/i,
  /^(?:kaçtır|kaç)\s*\??$/i,
  /^\d+\s*[+\-*/x×÷]\s*\d+\s*=\s*\??$/i,
];

/** True when the text looks like a repository fixture/demo artifact. */
export function looksLikeFixture(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return false;
  }
  return FIXTURE_MARKERS.some((re) => re.test(trimmed));
}

/** True when the text merely resembles a bare arithmetic drill (a suspicion). */
export function looksLikeArithmeticDrill(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return false;
  }
  return ARITHMETIC_DRILL_PATTERNS.some((re) => re.test(trimmed));
}

/**
 * Classify a question's content.
 *
 * A hard failure from the underlying text validator (empty / whitespace /
 * too-short / known literal placeholder / non-string) is INVALID. A fixture
 * marker is INVALID and `isFixtureLike = true`. A bare arithmetic drill is
 * REVIEW_REQUIRED — conservative, since deleting a legitimate short drill would
 * be worse than routing it to a human.
 */
export function classifyQuestionContent(value: unknown): QuestionQualityResult {
  const base: TextValidationResult = validateQuestionText(value);

  if (!base.valid) {
    return {
      quality: QUESTION_QUALITY.INVALID,
      reason: base.reason as QualityReason,
      isFixtureLike: typeof value === 'string' && looksLikeFixture(value),
      trimmed: base.trimmed,
    };
  }

  const trimmed = (base.trimmed ?? '') as string;

  if (looksLikeFixture(trimmed)) {
    return {
      quality: QUESTION_QUALITY.INVALID,
      reason: 'FIXTURE_MARKER',
      isFixtureLike: true,
      trimmed,
    };
  }

  if (looksLikeArithmeticDrill(trimmed)) {
    return {
      quality: QUESTION_QUALITY.REVIEW_REQUIRED,
      reason: 'SUSPECTED_PLACEHOLDER',
      isFixtureLike: false,
      trimmed,
    };
  }

  return {
    quality: QUESTION_QUALITY.VALID,
    reason: 'OK',
    isFixtureLike: false,
    trimmed,
  };
}

/** Convenience predicate: is this content confidently usable? */
export function isUsableCanonicalContent(value: unknown): boolean {
  return classifyQuestionContent(value).quality === QUESTION_QUALITY.VALID;
}

/**
 * Whether a Question row is eligible to participate in a student-facing journey
 * (session selection, answering, analytics). Fixtures and inactive questions are
 * never eligible. This is the single predicate the read paths share so the rule
 * cannot drift between them.
 */
export function isProductionEligibleQuestion(
  question: { isFixture?: boolean | null; isActive?: boolean | null } | null | undefined
): boolean {
  if (!question) {
    return false;
  }
  if (question.isFixture === true) {
    return false;
  }
  if (question.isActive === false) {
    return false;
  }
  return true;
}

/**
 * Whether an origin may legitimately claim to be an authoritative, reusable
 * bank source. STUDENT_UPLOADED content is deliberately excluded: a student's
 * statement that "this is from the MEB book" is NOT provenance evidence.
 */
export function isReusableBankOrigin(origin: string | null | undefined): boolean {
  if (!origin) {
    return false;
  }
  return origin !== QUESTION_ORIGINS.STUDENT_UPLOADED;
}

/** Re-export for callers that need the origin vocabulary alongside quality. */
export { QUESTION_ORIGINS, type QuestionOrigin };

/**
 * Read the Phase 6.3 evaluation state from a safe attempt metadata blob.
 * Absent/unparseable metadata is treated as a normal (evaluated) attempt. This
 * is the canonical reader shared by the analytics read path; the write paths
 * (Mastery / ErrorAnalysis) keep their own local copies to avoid coupling.
 */
export function readAttemptEvaluationState(
  metadata: string | null | undefined
): 'EVALUATED' | 'NOT_EVALUABLE' | null {
  if (!metadata) {
    return null;
  }
  try {
    const parsed = JSON.parse(metadata);
    const value = parsed?.evaluationState;
    return value === 'EVALUATED' || value === 'NOT_EVALUABLE' ? value : null;
  } catch {
    return null;
  }
}

/**
 * Whether an attempt row may count toward authoritative accuracy/analytics.
 * An unevaluable attempt (no canonical answer) carries no correctness signal, so
 * counting it as incorrect would fabricate a failure. Fixture-question attempts
 * never contribute to real analytics.
 */
export function isAnalyticsEligibleAttempt(attempt: {
  metadata?: string | null;
  question?: { isFixture?: boolean | null } | null;
}): boolean {
  if (readAttemptEvaluationState(attempt.metadata) === 'NOT_EVALUABLE') {
    return false;
  }
  if (attempt.question && attempt.question.isFixture === true) {
    return false;
  }
  return true;
}
