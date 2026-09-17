import { ArrowRight, Clock3, TrendingDown } from 'lucide-react';

/**
 * A still, realistic preview of the Mentora student application.
 *
 * This is a *marketing* component, so it is deliberately static: it renders the
 * shape of the real "Bugün" screen rather than calling any API. Everything it
 * shows is a sample of the product's own vocabulary, never a claim about a real
 * student:
 *
 *   - the deterministic daily focus with its reason and duration
 *   - the topic the step rests on, with the same status words the app uses
 *     (`Pekişti` / `Gelişiyor` / `Zayıf`)
 *   - the recorded error category behind the most recent mistake, in the same
 *     Turkish labels the analysis screen shows
 *   - the next step's focus area
 *
 * It intentionally contains no scores, no streaks, no percentages and no
 * counters, because the product does not present learning that way.
 */
export default function ProductPreview() {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card shadow-elevated">
      <div className="border-b border-border bg-surface/60 px-4 py-2.5 sm:px-5">
        <p className="text-[0.625rem] font-medium uppercase tracking-[0.16em] text-muted">
          Temsili ürün görünümü
        </p>
        <p className="mt-1 text-[0.6875rem] leading-relaxed text-muted">
          Bu gerçek bir öğrencinin verisi değil; Bugün ekranındaki akışın örneği.
        </p>
      </div>
      {/* Window chrome — enough to read as an application, not a browser mock. */}
      <div className="flex items-center justify-between gap-3 border-b border-border bg-surface/60 px-4 py-2.5 sm:px-5">
        <span className="font-sora text-[0.6875rem] font-semibold uppercase tracking-[0.18em] text-ink">
          Mentora
        </span>
        <span className="text-[0.6875rem] text-muted">11. Sınıf Matematik</span>
      </div>

      {/* The application's own navigation, with "Bugün" as the current screen. */}
      <div className="scrollbar-hide flex items-center gap-1 overflow-x-auto border-b border-border px-3 py-2 sm:px-4">
        {['Bugün', 'Soru Getir', 'Tekrarlarım', 'Gelişim'].map((item) => {
          const active = item === 'Bugün';
          return (
            <span
              key={item}
              className={[
                'whitespace-nowrap rounded-md px-2.5 py-1 text-[0.6875rem]',
                active ? 'bg-ink text-bg' : 'text-muted',
              ].join(' ')}
              aria-current={active ? 'page' : undefined}
            >
              {item}
            </span>
          );
        })}
      </div>

      <div className="space-y-3 px-4 py-4 sm:space-y-4 sm:px-5 sm:py-5">
        <div>
          <p className="text-label font-medium uppercase tracking-eyebrow text-muted">
            Bugün odağı
          </p>
          <p className="mt-1.5 font-display text-[1.25rem] leading-snug text-ink sm:text-[1.375rem]">
            Bileşke fonksiyon
          </p>
          <p className="mt-1.5 text-body-sm leading-relaxed text-muted">
            Son iki denemende fonksiyonlarda tanım kümesi ayrımı kaçmış.
          </p>
          <p className="mt-2 flex items-center gap-1.5 text-[0.6875rem] text-muted">
            <Clock3 className="h-3.5 w-3.5" aria-hidden="true" />
            Yaklaşık 20 dakika
          </p>
        </div>

        {/* The two things the step rests on, in the app's own status wording. */}
        <div className="rounded-lg border-border bg-paper px-3.5 py-3">
          <p className="text-[0.6875rem] font-medium uppercase tracking-[0.14em] text-muted">
            Bu adımın dayandığı alanlar
          </p>
          <ul className="mt-2.5 space-y-2">
            {[
              { name: 'Fonksiyonlarda tanım kümesi', status: 'Gelişiyor' },
              { name: 'Bileşke fonksiyon', status: 'Zayıf' },
            ].map((row) => (
              <li
                key={row.name}
                className="flex items-baseline justify-between gap-3 border-b border-border pb-2 last:border-b-0 last:pb-0"
              >
                <span className="min-w-0 truncate text-[0.8125rem] text-ink">{row.name}</span>
                <span className="flex-shrink-0 text-[0.6875rem] text-muted">{row.status}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* A learning signal, exactly as the product records it. */}
        <div className="rounded-lg border-border px-3.5 py-3">
          <p className="text-[0.6875rem] font-medium uppercase tracking-[0.14em] text-muted">
            Son öğrenme sinyalin
          </p>
          <div className="mt-2 flex items-start gap-2.5">
            <TrendingDown className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-accent" aria-hidden="true" />
            <div className="min-w-0">
              <p className="text-[0.8125rem] leading-snug text-ink">
                Bileşke fonksiyon · ön koşul eksikliği
              </p>
              <p className="mt-1 text-[0.6875rem] leading-relaxed text-muted">
                İki denemedir aynı ayrımda takılıyorsun.
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-border pt-3.5">
          <div className="min-w-0">
            <p className="text-[0.6875rem] uppercase tracking-[0.14em] text-muted">Sıradaki adım</p>
            <p className="mt-0.5 truncate text-[0.8125rem] text-ink">
              Bileşke fonksiyonda tanım kümesi
            </p>
          </div>
          <span className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-md bg-ink px-3 py-1.5 text-[0.6875rem] font-medium text-bg">
            Başla
            <ArrowRight className="h-3 w-3" aria-hidden="true" />
          </span>
        </div>
      </div>
    </div>
  );
}
