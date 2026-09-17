import { useCallback } from 'react';
import { ArrowRight, Clock3 } from 'lucide-react';
import {
  getNextRecommendation,
  getAttemptsForStudent,
  getMySkillProgress,
  type NextRecommendation,
  type AttemptResult,
} from '@/lib/studentJourney';
import { useCachedResource } from '@/lib/requestCache';
import { actionLabel, errorTypeLabel } from '@/lib/presentation';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import Loading from '@/components/ui/Loading';
import ErrorState from '@/components/ui/ErrorState';
import FirstStepState from '@/components/FirstStepState';
import PageContainer from '@/components/ui/PageContainer';
import PageHeader from '@/components/ui/PageHeader';
import type { StudentDestinationId } from '@/components/StudentShell';

interface BugunProps {
  /** Navigate to another product destination. */
  onNavigate?: (view: StudentDestinationId) => void;
  /** Reopens the optional, non-blocking first-login orientation. */
  onMeasureReadiness?: () => void;
}

/**
 * "Bugün" — answers a single question: what should I do today?
 *
 * Phase 7.4: Redesigned to lead with the topic name prominently, followed by
 * the action description. Uses real evidence from the recommendation instead of
 * generic messaging. Includes recent mistakes section. Every sentence is derived
 * from a backend field; when the backend has no evidence yet the page says so
 * honestly instead of showing placeholder data.
 */
