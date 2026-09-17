import { useCallback } from 'react';
import { ArrowRight, Repeat } from 'lucide-react';
import { getAttemptsForStudent, type AttemptResult } from '@/lib/studentJourney';
import { useCachedResource } from '@/lib/requestCache';
import { errorTypeLabel } from '@/lib/presentation';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import Loading from '@/components/ui/Loading';
import ErrorState from '@/components/ui/ErrorState';
import EmptyState from '@/components/ui/EmptyState';
import PageContainer from '@/components/ui/PageContainer';
import PageHeader from '@/components/ui/PageHeader';
import type { StudentDestinationId } from '@/components/StudentShell';

interface TekrarlarimProps {
  onNavigate?: (view: StudentDestinationId) => void;
}

/** One recurring weakness, grouped from the student's own persisted attempts. */
interface RecurringPattern {
  /** Curriculum label resolved server-side, or null when no mapping exists yet. */
  label: string | null;
  /** Persisted error category, or null when none was produced. */
  errorType: string | null;
  count: number;
  lastSeen: string | null;
  /** The student's own answers — evidence, never an answer key. */
  examples: string[];
}

/**
 * "Tekrarlarım" — recurring patterns, not a wall of mistakes.
 *
 * Phase 7.4: Renamed from "Yanlışlarım" to emphasize learning patterns worth revisiting
 * rather than a mistake archive. The page is grouped so the student reads
 * "aynı yerde tekrar takılıyorsun" rather than "47 yanlışın var". Every group is built
 * from the persisted /question-attempts list; the grouping key is the backend's own
 * curriculum label plus its own persisted error category. Nothing is inferred in the browser:
 * attempts with no resolved label fall into an explicit "henüz etiketlenmedi"
 * group instead of being guessed into a topic.
 *
 * The canonical correct answer is never requested or displayed.
 */
