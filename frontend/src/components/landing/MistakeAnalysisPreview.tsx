import { Check, Lightbulb, Minus } from 'lucide-react';

/**
 * The mistake-analysis visual: a student's work on a multiple-choice question,
 * with Mentora's analysis laid over it.
 *
 * The pedagogical point the drawing has to make is a negative one: Mentora does
 * **not** solve the question. So the overlay contains no answer, no solution
 * step and no algebra — only where the student stopped, which error category
 * that is, a hint phrased as a question the student can answer themselves, and
 * the underlying skill.
 *
 * Every label comes from the product's own vocabulary: the error category names
 * are the backend's persisted categories as the app renders them, and the hint
 * is the restraint the real guidance endpoint practises (there is no "solution"
 * mode). What is on screen is a static sample — no attempt, no score.
 */
export default function MistakeAnalysisPreview() {
  return (
    <figure className="overflow-hidden rounded-xl border border-border bg-card shadow-elevated">
      <figcaption className="border-b border-border bg-surface/60 px-4 py-2.5 text-[0.6875rem] uppercase tracking-[0.16em] text-muted sm:px-5">
        Temsili soru analizi · gerçek öğrenci verisi değil
      </figcaption>

      <div className="px-4 py-4 sm:px-5 sm:py-5">
        {/* The question, deliberately short: the interface is the subject, not
            the exercise itself. */}
        <p className="text-body-sm leading-relaxed text-ink">
          <span className="text-muted">Soru.</span> f(x) = 2x + 3 ve g(x) = x² olduğuna göre
          (f∘g)(2) kaçtır?
        </p>

        <ul className="mt-3.5 space-y-2">
          {[
            { key: 'A', label: '11' },
            { key: 'B', label: '13' },
            { key: 'C', label: '7' },
          ].map((option) => (
            <li
              key={option.key}
              className="flex items-center gap-2.5 rounded-md border border-border bg-paper px-3 py-2"
            >
              <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded border border-border text-[0.6875rem] text-muted">
                {option.key}
              </span>
              <span className="font-sora text-[0.8125rem] text-ink">{option.label}</span>
              {option.key === 'B' && (
                <>
                  <span className="h-4 w-4 flex-shrink-0 rounded-full border-border" aria-hidden="true" />
                  <span className="text-[0.6875rem] text-muted">işaretlediğin</span>
                </>
              )}
            </li>
          ))}
        </ul>

        <p className="mt-3 text-[0.6875rem] text-muted">
          Cevabın kaydedildi. Mentora soruyu senin yerine çözmez.
        </p>

        <div className="mt-5 border-t border-border pt-4">
          <p className="text-label font-medium uppercase tracking-eyebrow text-muted">
            Mentora analizi
          </p>

          <div className="mt-3 space-y-2.5">
            {/* Where the student stopped. */}
            <div className="flex items-start gap-2.5">
              <Minus className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-muted" aria-hidden="true" />
              <p className="text-[0.8125rem] leading-relaxed text-ink">
                İşlem sırası: g(2)&rsquo;yi hesaplayıp sonucu f&rsquo;e taşıma adımında durmuşsun.
              </p>
            </div>

            {/* The recorded category, in the backend's own wording. */}
            <div className="flex items-start gap-2.5">
              <span className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 rounded-full border-border" aria-hidden="true" />
              <p className="text-[0.8125rem] leading-relaxed text-ink">
                Hata kategorisi: <span className="text-muted">Ön koşul eksikliği</span>
              </p>
            </div>

            {/* A hint that stays a hint. */}
            <div className="flex items-start gap-2.5">
              <Lightbulb className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-accent" aria-hidden="true" />
              <p className="text-[0.8125rem] leading-relaxed text-ink">
                İpucu: bileşke işleminde hangi fonksiyon önce uygulanıyor?
              </p>
            </div>

            {/* The skill behind it, and what it opens. */}
            <div className="flex items-start gap-2.5">
              <Check className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-success" aria-hidden="true" />
              <div className="min-w-0">
                <p className="text-[0.8125rem] leading-relaxed text-ink">
                  İlgili beceri: <span className="text-muted">Bileşke fonksiyon</span>
                </p>
                <p className="mt-0.5 text-[0.6875rem] leading-relaxed text-muted">
                  Ön koşul: fonksiyonlarda tanım kümesi
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </figure>
  );
}
