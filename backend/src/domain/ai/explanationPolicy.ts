/**
 * Explanation answer-suppression policy — Phase 5F.9-D
 *
 * A DETERMINISTIC, layered safety policy that inspects AI explanation/hint output
 * BEFORE it can reach a student. It is deliberately conservative: it prefers to
 * reject a borderline response (and fall back to a safe hint) over risking answer
 * leakage.
 *
 * IMPORTANT LIMITATION (do not overpromise): string/regex heuristics CANNOT prove
 * that arbitrary mathematical prose contains no answer. This policy therefore is
 * only ONE layer. The other layers are:
 *   1. prompt-level policy   (the correct answer never enters the provider request)
 *   2. structured validation (shape/field validation by the provider)
 *   3. this policy           (deterministic output checks)
 *   4. safe rejection        (bounded regeneration, then an answer-free fallback)
 *
 * Layer 1 is what actually makes leakage improbable; this layer catches the
 * common explicit forms. It is intentionally NOT a general math solver.
 */

export type LeakageReason =
  | 'ANSWER_IS_PHRASE'
  | 'FINAL_ANSWER_DECLARATION'
  | 'MULTIPLE_CHOICE_LETTER'
  | 'WINNER_HINT_RESPONSE'
  | 'NOT_X_BUT_Y'
  | 'RESULT_EQUALS'
  | 'COMPLETED_COMPUTATION'
  | 'FULL_SOLUTION';

export interface LeakageVerdict {
  safe: boolean;
  reasons: LeakageReason[];
}

/** All pedagogically-allowed explanation modes (no full-solution mode exists). */
export const EXPLANATION_MODES = [
  'HINT',
  'SOCRATIC',
  'FORMULA_REMINDER',
  'MISTAKE_GUIDANCE',
  'NEXT_STEP',
] as const;

export type ExplanationMode = (typeof EXPLANATION_MODES)[number];

/** Structural shape the leakage check operates on (subset of ExplanationResult). */
export interface ExplanationContent {
  explanation: string;
  stepByStep?: string[];
  examples?: string[];
  keyPoints?: string[];
  practiceSuggestion?: string;
}

/**
 * Phrases that explicitly announce the answer. Matched case-insensitively.
 * Deliberately broad — an explicit announcement is never acceptable in a hint.
 */
