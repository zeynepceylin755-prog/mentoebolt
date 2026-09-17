import { describe, it, expect } from 'vitest';
import {
  actionCta,
  actionLabel,
  errorTypeLabel,
  evaluationStateLabel,
  guidanceModeLabel,
  masteryStatusLabel,
  reasonSentence,
  skillDisplayName,
  trendLabel,
} from './presentation';
import type { NextRecommendation, SkillProgress } from './studentJourney';

function skill(overrides: Partial<SkillProgress>): SkillProgress {
  return {
    skillId: 's-1',
    masteryLevel: 50,
    confidence: 0.5,
    attempts: 4,
    correctAttempts: 2,
    accuracy: 50,
    ...overrides,
  };
}

function rec(overrides: Partial<NextRecommendation>): NextRecommendation {
  return {
    actionType: 'PRACTICE_SKILL',
    reasonCode: 'DEVELOPING_SKILL',
    reason: 'raw backend reason',
    priority: 1,
    evidence: {},
    estimatedTimeMinutes: 10,
    ...overrides,
  };
}

describe('presentation vocabulary', () => {
  it('translates every deterministic action into calm student language', () => {
    expect(actionLabel('REMEDIATE_ERROR')).toBe('Tekrar eden bir noktayı netleştir');
    expect(actionLabel('PROGRESS_CURRICULUM')).toBe('Sıradaki konu');
    expect(actionLabel('REVIEW_SKILL')).toBe('Kısa bir tekrar');
  });

  it('shows the raw backend code when an action is unknown, never a guess', () => {
    expect(actionLabel('SOMETHING_NEW')).toBe('SOMETHING_NEW');
    expect(actionCta('SOMETHING_NEW')).toBe('Başla');
  });

  it('uses the backend reason sentence for known reason codes', () => {
    expect(reasonSentence(rec({ reasonCode: 'REPEATED_ERROR' }))).toBe(
      'Son çözdüğün sorularda burada tekrar eden bir zorlanma gördük.'
    );
  });

  it('falls back to the backend text for an unknown reason code', () => {
    const unknown = { reasonCode: 'BRAND_NEW_CODE', reason: 'backend metni' } as unknown as NextRecommendation;
    expect(reasonSentence(unknown)).toBe('backend metni');
  });

  it('labels persisted mastery status without inventing a percentage', () => {
    expect(masteryStatusLabel(skill({ masteryLevel: 90, confidence: 0.8 }))).toBe('Pekişti');
    expect(masteryStatusLabel(skill({ masteryLevel: 55 }))).toBe('Gelişiyor');
    expect(masteryStatusLabel(skill({ masteryLevel: 10 }))).toBe('Çalışılmalı');
  });

  it('never claims mastery from a high score with low confidence', () => {
    expect(masteryStatusLabel(skill({ masteryLevel: 95, confidence: 0.2 }))).toBe('Gelişiyor');
  });

  it('prefers the backend curriculum name and falls back to the id', () => {
    expect(skillDisplayName(skill({ skillName: 'Bileşke fonksiyon' }))).toBe('Bileşke fonksiyon');
    expect(skillDisplayName(skill({ skillName: '   ' }))).toBe('s-1');
    expect(skillDisplayName(skill({ skillName: undefined }))).toBe('s-1');
    expect(skillDisplayName(skill({ skillName: 'undefined' }))).toBe('s-1');
  });

  it('labels trends only when the backend provided one', () => {
    expect(trendLabel('UP')).toBe('İlerliyor');
    expect(trendLabel('DOWN')).toBe('Geriliyor');
    expect(trendLabel('STABLE')).toBe('Dengede');
    expect(trendLabel(null)).toBeNull();
    expect(trendLabel(undefined)).toBeNull();
  });

  it('translates persisted error categories and admits when none exists', () => {
    expect(errorTypeLabel('CONCEPT')).toBe('Kavramsal ayrım');
    expect(errorTypeLabel('OPERATION')).toBe('İşlem sırası');
    expect(errorTypeLabel(null)).toBe('Analiz bekleniyor');
    expect(errorTypeLabel('FUTURE_CATEGORY')).toBe('FUTURE_CATEGORY');
  });

  it('uses progressive, non-revealing guidance labels', () => {
    expect(guidanceModeLabel('HINT')).toBe('Bir ipucu');
    expect(guidanceModeLabel('SOCRATIC')).toBe('Bir adım daha');
    expect(guidanceModeLabel('NEXT_STEP')).toBe('Sıradaki adım');
    // There is deliberately no solution mode.
    expect(guidanceModeLabel('FULL_SOLUTION')).toBe('FULL_SOLUTION');
  });

  it('reports an unevaluated attempt honestly rather than as incorrect', () => {
    expect(evaluationStateLabel('NOT_EVALUABLE')).toBe('Değerlendirilemedi');
    expect(evaluationStateLabel(null)).toBe('Analiz bekleniyor');
  });
});