export default function Bugun({ onNavigate, onMeasureReadiness }: BugunProps) {
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

  // One cached resource for all reads, so navigating away and back does not
  // re-issue the same requests.
  const { data, loading, error, refresh } = useCachedResource(
    'bugun/plan',
    async () => {
      const [next, attempts, skills] = await Promise.all([
        getNextRecommendation(),
        getAttemptsForStudent(3).catch(() => [] as AttemptResult[]),
        getMySkillProgress().catch(() => []),
      ]);
      return { next, attempts: attempts ?? [], skills: skills ?? [] };
    },
    'Bugün planı şu anda yüklenemedi. Lütfen tekrar dene.'
  );

  const recommendation: NextRecommendation | null = data?.next ?? null;
  const recentAttempts: AttemptResult[] = data?.attempts ?? [];
  const focusSkills = data?.skills?.slice(0, 3) ?? [];

  if (loading) {
    return (
      <PageContainer>
        <Loading state="loading" message="Bugün planı hazırlanıyor..." />
      </PageContainer>
    );
  }

  if (error) {
    return (
      <PageContainer>
        <ErrorState
          title="Bugün planına ulaşamadık"
          message={error}
          onRetry={() => void refresh()}
        />
      </PageContainer>
    );
  }

  // A brand-new student has no evidence at all. The backend answers this with an
  // ONBOARDING recommendation; do not invent a focus topic or an activity feed.
  if (!recommendation || recommendation.actionType === 'ONBOARDING') {
    return (
      <PageContainer>
        <PageHeader
          eyebrow="BUGÜN"
          title="Bugün ne yapmalıyım?"
          lead="Bir sonraki adımın, seni gerçekten tanıyan ilk öğrenme sinyalinden başlayacak."
        />
        <FirstStepState
          onMeasureReadiness={onMeasureReadiness}
          onBringQuestion={() => goTo('soru-getir')}
        />
      </PageContainer>
    );
  }

  const topicName = recommendation.topicName || actionLabel(recommendation.actionType);

  // Build evidence-based "Neden bugün?" section
  const evidence = recommendation.evidence;
  let evidenceText = '';
  if (evidence?.recentIncorrectCount && evidence.recentIncorrectCount > 0) {
    evidenceText = `Son denemelerinde burada ${evidence.recentIncorrectCount} kez takıldın.`;
  } else if (evidence?.repeatedErrorPattern) {
    evidenceText = 'Bu, tekrar eden bir örüntü.';
  } else if (evidence?.mastery !== undefined && evidence.mastery < 40) {
    evidenceText = 'Bu alan henüz tam olarak oturmamış görünüyor.';
  } else if (evidence?.trend === 'DECLINING') {
    evidenceText = 'Son denemelerinde bir gerileme görünüyor.';
  } else if (evidence?.evidenceCount !== undefined && evidence.evidenceCount < 3) {
    evidenceText = 'Henüz az veri var; bu yüzden öneri temkinli.';
  } else {
    evidenceText = recommendation.reason || 'Bu konuda çalışman öneriliyor.';
  }

  const recentActivity = recentAttempts.slice(0, 5);

  return (
    <PageContainer className="pb-20">
      <PageHeader
        eyebrow="BUGÜN"
        title="Bugün ne yapmalıyım?"
        lead="Bugünün odağı, son çalışmalarından çıkan bir sonraki anlamlı adım."
      />

      <div className="space-y-14">
        <section className="rounded-2xl border border-border bg-card p-5 sm:p-6 lg:grid lg:grid-cols-[minmax(0,1.15fr)_minmax(18rem,0.85fr)] lg:gap-14 lg:p-8">
          <div>
          <p className="editorial-kicker">ÖNERİLEN ÇALIŞMA</p>
          <h2 className="mt-4 font-display text-[2.25rem] leading-[1.05] text-ink sm:text-[3rem]">
            {topicName}
          </h2>

          <p className="mt-4 max-w-xl text-lg leading-relaxed text-ink">
            {actionLabel(recommendation.actionType)}
          </p>
          <p className="mt-5 max-w-xl text-base leading-relaxed text-muted">{evidenceText}</p>

          {recommendation.estimatedTimeMinutes > 0 && (
            <p className="mt-5 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.1em] text-muted">
              <Clock3 className="h-4 w-4" aria-hidden="true" />
              Yaklaşık {recommendation.estimatedTimeMinutes} dakika
            </p>
          )}

          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Button onClick={() => goTo('soru-getir')} size="lg">
              Soruyla çalışmaya başla
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Button>
            <Button onClick={() => goTo('soru-getir')} size="lg" variant="secondary">
              Sorumu getir
            </Button>
          </div>
          </div>

          <aside className="mt-6 grid gap-5 rounded-2xl border border-border bg-bg p-5 sm:p-6 lg:mt-0">
            <div className="grid min-h-32 place-items-center rounded-xl border border-border bg-card p-6">
              <span className="font-display text-3xl italic text-ink" aria-label="Fonksiyon bileşkesi görseli">
                (g<span className="mx-1 inline-block h-2.5 w-2.5 rounded-full border-[1.5px] border-ink align-middle" aria-hidden="true" />f)(x)
              </span>
            </div>
            <p className="editorial-kicker">NEDEN BUNU ÇALIŞIYORUZ?</p>
            <p className="mt-4 text-sm leading-relaxed text-ink">Son sorularındaki kanıtlar bu odağı destekliyor.</p>
            {focusSkills.length > 0 && (
              <div className="mt-6 border-t border-border pt-4">
                <p className="editorial-kicker">DAYANDIĞI ALANLAR</p>
                <ul className="mt-3 divide-y divide-border">
                  {focusSkills.map((skill) => (
                    <li key={skill.skillId} className="flex items-center justify-between gap-3 py-3 text-sm">
                      <span className="min-w-0 truncate text-ink">{skill.skillName || skill.skillId}</span>
                      <span className="flex-shrink-0 text-xs text-muted">{skill.attempts} deneme</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </aside>
        </section>

        {/* Recent activity section — only persisted attempts, never sample data. */}
        {recentActivity.length > 0 && (
          <div>
            <div className="mb-5 flex items-center justify-between gap-4">
                <div>
                  <p className="editorial-kicker">YAKIN GEÇMİŞ</p>
                  <h2 className="mt-2 font-display text-2xl text-ink">Son soruların</h2>
                </div>
              <button
                type="button"
                onClick={() => goTo('tekrarlarim')}
                className="min-h-[44px] text-right text-body-sm font-medium text-ink underline decoration-border decoration-1 underline-offset-4 transition-colors hover:decoration-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
              >
                Tekrarları gör
              </button>
            </div>
            <ul className="divide-y divide-border border-y border-border">
              {recentActivity.map((attempt) => (
                <li key={attempt.attemptId} className="py-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <p className="text-body font-medium text-ink">
                        {attempt.skillName || 'Henüz konuya bağlanmadı'}
                      </p>
                      <p className="mt-1 text-body-sm text-muted">
                        <span>{activityStatus(attempt)}</span>
                        {attempt.errorAnalysis?.errorType && (
                          <span> · {errorTypeLabel(attempt.errorAnalysis.errorType)}</span>
                        )}
                      </p>
                    </div>
                    <p className="flex-shrink-0 text-body-sm text-muted">
                      {formatRelativeDate(attempt.createdAt)}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Methodology explanation */}
        <section className="border-t border-border pt-6">
          <p className="editorial-kicker">MATEMATİKTE NEREDESİN?</p>
          <div className="mt-4 flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
            <p className="max-w-xl text-sm leading-relaxed text-muted">Gelişim ekranında güçlenen alanlarını ve tekrar eden sinyalleri gör.</p>
            <Button variant="secondary" onClick={() => goTo('gelisim')}>Gelişimi gör <ArrowRight className="h-4 w-4" aria-hidden="true" /></Button>
          </div>
        </section>

        <p className="border-t border-border pt-5 text-sm leading-relaxed text-muted">
          Bu adım çözdüğün sorulardan çıkarılan öğrenme verilerine dayanır. Yapay zekâ yalnızca açıklama metninde kullanılır.
        </p>
      </div>
    </PageContainer>
  );
}

function activityStatus(attempt: AttemptResult): string {
  if (attempt.evaluationState === 'NOT_EVALUABLE') return 'Değerlendirilemedi';
  if (!attempt.isCorrect && attempt.errorAnalysis) return 'Tekrar önerildi';
  return 'İncelendi';
}

/** Format a date relative to now (e.g., "Dün", "2 gün önce"). */
function formatRelativeDate(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return 'Bugün';
  if (diffDays === 1) return 'Dün';
  if (diffDays < 7) return `${diffDays} gün önce`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} hafta önce`;
  return date.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long' });
}
