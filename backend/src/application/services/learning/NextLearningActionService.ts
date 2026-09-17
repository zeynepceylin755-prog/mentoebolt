import { PrismaClient } from '@prisma/client';
import { logger } from '../../../infrastructure/logging/logger.js';
import {
  ACTION_TYPES,
  ESTIMATED_MINUTES,
  EVIDENCE,
  MASTERY,
  PRIORITY_BASE,
  RECENCY,
  RECENT_WINDOW_DAYS,
  REGRESSION,
  REPEATED_ERROR,
  isActionReasonConsistent,
  type NextLearningRecommendation,
  type ReasonCode,
  type RecommendationEvidence,
  type TrendDirection,
} from '../../../domain/recommendation/nextLearningActionPolicy.js';

/**
 * NextLearningActionService — Phase 6 Enhanced
 *
 * Provides deterministic next-learning recommendations based on authoritative student state.
 * The recommendation engine is deterministic first, with AI used only for wording, not decisions.
 *
 * Decision hierarchy (authoritative):
 * 1. Repeated weakness in a MicroSkill (ErrorPattern frequency/severity)
 * 2. Recent incorrect attempts
 * 3. Low mastery (<40%)
 * 4. Due for spaced repetition review
 * 5. Developing skills (40-70%)
 * 6. Strong skills maintenance
 * 7. Recent improvement / avoid unnecessary repetition
 * 8. Default to new learning session
 *
 * AI may assist with:
 * - Recommendation wording/explanation
 * - Practice suggestion phrasing
 * - Next step description
 *
 * AI is NEVER authoritative for:
 * - Skill selection
 * - Priority calculation
 * - Mastery interpretation
 * - ErrorPattern analysis
 */

interface SkillState {
  skillId: string;
  microSkillId: string | null;
  name: string | null;
  masteryLevel: number;
  confidence: number;
  evidenceCount: number;
  attempts: number;
  correctAttempts: number;
  lastAttemptAt: Date | null;
  nextReviewAt: Date | null;
  /** Persisted trend from the mastery calculator: UP | DOWN | STABLE. */
  persistedTrend: string | null;
  /** Deterministic, bounded signals aggregated for this skill. */
  recentIncorrectCount: number;
  recentEvaluatedCount: number;
  analysisCount: number;
  distinctErrorPatterns: number;
  repeatedErrorPattern: boolean;
  trend: TrendDirection;
}

/** Internal shape before priority clamping. */
type Recommendation = NextLearningRecommendation & { reasonCode: ReasonCode };

/** Injectable clock so tests can freeze time. Defaults to the real clock. */
export type Clock = () => Date;

export interface NextLearningActionOptions {
  clock?: Clock;
}

export class NextLearningActionService {
  private readonly clock: Clock;

  constructor(
    private readonly prisma: PrismaClient,
    options: NextLearningActionOptions = {}
  ) {
    this.clock = options.clock ?? (() => new Date());
  }

  async getNextAction(studentId: string): Promise<NextLearningRecommendation> {
    const now = this.clock();

    // P1 is evaluated FIRST and independently of mastery data: an in-progress
    // session must outrank any generic topic recommendation (§4 P1).
    const sessionAction = await this.resolveActiveSession(studentId, now);
    if (sessionAction) {
      return this.finalize(sessionAction);
    }

    const skillStates = await this.loadSkillStates(studentId, now);

    if (skillStates.length === 0) {
      // P8: no learning evidence at all → deterministic onboarding. Never invent
      // a weakness for a brand-new student (§14).
      return this.finalize(await this.onboarding());
    }

    const action =
      this.pickRepeatedError(skillStates) ??
      this.pickCriticalGap(skillStates) ??
      this.pickRegression(skillStates) ??
      this.pickDeveloping(skillStates) ??
      this.pickMaintenance(skillStates) ??
      (await this.pickCurriculumProgression(studentId)) ??
      this.pickFallback(skillStates);

    return this.finalize(this.withTopicName(action, skillStates));
  }

  /**
   * Attach the human-readable topic label to a chosen recommendation.
   *
   * Phase 7.4. The label is already loaded on every `SkillState` via the same
   * `microSkill` relation the decision uses, so this is a pure lookup and never
   * an extra query. The frontend previously had only `microSkillId` and rendered
   * raw ids such as `ms-1`; `topicName` is what lets it show "Bileşke fonksiyon".
   *
   * Never falls back to an identifier: an unresolvable MicroSkill yields `null`
   * so the UI can say so honestly.
   */
  private withTopicName(rec: Recommendation, states: SkillState[]): Recommendation {
    if (!rec.microSkillId) {
      return { ...rec, topicName: null };
    }
    const match = states.find((s) => s.microSkillId === rec.microSkillId);
    return { ...rec, topicName: match?.name ?? null };
  }