export default function Tekrarlarim({ onNavigate }: TekrarlarimProps) {
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

  const { data, loading, error, refresh } = useCachedResource(
    'question-attempts/list',
    () => getAttemptsForStudent(50).then((rows) => rows ?? []),
    'Tekrarların şu anda yüklenemedi. Lütfen tekrar dene.'
  );

  const attempts: AttemptResult[] = data ?? [];

  if (loading) {
    return (
      <PageContainer>
        <Loading state="loading" message="Yanlışların hazırlanıyor..." />
      </PageContainer>
    );
  }

  if (error) {
    return (
      <PageContainer>
        <ErrorState
          title="Tekrarlarına ulaşamadık"
          message={error}
          onRetry={() => void refresh()}
        />
      </PageContainer>
    );
  }

  const incorrect = attempts.filter(
    (attempt) => !attempt.isCorrect && attempt.evaluationState !== 'NOT_EVALUABLE'
  );

  if (incorrect.length === 0) {
    return (
      <PageContainer>
        <PageHeader eyebrow="Tekrarlarım" title="Tekrar eden noktaların" />
        <EmptyState
          type="errors"
          title="Henüz analiz edilmiş bir tekrarın yok."
          description="Bir soru getir. Nerede zorlandığını birlikte bulalım."
          action={{ label: 'Soru Getir', onClick: () => goTo('soru-getir') }}
        />
      </PageContainer>
    );
  }

  const grouped = new Map<string, RecurringPattern>();

  for (const attempt of incorrect) {
    const label = attempt.skillName ?? null;
    const errorType = attempt.errorAnalysis?.errorType ?? null;
    const key = `${label ?? '__unlabelled__'}::${errorType ?? '__unclassified__'}`;

    const existing = grouped.get(key);
    if (existing) {
      existing.count += 1;
      existing.examples.push(attempt.answer ?? '');
      if (
        attempt.createdAt &&
        (!existing.lastSeen || attempt.createdAt > existing.lastSeen)
      ) {
        existing.lastSeen = attempt.createdAt;
      }
    } else {
      grouped.set(key, {
        label,
        errorType,
        count: 1,
        lastSeen: attempt.createdAt ?? null,
        examples: [attempt.answer ?? ''],
      });
    }
  }

  const patterns = [...grouped.values()]
    .map((pattern) => ({
      ...pattern,
      examples: pattern.examples.filter((example) => example.trim().length > 0),
    }))
    .sort((a, b) => b.count - a.count);

  const repeating = patterns.filter((pattern) => pattern.count > 1);

  return (
    <PageContainer>
      <PageHeader
        eyebrow="TEKRARLARIM"
        title="Tekrar eden noktaların"
        lead="Burada önemli olan kaç yanlışın olduğu değil, aynı yerde kaç kez takıldığın."
      />

      {repeating.length > 0 && (
        <Card variant="bordered" className="mb-8 rounded-2xl border-accent/30 bg-terracotta-tint p-6 sm:p-8">
          <div className="flex items-start gap-3">
            <Repeat className="mt-0.5 h-5 w-5 flex-shrink-0 text-accent" aria-hidden="true" />
            <div>
              <h2 className="font-display text-2xl text-ink">
                Aynı yerde tekrar takılıyorsun
              </h2>
              <p className="mt-2 text-body-sm leading-relaxed text-muted">
                Aşağıdaki {repeating.length} noktada birden fazla kez zorlandın.
                Bunları sırayla netleştirmek, yeni konuya geçmekten daha çok yol
                açar.
              </p>
            </div>
          </div>
        </Card>
      )}

      <ul className="divide-y divide-border border-y border-border">
        {patterns.map((pattern) => {
          const title = pattern.label ?? 'Henüz konuya bağlanmadı';
          const category = pattern.errorType
            ? errorTypeLabel(pattern.errorType)
            : null;
          const key = `${pattern.label ?? 'unlabelled'}::${pattern.errorType ?? 'unclassified'}`;

          return (
            <li key={key}>
              <article className="py-6 sm:py-7">
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
                  <h2 className="min-w-0 font-display text-2xl text-ink">
                    {title}
                  </h2>
                  <span className="flex-shrink-0 text-body-sm text-muted">
                    {pattern.count} kez
                  </span>
                </div>

                <p className="mt-2 text-body-sm text-muted">
                  {category ? category : 'Hata türü henüz etiketlenmedi'}
                </p>

                {pattern.label === null && (
                  <p className="mt-2 text-body-sm leading-relaxed text-muted">
                    Bu sorular henüz bir konuya bağlanmadı. Bağlantı kurulduğunda
                    burada hangi konu olduğunu göreceksin.
                  </p>
                )}

                {pattern.examples.length > 0 && (
                  <div className="mt-4 border-t border-border pt-4">
                    <p className="text-label font-medium uppercase tracking-wide text-muted">
                      Verdiğin cevaplar
                    </p>
                    <ul className="mt-2 flex-wrap gap-2">
                      {pattern.examples.slice(0, 5).map((example, index) => (
                        <li
                          key={`${key}-${index}`}
                          className="max-w-full truncate rounded-md bg-surface px-2.5 py-1 font-mono text-[12px] text-ink"
                          title={example}
                        >
                          {example}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {pattern.lastSeen && (
                  <p className="mt-4 text-body-sm text-muted">
                    Son karşılaşma: {formatDate(pattern.lastSeen)}
                  </p>
                )}

                <div className="mt-5">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => goTo('soru-getir')}
                  >
                    Bu noktayı tekrar et
                    <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </div>
              </article>
            </li>
          );
        })}
      </ul>

      <div className="mt-8">
        <Button size="lg" fullWidth onClick={() => goTo('soru-getir')}>
          Bu noktayı birlikte netleştirelim
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>

      <p className="mt-6 text-body-sm leading-relaxed text-muted">
        Bu liste yalnızca senin çözdüğün sorulardan oluşur. Doğru cevap burada
        gösterilmez; onu kendin bulman için yönlendirme sunulur.
      </p>
    </PageContainer>
  );
}

/** Compact, locale-aware date. Falls back to the raw value if unparseable. */
function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleDateString('tr-TR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}
