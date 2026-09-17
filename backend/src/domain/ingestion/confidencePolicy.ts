/**
 * Confidence Policy — Phase 5E
 *
 * Centralized confidence threshold configuration.
 * Avoids hard-coding thresholds throughout the codebase.
 */

export const CONFIDENCE_THRESHOLDS = {
  HIGH: 0.85,
  MEDIUM_MIN: 0.60,
  LOW_MAX: 0.5999,
} as const;

export type ConfidenceLevel = 'HIGH' | 'MEDIUM' | 'LOW';

export function getConfidenceLevel(confidence: number): ConfidenceLevel {
  if (confidence >= CONFIDENCE_THRESHOLDS.HIGH) {
    return 'HIGH';
  }
  if (confidence >= CONFIDENCE_THRESHOLDS.MEDIUM_MIN) {
    return 'MEDIUM';
  }
  return 'LOW';
}

export function requiresReview(confidence: number): boolean {
  // All proposals below HIGH confidence require review
  return confidence < CONFIDENCE_THRESHOLDS.HIGH;
}

export function isValidConfidence(confidence: number): boolean {
  return (
    typeof confidence === 'number' &&
    Number.isFinite(confidence) &&
    confidence >= 0 &&
    confidence <= 1
  );
}