  // ============================================================== P1 — session
  /**
   * An ACTIVE, non-expired session with at least one PENDING question. Expiry is
   * compared against the injected clock so the outcome stays deterministic.
   */
  private async resolveActiveSession(
    studentId: string,
    now: Date
  ): Promise<Recommendation | null> {
    const session = await this.prisma.learningSession.findFirst({
      where: { studentId, status: 'ACTIVE' },
      orderBy: { startedAt: 'desc' },
    });
    if (!session) {
      return null;
    }
    if (session.expiresAt && session.expiresAt.getTime() <= now.getTime()) {
      return null;
    }

    const pending = await this.prisma.learningSessionQuestion.count({
      where: { sessionId: session.id, status: 'PENDING' },
    });
    if (pending === 0) {
      // Nothing left to answer: the session itself is not a next ACTION.
      return null;
    }

    return {
      actionType: 'CONTINUE_SESSION',
      sessionId: session.id,
      reason: 'Başladığın oturumda bekleyen sorular var. Kaldığın yerden devam edelim.',
      reasonCode: 'ACTIVE_SESSION',
      priority: PRIORITY_BASE.CONTINUE_SESSION,
      evidence: {},
      estimatedTimeMinutes: ESTIMATED_MINUTES.CONTINUE_SESSION,
    };
  }

