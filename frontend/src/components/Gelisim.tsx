import { useCallback } from 'react';
import { ArrowRight, Minus, TrendingDown, TrendingUp } from 'lucide-react';
import {
  getAttemptsForStudent,
  getMySkillProgress,
  getNextRecommendation,
  type AttemptResult,
  type NextRecommendation,
  type SkillProgress,
} from '@/lib/studentJourney';
import { useCachedResource } from '@/lib/requestCache';
import {
  actionLabel,
  errorTypeLabel,
  masteryStatusLabel,
  reasonSentence,
  skillDisplayName,
  trendLabel,
} from '@/lib/presentation';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import Loading from '@/components/ui/Loading';
import ErrorState from '@/components/ui/ErrorState';
import EmptyState from '@/components/ui/EmptyState';
import PageContainer from '@/components/ui/PageContainer';
import PageHeader from '@/components/ui/PageHeader';
import type { StudentDestinationId } from '@/components/StudentShell';

interface GelisimProps {
  onNavigate?: (view: StudentDestinationId) => void;
}

/**
 * "Gelişim" — educational progress, with nothing invented.
 *
 * Phase 7.4: Redesigned editorially to remove generic SaaS grid layout.
 * Incorporated Matematik Yolum functionality - shows the student's path
 * with evidence ordering. Uses mutually exclusive progress labels to avoid
 * overlap between categories.
 *
 * What this page may show: persisted strengthened areas, the student's path,
 * and recurring error patterns. What it may NEVER show: XP, streaks, scores,
 * or a percentage nobody measured. If the backend has no evidence, the page
 * shows an honest empty state instead of placeholder charts.
 */