const ANSWER_ANNOUNCEMENT_PATTERNS: RegExp[] = [
  /\bthe\s+(?:correct\s+)?answer\s+is\b/i,
  /\bthe\s+correct\s+answer\s+(?:is|would\s+be)\b/i,
  /\bthe\s+(?:final\s+)?result\s+is\b/i,
  /\bthe\s+solution\s+is\b/i,
  /\bso\s+the\s+answer\b/i,
  /\btherefore\s*,?\s*x\s*=/i,
  /\bthe\s+value\s+of\s+x\s+is\b/i,
  /\byou\s+should\s+get\b/i,
  /\byou\s+will\s+get\b/i,
  /\bcorrect\s+option\s+is\b/i,
  /\bchoose\s+option\b/i,
  // Turkish equivalents — the product is a Turkish mathematics platform.
  /\bdoğru\s+cevap\b/i,
  /\bcevap\s+\p{L}+\s*(?:'|’)?(?:dır|dir|dur|dür)?\b/iu,
  /\bsonuc(?:u)?\s*[:=]?\s*\S+/i,
  /\byani\s*,?\s*x\s*=/i,
];

/** A multiple-choice letter/option leaked as a standalone answer. */
const MULTIPLE_CHOICE_PATTERNS: RegExp[] = [
  /\b(?:option|choice|answer|seçenek|şıkk(?:ı|i)?)\s*[:=]?\s*[A-E]\b/i,
  /\b[A-E]\s*(?:şıkk(?:ı|i)?|seçeneğ(?:i|ini))\b/i,
];

/** "The answer is not 7; it is 8" — reveals the answer by elimination. */
const NOT_X_BUT_Y_PATTERNS: RegExp[] = [
  /\bnot\s+\S+\s*(?:,|;)\s*(?:it|the\s+answer|but)\s*(?:is|would\s+be)\b/i,
  /\bit(?:'|’)?s\s+not\s+\S+\s*(?:,|;)\s*it(?:'|’)?s\b/i,
  /\b\S+\s+değil\s*,?\s*\S+\s*(?:'|’)?(?:dır|dir|dur|dür)\b/iu,
];

/**
 * A "result equals ..." statement: `= <number>` at the end of a sentence, which
 * is how a completed computation is normally presented.
 *
 * Deliberately narrow, to avoid rejecting legitimate SETUP equations (e.g.
 * "Denklemi kur: 2x + 3 = 11"), which must remain allowed. A bare `= <number>`
 * only counts as leakage when it is introduced as a conclusion — announced by a
 * conclusion word, or terminating a sentence after a numeric computation.
 *
 * NOTE: this cannot prove absence of an answer; it is one of several layers.
 */
const CONCLUSION_WORDS = /\b(?:sonu\u00e7|sonuc|x|y|answer|result|value|de\u011fer)\b/i;

const RESULT_EQUALS_PATTERNS: RegExp[] = [
  // "sonuç = 4" / "x = 4" / "the value is 4" as a stated conclusion.
  /\b(?:sonu\u00e7|sonuc|answer|result|value|de\u011fer)\s*(?:is|=|:)\s*-?\d+(?:[.,]\d+)?/i,
];

/**
 * A numeric equality at the end of a sentence, e.g. "... = 17.". Only treated as
 * leakage when the left-hand side is itself numeric (a finished computation),
 * so "2x + 3 = 11" style setups stay allowed.
 */
const NUMERIC_TERMINAL_EQUALS = /\d\s*=\s*-?\d+(?:[.,]\d+)?\s*(?:[.!?]|$)/;

/**
 * A completed arithmetic chain, e.g. "3 × 4 + 5 = 17" or "2 + 2 = 4". A single
 * "x = ..." setup is fine; a fully reduced numeric exercise is not.
 */
const COMPUTED_CHAIN_PATTERNS: RegExp[] = [
  /\d+\s*[+\-×*÷/]\s*\d+\s*(?:[+\-×*÷/]\s*\d+\s*)*=\s*-?\d+/,
];


/** Prose that indicates a worked solution rather than a nudge. */
const FULL_SOLUTION_PATTERNS: RegExp[] = [
  /\b(?:full|complete|detailed)\s+(?:worked\s+)?solution\b/i,
  /\bstep\s*1\b[\s\S]{0,80}\bstep\s*2\b[\s\S]{0,80}\bstep\s*3\b/i,
  /\badım\s*1\b[\s\S]{0,80}\badım\s*2\b[\s\S]{0,80}\badım\s*3\b/i,
  /\bhere\s+is\s+the\s+(?:full|complete)\s+solution\b/i,
  /\bçözüm(?:ün)?\s*(?:tamamı|adım\s*adım)\b/i,
];

/** Explicit "reveal the answer" phrasing that must never appear in output. */
const REVEAL_REQUEST_PATTERNS: RegExp[] = [
  /\bshow\s+(?:me\s+)?(?:the\s+)?answer\b/i,
  /\breveal\s+(?:the\s+)?(?:answer|solution)\b/i,
  /\bcevab(?:ı|i)\s*(?:söyle|ver|yaz)\b/i,
];

/**
 * Structural heuristic: a hint should be SHORT. A response that reads like a
 * multi-step derivation (many long step lines) is treated as a worked solution.
 */
const MAX_STEPS_FOR_HINT = 4;
const MAX_STEP_LENGTH = 240;

/**
 * Inspect explanation content for answer leakage. Purely deterministic.
 *
 * @param content  the model output to inspect
 * @param finalAnswer  the authoritative canonical answer, when the caller
 *                     legitimately holds it. Used ONLY to detect verbatim echoes;
 *                     it is never sent to the provider.
 */
export function assessAnswerLeakage(
  content: ExplanationContent,
  finalAnswer?: string | null
): LeakageVerdict {
  const reasons = new Set<LeakageReason>();

  const text = [
    content.explanation ?? '',
    ...(content.stepByStep ?? []),
    ...(content.examples ?? []),
    ...(content.keyPoints ?? []),
    content.practiceSuggestion ?? '',
  ].join('\n');

  if (text.trim().length === 0) {
    return { safe: false, reasons: ['ANSWER_IS_PHRASE'] };
  }

  if (ANSWER_ANNOUNCEMENT_PATTERNS.some((re) => re.test(text))) {
    reasons.add('ANSWER_IS_PHRASE');
  }
  if (REVEAL_REQUEST_PATTERNS.some((re) => re.test(text))) {
    reasons.add('ANSWER_IS_PHRASE');
  }
  if (MULTIPLE_CHOICE_PATTERNS.some((re) => re.test(text))) {
    reasons.add('MULTIPLE_CHOICE_LETTER');
  }
  if (NOT_X_BUT_Y_PATTERNS.some((re) => re.test(text))) {
    reasons.add('NOT_X_BUT_Y');
  }
  if (RESULT_EQUALS_PATTERNS.some((re) => re.test(text))) {
    reasons.add('RESULT_EQUALS');
  }
  if (NUMERIC_TERMINAL_EQUALS.test(text) && CONCLUSION_WORDS.test(text)) {
    reasons.add('RESULT_EQUALS');
  }
  if (COMPUTED_CHAIN_PATTERNS.some((re) => re.test(text))) {
    reasons.add('COMPLETED_COMPUTATION');
  }
  if (FULL_SOLUTION_PATTERNS.some((re) => re.test(text))) {
    reasons.add('FULL_SOLUTION');
  }

  if (finalAnswer && finalAnswer.trim().length > 0 && echoesAnswer(text, finalAnswer)) {
    reasons.add('FINAL_ANSWER_DECLARATION');
  }

  const steps = content.stepByStep ?? [];
  if (steps.length > MAX_STEPS_FOR_HINT && steps.some((s) => s.length > MAX_STEP_LENGTH)) {
    reasons.add('FULL_SOLUTION');
  }

  return { safe: reasons.size === 0, reasons: [...reasons] };
}

/**
 * Verbatim echo detection for the canonical answer. Only meaningful for answers
 * long enough to be a distinctive phrase; single digits are handled by the
 * result/announcement patterns instead (a bare "4" is not by itself leakage).
 */
function echoesAnswer(text: string, finalAnswer: string): boolean {
  const answer = finalAnswer.trim();
  if (answer.length < 4) {
    return false;
  }
  const normalizedText = text.toLowerCase();
  const normalizedAnswer = answer.toLowerCase();
  if (!normalizedText.includes(normalizedAnswer)) {
    return false;
  }
  // The answer appears verbatim: only flag when it is near an announcement word,
  // so that a legitimately mentioned formula is not rejected.
  const index = normalizedText.indexOf(normalizedAnswer);
  const window = normalizedText.slice(Math.max(0, index - 60), index + normalizedAnswer.length + 20);
  return /\b(?:answer|result|solution|cevap|sonuç|çözüm)\b/.test(window);
}

/**
 * A single answer-free, pedagogically useful fallback hint. It never contains a
 * result, a step chain, or anything derived from the canonical answer.
 */
export function buildSafeFallbackHint(mode: ExplanationMode): ExplanationContent {
  const base: Record<ExplanationMode, string> = {
    HINT:
      'Soruyu yeniden oku ve senden tam olarak ne istendiğini kendi cümlelerinle ifade et. Ardından verilen bilgilerden hangisinin doğrudan gerekli olduğunu belirle.',
    SOCRATIC:
      'Kendine şunu sor: Verilen koşullardan hangisi, kullanman gereken kavramı doğrudan işaret ediyor?',
    FORMULA_REMINDER:
      'İlgili kuralı ya da formülü hatırlamaya çalış: bu tür bir ifadeyi nasıl dönüştürmen gerektiğini anlatan tanım hangisiydi?',
    MISTAKE_GUIDANCE:
      'Çözümüne geri dön ve attığın adımlardan hangisinin sorudaki koşulla çeliştiğini kontrol et. Çoğu hata tek bir adımda gizlidir.',
    NEXT_STEP:
      'Bir sonraki adımı seç: elindeki ifadeyi sorun istediği biçime yaklaştıran en küçük dönüşümü bul ve neden onu seçtiğini açıkla.',
  };

  return {
    explanation: base[mode],
    stepByStep: [],
    examples: [],
    keyPoints: [],
    practiceSuggestion: '',
  };
}

/** True when a mode value is one the policy allows (there is no solution mode). */
export function isAllowedMode(value: unknown): value is ExplanationMode {
  return typeof value === 'string' && (EXPLANATION_MODES as readonly string[]).includes(value);
}
