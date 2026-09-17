import type {
  NextRecommendation,
  RecommendationActionType,
  SkillProgress,
} from './studentJourney';

/**
 * Presentation-only vocabulary for the student UI.
 *
 * Everything here maps an ALREADY-DECIDED backend value onto calmer student
 * language. It never derives, guesses or recomputes a learning decision: no
 * threshold, no mastery maths and no recommendation logic lives in the browser.
 * When a backend code is unknown the raw code is shown rather than a fabricated
 * label.
 */

/** Student-facing wording for the backend's deterministic recommendation actions. */
const ACTION_LABELS: Record<RecommendationActionType, string> = {
  CONTINUE_SESSION: 'Kaldığın yerden devam',
  REMEDIATE_ERROR: 'Tekrar eden bir noktayı netleştir',
  REVIEW_SKILL: 'Kısa bir tekrar',
  PRACTICE_SKILL: 'Pratikle pekiştir',
  PROGRESS_CURRICULUM: 'Sıradaki konu',
  MAINTAIN_SKILL: 'Koruyarak ilerle',
  ONBOARDING: 'İlk adım',
};

/** Student-facing call to action for each action type. */
const ACTION_CTA: Record<RecommendationActionType, string> = {
  CONTINUE_SESSION: 'Oturuma devam et',
  REMEDIATE_ERROR: 'Tekrarı başlat',
  REVIEW_SKILL: 'Tekrara başla',
  PRACTICE_SKILL: 'Pratiğe başla',
  PROGRESS_CURRICULUM: 'Yeni konuya geç',
  MAINTAIN_SKILL: 'Kısa bir tekrar yap',
  ONBOARDING: 'Başla',
};

/**
 * One short, human sentence per deterministic reason code.
 *
 * These are deliberately NOT motivational: they state what the backend observed
 * in the student's own work. A reason code the UI does not know falls back to
 * the backend's own `reason` text.
 */
const REASON_SENTENCES: Record<string, string> = {
  ACTIVE_SESSION: 'Başladığın oturumda bekleyen sorular var.',
  LOW_MASTERY: 'Bu alanda birkaç denemen oldu ve henüz oturmamış görünüyor.',
  REPEATED_ERROR: 'Son çözdüğün sorularda burada tekrar eden bir zorlanma gördük.',
  RECENT_REGRESSION: 'Bu alanda son denemelerinde bir gerileme görünüyor.',
  DEVELOPING_SKILL: 'Bu alanda ilerliyorsun; kısa bir çalışma iyi gelir.',
  CURRICULUM_PROGRESS: 'Mevcut konularında yol aldın. Sıradaki konuya geçebiliriz.',
  MAINTENANCE: 'Bu alan oturmuş görünüyor; korumak için kısa bir tekrar yeterli.',
  INSUFFICIENT_EVIDENCE: 'Henüz seninle ilgili yeterli veri yok.',
};

export function actionLabel(actionType: RecommendationActionType | string): string {
  return ACTION_LABELS[actionType as RecommendationActionType] ?? actionType;
}

export function actionCta(actionType: RecommendationActionType | string): string {
  return ACTION_CTA[actionType as RecommendationActionType] ?? 'Başla';
}

/**
 * The sentence shown under "Neden?" — derived only from the backend's
 * authoritative reason code, never from client-side analysis.
 */
export function reasonSentence(recommendation: NextRecommendation): string {
  return REASON_SENTENCES[recommendation.reasonCode] ?? recommendation.reason;
}

/** Turkish labels for the persisted mastery trend. */
export function trendLabel(trend: string | null | undefined): string | null {
  switch (trend) {
    case 'UP':
      return 'İlerliyor';
    case 'DOWN':
      return 'Geriliyor';
    case 'STABLE':
      return 'Dengede';
    default:
      return null;
  }
}

/** Turkish labels for the persisted mastery status. */
const MASTERY_LABELS: Record<string, string> = {
  MASTERED: 'Pekişti',
  DEVELOPING: 'Gelişiyor',
  WEAK: 'Çalışılmalı',
  NOT_STARTED: 'Başlanmadı',
};

/**
 * Persisted mastery status, read from the backend row. The bands come from the
 * backend's own thresholds (mastery >= 80 && confidence >= 0.7 = mastered;
 * >= 40 = developing) and exist only to pick a word — no number is invented.
 */
export function masteryStatusLabel(skill: SkillProgress): string {
  if (skill.masteryLevel >= 80 && skill.confidence >= 0.7) {
    return MASTERY_LABELS.MASTERED;
  }
  if (skill.masteryLevel >= 40) {
    return MASTERY_LABELS.DEVELOPING;
  }
  return MASTERY_LABELS.WEAK;
}

/** The label a skill is shown under. Prefers the backend name, never invents one. */
export function skillDisplayName(skill: SkillProgress): string {
  const name = skill.skillName?.trim();
  if (name && name.length > 0 && name !== 'undefined') {
    return name;
  }
  return skill.skillId;
}

/** Turkish labels for the backend's persisted error categories. */
const ERROR_TYPE_LABELS: Record<string, string> = {
  CONCEPT: 'Kavramsal ayrım',
  PREREQUISITE: 'Ön koşul eksikliği',
  SKILL: 'Beceri',
  OPERATION: 'İşlem sırası',
  CALCULATION: 'Hesaplama',
  READING: 'Soruyu okuma',
  ATTENTION: 'Dikkat',
  OTHER: 'Diğer',
};

export function errorTypeLabel(errorType: string | null | undefined): string {
  if (!errorType) {
    return 'Analiz bekleniyor';
  }
  return ERROR_TYPE_LABELS[errorType] ?? errorType;
}

/** Turkish labels for the backend's guidance modes (there is no solution mode). */
export const GUIDANCE_MODE_LABELS: Record<string, string> = {
  HINT: 'Bir ipucu',
  SOCRATIC: 'Bir adım daha',
  FORMULA_REMINDER: 'Hatırlatma',
  MISTAKE_GUIDANCE: 'Takıldığın nokta',
  NEXT_STEP: 'Sıradaki adım',
};

export function guidanceModeLabel(mode: string): string {
  return GUIDANCE_MODE_LABELS[mode] ?? mode;
}

/** Compact Turkish labels for enum-like backend values used in badges. */
export function evaluationStateLabel(state: string | null | undefined): string {
  switch (state) {
    case 'NOT_EVALUABLE':
      return 'Değerlendirilemedi';
    case 'EVALUATED':
      return 'Değerlendirildi';
    default:
      return 'Analiz bekleniyor';
  }
}