export default function Gelisim({ onNavigate }: GelisimProps) {
  const goTo = useCallback(
    (view: StudentDestinationId) => {
      if (onNavigate) {
        onNavigate(view);
        return;
      }
      window.location.hash = view;
    },
    [onNavigate]
  );

  // The progress view is the only required read; attempts and the recommendation
  // are enrichment and are allowed to degrade independently.
  const { data, loading, error, refresh } = useCachedResource(
    'gelisim/progress',
    async () => {
      const [skillRows, attemptRows, next] = await Promise.all([
        getMySkillProgress(),
        getAttemptsForStudent(50).catch(() => [] as AttemptResult[]),
        getNextRecommendation().catch(() => null),
      ]);
      return { skills: skillRows ?? [], attempts: attemptRows ?? [], next };
    },
    'Gelişimin şu anda yüklenemedi. Lütfen tekrar dene.'
  );

  const skills: SkillProgress[] = data?.skills ?? [];
  const attempts: AttemptResult[] = data?.attempts ?? [];
  const recommendation: NextRecommendation | null = data?.next ?? null;

  if (loading) {
    return (
      <PageContainer>
        <Loading state="loading" message="Gelişimin hazırlanıyor..." />
      </PageContainer>
    );
  }

  if (error) {
    return (
      <PageContainer>
        <ErrorState
          title="Gelişimine ulaşamadık"
          message={error}
          onRetry={() => void refresh()}
        />
      </PageContainer>
    );
  }

  if (skills.length === 0 && attempts.length === 0) {
    return (
      <PageContainer>
        <PageHeader eyebrow="Gelişim" title="Gelişimin" />
        <EmptyState
          type="progress"
          title="Henüz gelişimini gösterecek kadar veri yok."
          description="Birkaç soru çözdükçe hangi alanlarda güçlendiğini ve neye dikkat etmen gerektiğini burada görmeye başlayacaksın."
          action={{ label: 'İlk sorumu getir', onClick: () => goTo('soru-getir') }}
        />
      </PageContainer>
    );
  }

  // Keep classifications mutually exclusive: a skill should have one primary
  // story on this page, not appear in several competing summaries.
  const strengthened = skills
    .filter((skill) => skill.correctAttempts > 0 && skill.masteryLevel >= 80 && skill.confidence >= 0.7)
    .sort((a, b) => b.correctAttempts - a.correctAttempts)
    .slice(0, 5);
  const strengthenedIds = new Set(strengthened.map((skill) => skill.skillId));

  const developing = skills
    .filter(
      (skill) =>
        !strengthenedIds.has(skill.skillId) &&
        skill.masteryLevel >= 40 &&
        skill.masteryLevel < 80 &&
        skill.attempts >= 2
    )
    .sort((a, b) => b.masteryLevel - a.masteryLevel)
    .slice(0, 5);
  const classifiedIds = new Set([
    ...strengthened.map((skill) => skill.skillId),
    ...developing.map((skill) => skill.skillId),
  ]);

  // Remaining evidence is ordered by mastery and appears only in this list.
  const orderedPath = skills
    .filter((skill) => !classifiedIds.has(skill.skillId))
    .sort((a, b) => b.masteryLevel - a.masteryLevel);

  // Recurring error categories, grouped purely from persisted classifications.
  const errorCounts = new Map<string, number>();
  for (const attempt of attempts) {
    if (attempt.isCorrect || attempt.evaluationState === 'NOT_EVALUABLE') continue;
    const type = attempt.errorAnalysis?.errorType;
    if (!type) continue;
    errorCounts.set(type, (errorCounts.get(type) ?? 0) + 1);
  }
  const weakAreas = [...errorCounts.entries()]
    .map(([type, count]) => ({ key: type, label: errorTypeLabel(type), count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 3);

  const correctCount = attempts.filter(
    (attempt) => attempt.isCorrect && attempt.evaluationState !== 'NOT_EVALUABLE'
  ).length;
  const evaluated = attempts.filter(
    (attempt) => attempt.evaluationState !== 'NOT_EVALUABLE'
  ).length;

  return (
    <PageContainer>
      <PageHeader
        eyebrow="Gelişim"
        title="Gelişimin"
        lead="Burada gördüğün her şey senin çözdüğün sorulardan geliyor. Ölçmediğimiz bir şeyi göstermiyoruz."
      />

      <div className="space-y-14">
        {/* Current focus section */}
        {recommendation && recommendation.actionType !== 'ONBOARDING' && (
          <div>
            <p className="editorial-kicker">ŞU ANKİ ODAK</p>
            <h2 className="mt-3 font-display text-2xl text-ink">
              Şu an en çok burada çalışıyorsun.
            </h2>
            <div className="mt-5 grid gap-6 border-y border-border py-6 lg:grid-cols-[1fr_0.7fr] lg:gap-12">
              <div>
              <p className="font-display text-3xl text-ink">
                {recommendation.topicName || actionLabel(recommendation.actionType)}
              </p>
              <p className="mt-2 text-body leading-relaxed text-muted">
                {reasonSentence(recommendation)}
              </p>
              <div className="mt-4">
                <Button onClick={() => goTo('soru-getir')} size="lg">
                  Bugünkü odağa git →
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </Button>
              </div>
              </div>
              <div className="bg-surface/60 p-5">
                <p className="editorial-kicker">REHBER NOTU</p>
                <p className="mt-3 text-sm leading-relaxed text-ink">Bu alan, son verilerindeki tekrar eden sinyallerle birlikte izleniyor.</p>
              </div>
            </div>
          </div>
        )}

        {/* Most worked areas - editorial style, not card grid */}
        <div>
            <p className="editorial-kicker">MATEMATİK PROFİLİN</p>
            <h2 className="mt-3 font-display text-2xl text-ink">
              Çalıştığın alanlar
          </h2>
          <div className="mt-5 grid gap-px overflow-hidden rounded-2xl border border-border bg-border md:grid-cols-2">
            {orderedPath.length > 0 ? (
              <ul className="contents">
                {orderedPath.slice(0, 5).map((skill) => {
                  const trend = trendLabel(skill.trend);
                  const status = skill.attempts < 2 ? 'Henüz az veri' : masteryStatusLabel(skill);
                  return (
                    <li key={skill.skillId} className="bg-card p-5 sm:p-6">
                      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                        <span className="min-w-0 flex-1 text-sm font-semibold text-ink">
                          {skillDisplayName(skill)}
                        </span>
                        <span className="flex-shrink-0 text-body-sm text-muted">
                          {status}
                        </span>
                      </div>
                      <p className="mt-2 text-xs text-muted">
                        {skill.attempts} deneme · {skill.correctAttempts} doğru
                        {trend && (
                          <>
                            {' · '}
                            <span className="inline-flex items-center gap-1">
                              {skill.trend === 'UP' && (
                                <TrendingUp className="h-3.5 w-3.5 text-success" aria-hidden="true" />
                              )}
                              {skill.trend === 'DOWN' && (
                                <TrendingDown className="h-3.5 w-3.5 text-accent" aria-hidden="true" />
                              )}
                              {skill.trend === 'STABLE' && (
                                <Minus className="h-3.5 w-3.5 text-muted" aria-hidden="true" />
                              )}
                              {trend}
                            </span>
                          </>
                        )}
                      </p>
                      <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-border" aria-label={`${skillDisplayName(skill)} gelişim seviyesi`}>
                        <div className="h-full rounded-full bg-ink" style={{ width: `${Math.max(0, Math.min(100, skill.masteryLevel))}%` }} />
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="bg-card p-6 text-body-sm text-muted">
                Henüz bir alan kaydı oluşmadı.
              </p>
            )}
          </div>
        </div>

        {/* Strengthened areas - mutually exclusive */}
        {strengthened.length > 0 && (
          <div>
            <h2 className="font-display text-2xl text-ink mb-4">
              GÜÇLENEN ALANLAR
            </h2>
            <div className="border-t border-border pt-4">
              <ul className="space-y-4">
                {strengthened.map((skill) => (
                  <li key={skill.skillId} className="border-b border-border pb-4 last:border-b-0 last:pb-0">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                      <span className="min-w-0 flex-1 text-body font-medium text-ink">
                        {skillDisplayName(skill)}
                      </span>
                      <span className="flex-shrink-0 text-body-sm text-muted">
                        {skill.correctAttempts} doğru / {skill.attempts} deneme
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}

        {/* Developing areas */}
        {developing.length > 0 && (
          <div>
            <h2 className="font-display text-2xl text-ink mb-4">
              GELİŞEN ALANLAR
            </h2>
            <div className="border-t border-border pt-4">
              <ul className="space-y-4">
                {developing.map((skill) => (
                  <li key={skill.skillId} className="border-b border-border pb-4 last:border-b-0 last:pb-0">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                      <span className="min-w-0 flex-1 text-body font-medium text-ink">
                        {skillDisplayName(skill)}
                      </span>
                      <span className="flex-shrink-0 text-body-sm text-muted">
                        Gelişiyor · {skill.attempts} deneme · {skill.correctAttempts} doğru
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}

        {/* Recurring patterns - concise summary */}
        {weakAreas.length > 0 && (
          <div>
            <h2 className="font-display text-2xl text-ink mb-4">
              TEKRAR EDEN NOKTALAR
            </h2>
            <div className="border-t border-border pt-4">
              <ul className="space-y-4">
                {weakAreas.map((area) => (
                  <li key={area.key} className="border-b border-border pb-4 last:border-b-0 last:pb-0">
                    <div className="flex items-baseline justify-between gap-4">
                      <span className="min-w-0 flex-1 text-body text-ink">{area.label}</span>
                      <span className="flex-shrink-0 text-body-sm text-muted">
                        {area.count} kez
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
              <div className="mt-4">
                <Button
                  variant="secondary"
                  onClick={() => goTo('tekrarlarim')}
                  size="md"
                >
                  Tekrar eden noktaları gör →
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Work summary - simple text, not a card */}
        <div className="border-t border-border pt-6">
          <p className="editorial-kicker">ÇALIŞMA ÖZETİN</p>
          <div className="space-y-3">
            <div className="flex items-baseline justify-between gap-4">
              <span className="text-body text-ink">Değerlendirilen soru</span>
              <span className="font-sora text-section-title font-semibold text-ink">
                {evaluated}
              </span>
            </div>
            <div className="flex items-baseline justify-between gap-4">
              <span className="text-body text-ink">Doğru çözülen</span>
              <span className="font-sora text-section-title font-semibold text-success">
                {correctCount}
              </span>
            </div>
            <div className="flex items-baseline justify-between gap-4">
              <span className="text-body text-ink">Çalışılan alan</span>
              <span className="font-sora text-section-title font-semibold text-ink">
                {skills.length}
              </span>
            </div>
          </div>
          <p className="mt-4 text-body-sm leading-relaxed text-muted">
            Yüzde göstermiyoruz. Bir konuyu gerçekten anladığını tek bir sayıyla
            söylemek istemiyoruz.
          </p>
        </div>
      </div>
    </PageContainer>
  );
}
