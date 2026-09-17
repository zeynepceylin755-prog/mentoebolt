/**
 * Input validation for the normalization boundary.
 *
 * Scope: this module decides whether raw/normalized text is *usable*. It does
 * NOT parse mathematics, run OCR, or call any AI provider — those are later
 * phases. It enforces only the deterministic, non-AI guards the brief requires:
 * empty input, whitespace-only input, and obvious placeholders must never
 * become a canonical Question.
 */

/** Minimum length for a normalized question stem to be considered usable. */
export const MIN_NORMALIZED_TEXT_LENGTH = 3;

/** Placeholder strings that must never become canonical questions. */
const PLACEHOLDER_PATTERNS: RegExp[] = [
  /^question\s*\d*$/i,
  /^test\s+question$/i,
  /^soru\s*\d*$/i,
  /^örnek\s*\d*$/i,
  /^placeholder$/i,
  /^n\/?a$/i,
  /^todo$/i,
  /^\.+$/,
  /^-+$/,
];

export interface TextValidationResult {
  valid: boolean;
  /** Machine-readable reason when invalid. */
  reason?: 'EMPTY' | 'WHITESPACE_ONLY' | 'TOO_SHORT' | 'PLACEHOLDER' | 'NOT_A_STRING';
  /** The trimmed text, present whenever the input was a string. */
  trimmed?: string;
}

/**
 * Validate a candidate question text.
 *
 * Deterministic and side-effect free: the same input always yields the same
 * result, which is what makes the pipeline reproducible.
 */
export function validateQuestionText(value: unknown): TextValidationResult {
  if (typeof value !== 'string') {
    return { valid: false, reason: 'NOT_A_STRING' };
  }

  if (value.length === 0) {
    return { valid: false, reason: 'EMPTY' };
  }

  const trimmed = value.trim();

  if (trimmed.length === 0) {
    return { valid: false, reason: 'WHITESPACE_ONLY' };
  }

  if (trimmed.length < MIN_NORMALIZED_TEXT_LENGTH) {
    return { valid: false, reason: 'TOO_SHORT', trimmed };
  }

  for (const pattern of PLACEHOLDER_PATTERNS) {
    if (pattern.test(trimmed)) {
      return { valid: false, reason: 'PLACEHOLDER', trimmed };
    }
  }

  return { valid: true, trimmed };
}

/** Convenience predicate used by the service. */
export function isUsableQuestionText(value: unknown): boolean {
  return validateQuestionText(value).valid;
}

/**
 * Deterministic canonical key for bank dedup.
 *
 * NOTE: this is intentionally a *normalization* helper for an explicit,
 * author-controlled key — NOT an attempt at semantic dedup of student photos.
 * The Phase 5 design review explicitly deferred automated photo dedup because
 * wrongly merging two different questions corrupts mastery far worse than
 * keeping duplicates.
 */
export function buildCanonicalKey(origin: string, sourceReference: string): string {
  const normalized = `${origin}::${sourceReference}`
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
  return normalized;
}