  // ======================================================== skill state loading
  /**
   * Load every mastery row for the student together with a bounded, deterministic
   * aggregation of the signals the hierarchy needs. All ordering is explicit so
   * the result does not depend on database row order.
   */
  private async loadSkillStates(studentId: string, now: Date): Promise<SkillState[]> {
    const masteries = await this.prisma.skillMastery.findMany({
      where: { studentId },
      include: { microSkill: true },
      orderBy: { skillId: 'asc' },
    });
    if (masteries.length === 0) {
      return [];
    }

    const windowStart = new Date(now.getTime() - RECENT_WINDOW_DAYS * 24 * 60 * 60 * 1000);

    // One bounded query for recent attempts (with PRIMARY mapping) and one for the
    // student's recent ErrorAnalysis rows; both are grouped in memory by skill.
    const recentAttempts = await this.prisma.questionAttempt.findMany({
      where: {
        studentId,
        createdAt: { gte: windowStart },
        question: { skillMappings: { some: { isPrimary: true }}},
      },
      include: {
        question: {
          include: {
            skillMappings: {
              where: { isPrimary: true },
              orderBy: { createdAt: 'asc' },
            },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    const recentAnalyses = await this.prisma.errorAnalysis.findMany({
      where: {
        studentId,
        createdAt: { gte: windowStart },
        errorPattern: { microSkills: { some: {} } },
      },
      include: {
        errorPattern: {
          include: {
            microSkills: { orderBy: { microSkillId: 'asc' } },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    const attemptsBySkill = new Map<string, { incorrect: number; evaluated: number }>();
    for (const attempt of recentAttempts) {
      const primary = attempt.question.skillMappings[0];
      if (!primary) continue;
      const bucket = attemptsBySkill.get(primary.microSkillId) ?? { incorrect: 0, evaluated: 0 };
      bucket.evaluated += 1;
      if (!attempt.isCorrect) bucket.incorrect += 1;
      attemptsBySkill.set(primary.microSkillId, bucket);
    }

    // For each skill we track BOTH the number of ErrorAnalysis occurrences (the
    // "repeated" signal) and the set of distinct patterns (the taxonomy signal).
    const analysisOccurrences = new Map<string, number>();
    const patternsBySkill = new Map<string, Set<string>>();
    for (const analysis of recentAnalyses) {
      const pattern = analysis.errorPattern;
      if (!pattern) continue;
      // A pattern is compatible with a skill through ErrorPatternMicroSkill.
      for (const link of pattern.microSkills) {
        analysisOccurrences.set(link.microSkillId, (analysisOccurrences.get(link.microSkillId) ?? 0) + 1);
        const set = patternsBySkill.get(link.microSkillId) ?? new Set<string>();
        set.add(pattern.id);
        patternsBySkill.set(link.microSkillId, set);
      }
    }

    return masteries.map((m) => {
      const skillId = m.skillId;
      const attemptBucket = attemptsBySkill.get(skillId) ?? { incorrect: 0, evaluated: 0 };
      const patterns = patternsBySkill.get(skillId) ?? new Set<string>();
      // "Repeated" counts repeated OCCURRENCES of the same error, which is the
      // pedagogically meaningful signal (the same mistake made again).
      const analysisCount = analysisOccurrences.get(skillId) ?? 0;

      // Deterministic trend: the persisted calculator trend when it is decisive,
      // otherwise derived from the recent incorrect ratio and evidence volume.
      const persisted = (m.trend ?? '').toUpperCase();
      let trend: TrendDirection;
      if (persisted === 'DOWN') {
        trend = 'DECLINING';
      } else if (persisted === 'UP') {
        trend = 'IMPROVING';
      } else if (
        m.evidenceCount >= EVIDENCE.DEVELOPING &&
        attemptBucket.evaluated >= EVIDENCE.DEVELOPING
      ) {
        const incorrectRatio = attemptBucket.incorrect / attemptBucket.evaluated;
        trend = incorrectRatio > 0.6 ? 'DECLINING' : 'STABLE';
      } else {
        trend = 'STABLE';
      }

      const repeatedErrorPattern =
        attemptBucket.incorrect >= REPEATED_ERROR.MIN_INCORRECT &&
        analysisCount >= REPEATED_ERROR.MIN_ANALYSES;

      return {
        skillId,
        microSkillId: m.microSkillId ?? (m.microSkill ? m.microSkill.id : null),
        name: m.microSkill?.name ?? null,
        masteryLevel: m.masteryLevel,
        confidence: m.confidence,
        evidenceCount: m.evidenceCount,
        attempts: m.attempts,
        correctAttempts: m.correctAttempts,
        lastAttemptAt: m.lastAttemptAt ?? null,
        nextReviewAt: m.nextReviewAt ?? null,
        persistedTrend: m.trend ?? null,
        recentIncorrectCount: attemptBucket.incorrect,
        recentEvaluatedCount: attemptBucket.evaluated,
        analysisCount,
        distinctErrorPatterns: patterns.size,
        repeatedErrorPattern,
        trend,
      } satisfies SkillState;
    });
  }

  // ==================================================== P2 — repeated error
  /**
   * A repeated, recent error pattern on a skill that is not yet mastered. This
   * outranks the raw low-mastery rule because repeated identical mistakes are a
   * stronger, more actionable signal than a single low score (§4 P2 / §6).
   */
  private pickRepeatedError(states: SkillState[]): Recommendation | null {
    const candidates = states
      .filter((s) => s.repeatedErrorPattern && s.masteryLevel < MASTERY.DEVELOPING)
      .sort((a, b) => this.compareByUrgency(a, b));
    const chosen = candidates[0];
    if (!chosen) {
      return null;
    }
    return {
      actionType: 'REMEDIATE_ERROR',
      microSkillId: chosen.microSkillId ?? undefined,
      reason:
        'Bu konuda birkaç kez benzer yerde takıldın. Önce temel adımı birlikte netleştirelim.',
      reasonCode: 'REPEATED_ERROR',
      priority: PRIORITY_BASE.REMEDIATE_ERROR + this.recencyBonus(chosen),
      evidence: this.evidenceFor(chosen),
      estimatedTimeMinutes: ESTIMATED_MINUTES.REMEDIATE_ERROR,
    };
  }

  // ================================================= P3 — critical learning gap
  /**
   * Clearly weak mastery WITH sufficient evidence. A low-evidence row is NOT
   * allowed to dominate: it must meet EVIDENCE.DEVELOPING to be actionable, and a
   * single observation is deliberately excluded (§5).
   */
  private pickCriticalGap(states: SkillState[]): Recommendation | null {
    const candidates = states
      .filter(
        (s) =>
          s.masteryLevel < MASTERY.WEAK &&
          s.evidenceCount >= EVIDENCE.DEVELOPING &&
          s.attempts >= EVIDENCE.DEVELOPING
      )
      .sort((a, b) => this.compareByUrgency(a, b));
    const chosen = candidates[0];
    if (!chosen) {
      return null;
    }
    return {
      actionType: 'PRACTICE_SKILL',
      microSkillId: chosen.microSkillId ?? undefined,
      reason:
        'Bu konuda biraz daha pratik yapmak faydalı görünüyor. Temel adımları pekiştirelim.',
      reasonCode: 'LOW_MASTERY',
      priority: PRIORITY_BASE.PRACTICE_SKILL + this.recencyBonus(chosen),
      evidence: this.evidenceFor(chosen),
      estimatedTimeMinutes: ESTIMATED_MINUTES.PRACTICE_SKILL,
    };
  }

  // ====================================================== P4 — recent regression
  /**
   * Deterministic regression rule: a skill whose persisted trend is DOWN and whose
   * recent window is dominated by incorrect answers — but ONLY with enough evidence
   * to be meaningful (§8). A high-mastery skill is never framed as a regression.
   */
  private pickRegression(states: SkillState[]): Recommendation | null {
    const candidates = states
      .filter((s) => {
        if (s.evidenceCount < REGRESSION.MIN_PRIOR_EVIDENCE) return false;
        if (s.masteryLevel >= MASTERY.STRONG) return false;
        const decliningByTrend = s.trend === 'DECLINING';
        const decliningByRatio =
          s.recentEvaluatedCount >= EVIDENCE.DEVELOPING &&
          s.recentIncorrectCount / s.recentEvaluatedCount > 0.5;
        return decliningByTrend && decliningByRatio;
      })
      .sort((a, b) => this.compareByUrgency(a, b));
    const chosen = candidates[0];
    if (!chosen) {
      return null;
    }
    return {
      actionType: 'REVIEW_SKILL',
      microSkillId: chosen.microSkillId ?? undefined,
      reason:
        'Bu konuda son zamanlarda bir gerileme görünüyor. Kısa bir tekrar iyi gelecek.',
      reasonCode: 'RECENT_REGRESSION',
      priority: PRIORITY_BASE.REVIEW_SKILL + this.recencyBonus(chosen),
      evidence: this.evidenceFor(chosen),
      estimatedTimeMinutes: ESTIMATED_MINUTES.REVIEW_SKILL,
    };
  }

  // ====================================================== P5 — developing skill
  /**
   * The developing band. Picks the weakest developing skill, breaking ties by the
   * least cumulative practice and then a stable id, so the same skill is not
   * recommended forever while remaining fully deterministic (§9).
   */
  private pickDeveloping(states: SkillState[]): Recommendation | null {
    const candidates = states
      .filter((s) => s.masteryLevel >= MASTERY.WEAK && s.masteryLevel < MASTERY.DEVELOPING)
      .sort((a, b) => {
        // Lower mastery first, then the skill with the least accumulated practice,
        // then a stable id tiebreak — fully deterministic, no time dependence.
        if (a.masteryLevel !== b.masteryLevel) return a.masteryLevel - b.masteryLevel;
        if (a.attempts !== b.attempts) return a.attempts - b.attempts;
        return a.skillId.localeCompare(b.skillId);
      });
    const chosen = candidates[0];
    if (!chosen) {
      return null;
    }
    return {
      actionType: 'PRACTICE_SKILL',
      microSkillId: chosen.microSkillId ?? undefined,
      reason: 'Bu beceri gelişme aşamasında. Birkaç alıştırmayla pekiştirmek iyi olur.',
      reasonCode: 'DEVELOPING_SKILL',
      priority: PRIORITY_BASE.PRACTICE_SKILL - 10,
      evidence: this.evidenceFor(chosen),
      estimatedTimeMinutes: ESTIMATED_MINUTES.PRACTICE_SKILL,
    };
  }

  // ========================================================= P6 — maintenance
  /**
   * Strong skills get maintenance ONLY when it is actually warranted: either a
   * spaced-repetition review has come due, or the skill is strong but its evidence
   * of retention is still modest. A high score alone is never a reason to
   * recommend already-mastered content (§4 P6).
   */
  private pickMaintenance(states: SkillState[]): Recommendation | null {
    const nowMs = this.clock().getTime();
    const due = states
      .filter(
        (s) =>
          s.masteryLevel >= MASTERY.STRONG &&
          s.nextReviewAt !== null &&
          s.nextReviewAt.getTime() <= nowMs
      )
      .sort((a, b) => a.skillId.localeCompare(b.skillId));
    const dueChosen = due[0];
    if (dueChosen) {
      return {
        actionType: 'MAINTAIN_SKILL',
        microSkillId: dueChosen.microSkillId ?? undefined,
        reason: 'Bu beceriyi korumak için kısa bir tekrar zamanı geldi.',
        reasonCode: 'MAINTENANCE',
        priority: PRIORITY_BASE.MAINTAIN_SKILL,
        evidence: this.evidenceFor(dueChosen),
        estimatedTimeMinutes: ESTIMATED_MINUTES.MAINTAIN_SKILL,
      };
    }

    // A strong skill with thin retention evidence benefits from one more pass.
    const thin = states
      .filter(
        (s) =>
          s.masteryLevel >= MASTERY.STRONG &&
          s.confidence >= 0.5 &&
          s.evidenceCount < EVIDENCE.STRONG
      )
      .sort((a, b) => a.skillId.localeCompare(b.skillId));
    const thinChosen = thin[0];
    if (thinChosen) {
      return {
        actionType: 'MAINTAIN_SKILL',
        microSkillId: thinChosen.microSkillId ?? undefined,
        reason: 'Bu beceride iyi durumdasın. Emin olmak için kısa bir tekrar yapalım.',
        reasonCode: 'MAINTENANCE',
        priority: PRIORITY_BASE.MAINTAIN_SKILL,
        evidence: this.evidenceFor(thinChosen),
        estimatedTimeMinutes: ESTIMATED_MINUTES.MAINTAIN_SKILL,
      };
    }

    return null;
  }

  // ================================================ P7 — curriculum progression
  /**
   * Walk the AUTHORITATIVE curriculum ordering deterministically:
   * CurriculumVersion → Theme(sourceOrder) → LearningOutcome(sourceOrder) →
   * ProcessComponent(sourceOrder) → MicroSkill(code). The first active MicroSkill
   * the student has no mastery row for is the next unseen skill. No prerequisite
   * relationship is invented; only the persisted ordering is used (§4 P7 / §3).
   */
  private async pickCurriculumProgression(
    studentId: string
  ): Promise<Recommendation | null> {
    const seen = await this.prisma.skillMastery.findMany({
      where: { studentId },
      select: { skillId: true },
      orderBy: { skillId: 'asc' },
    });
    const seenIds = new Set(seen.map((s) => s.skillId));

    const microSkills = await this.prisma.microSkill.findMany({
      where: { isActive: true },
      orderBy: { code: 'asc' },
      include: {
        processComponent: {
          include: {
            learningOutcome: { include: { theme: true } },
          },
        },
      },
    });

    // Order by the curriculum hierarchy, then by MicroSkill code, all explicitly.
    const ordered = microSkills
      .filter((ms) => !seenIds.has(ms.id))
      .sort((a, b) => {
        const ta = a.processComponent.learningOutcome.theme.sourceOrder;
        const tb = b.processComponent.learningOutcome.theme.sourceOrder;
        if (ta !== tb) return ta - tb;
        const la = a.processComponent.learningOutcome.sourceOrder;
        const lb = b.processComponent.learningOutcome.sourceOrder;
        if (la !== lb) return la - lb;
        const pa = a.processComponent.sourceOrder;
        const pb = b.processComponent.sourceOrder;
        if (pa !== pb) return pa - pb;
        return a.code.localeCompare(b.code);
      });

    const next = ordered[0];
    if (!next) {
      return null;
    }

    return {
      actionType: 'PROGRESS_CURRICULUM',
      microSkillId: next.id,
      processComponentId: next.processComponentId,
      learningOutcomeId: next.processComponent.learningOutcomeId,
      themeId: next.processComponent.learningOutcome.themeId,
      reason: 'Bir sonraki konuya geçmeye hazırsın. Yeni beceriyi birlikte keşfedelim.',
      reasonCode: 'CURRICULUM_PROGRESS',
      priority: PRIORITY_BASE.PROGRESS_CURRICULUM,
      evidence: {},
      estimatedTimeMinutes: ESTIMATED_MINUTES.PROGRESS_CURRICULUM,
    };
  }

  // ============================================================ P8 — fallback
  /**
   * Mastery rows exist but none met a higher rule. Rather than fabricate a
   * personalised weakness, return a deterministic, non-judgemental next step that
   * targets the skill with the least practice.
   */
  private pickFallback(states: SkillState[]): Recommendation {
    const chosen = [...states].sort((a, b) => {
      if (a.attempts !== b.attempts) return a.attempts - b.attempts;
      return a.skillId.localeCompare(b.skillId);
    })[0];

    return {
      actionType: 'PRACTICE_SKILL',
      microSkillId: chosen.microSkillId ?? undefined,
      reason: 'Biraz daha pratik yapmak faydalı görünüyor. Küçük bir adımla devam edelim.',
      reasonCode: 'DEVELOPING_SKILL',
      priority: PRIORITY_BASE.PRACTICE_SKILL - 20,
      evidence: this.evidenceFor(chosen),
      estimatedTimeMinutes: ESTIMATED_MINUTES.PRACTICE_SKILL,
    };
  }

  /** Deterministic onboarding for a student with no learning evidence at all. */
  private async onboarding(): Promise<Recommendation> {
    const firstSkill = await this.prisma.microSkill.findFirst({
      where: { isActive: true },
      orderBy: { code: 'asc' },
      include: {
        processComponent: { include: { learningOutcome: true } },
      },
    });

    return {
      actionType: 'ONBOARDING',
      microSkillId: firstSkill?.id,
      processComponentId: firstSkill?.processComponentId,
      learningOutcomeId: firstSkill?.processComponent.learningOutcomeId,
      themeId: firstSkill?.processComponent.learningOutcome.themeId,
      reason: 'Henüz yeterli veri yok. İlk adım olarak kısa bir başlangıç yapalım.',
      reasonCode: 'INSUFFICIENT_EVIDENCE',
      priority: PRIORITY_BASE.ONBOARDING,
      evidence: {},
      estimatedTimeMinutes: ESTIMATED_MINUTES.ONBOARDING,
    };
  }

  // ================================================================ helpers
  /**
   * Deterministic urgency ordering for the "weakest actionable skill" rules:
   * evidence-adjusted urgency first, then the most recent incorrect count, then a
   * stable skill-id tiebreak. Never time-dependent beyond the injected clock.
   */
  private compareByUrgency(a: SkillState, b: SkillState): number {
    const aScore = this.urgencyScore(a);
    const bScore = this.urgencyScore(b);
    if (aScore !== bScore) return bScore - aScore;
    if (a.recentIncorrectCount !== b.recentIncorrectCount) {
      return b.recentIncorrectCount - a.recentIncorrectCount;
    }
    return a.skillId.localeCompare(b.skillId);
  }

  /**
   * Bounded urgency score. Mastery deficit dominates; evidence count gates
   * confidence; recency adds at most RECENCY.MAX_BONUS so a burst of recent
   * mistakes can never fully override strong historical evidence (§7).
   */
  private urgencyScore(s: SkillState): number {
    const masteryDeficit = 100 - s.masteryLevel;
    const evidenceWeight = Math.min(s.evidenceCount, EVIDENCE.STRONG) / EVIDENCE.STRONG;
    const analysisWeight = Math.min(s.analysisCount, REPEATED_ERROR.MIN_ANALYSES) * 4;
    return (
      masteryDeficit * (0.5 + 0.5 * evidenceWeight) + analysisWeight + this.recencyBonus(s)
    );
  }

  /** Bounded recency bonus from recent incorrect attempts. */
  private recencyBonus(s: SkillState): number {
    return Math.min(s.recentIncorrectCount * RECENCY.PER_INCORRECT, RECENCY.MAX_BONUS);
  }

  /** Evidence payload exposed by the policy — numbers only, no internal ids. */
  private evidenceFor(s: SkillState): RecommendationEvidence {
    return {
      mastery: Math.round(s.masteryLevel * 10) / 10,
      evidenceCount: s.evidenceCount,
      recentIncorrectCount: s.recentIncorrectCount,
      repeatedErrorPattern: s.repeatedErrorPattern,
      trend: s.trend,
    };
  }

  /** Clamp priority into the documented 1..100 band and validate the pairing. */
  private finalize(rec: Recommendation): NextLearningRecommendation {
    const priority = Math.max(1, Math.min(100, Math.round(rec.priority)));

    // Explainability guard (§22): the action and reason must be a legal pair.
    if (!isActionReasonConsistent(rec.actionType, rec.reasonCode)) {
      logger.error(
        { actionType: rec.actionType, reasonCode: rec.reasonCode },
        'Recommendation action/reason mismatch — falling back to ONBOARDING'
      );
      return {
        actionType: 'ONBOARDING',
        reason: 'Şimdilik kısa bir başlangıç yapalım.',
        reasonCode: 'INSUFFICIENT_EVIDENCE',
        priority: PRIORITY_BASE.ONBOARDING,
        evidence: {},
        estimatedTimeMinutes: ESTIMATED_MINUTES.ONBOARDING,
      };
    }

    if (!ACTION_TYPES.includes(rec.actionType)) {
      throw new Error(`Unknown recommendation action type: ${String(rec.actionType)}`);
    }

    return { ...rec, priority };
  }

}
