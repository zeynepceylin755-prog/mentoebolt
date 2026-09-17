import { ChevronRight, Lightbulb, Sigma, Spline, Triangle } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

type Question = {
  icon: LucideIcon
  title: string
  status: string
  badge: string
  tone: 'sage' | 'terracotta'
}

const QUESTIONS: Question[] = [
  {
    icon: Spline,
    title: 'Fonksiyonlar',
    status: '3 yanlış',
    badge: 'Analiz tamamlandı',
    tone: 'sage',
  },
  {
    icon: Sigma,
    title: 'Polinomlar',
    status: '1 yanlış',
    badge: 'Tekrar önerildi',
    tone: 'terracotta',
  },
  {
    icon: Triangle,
    title: 'Trigonometri',
    status: 'Doğru',
    badge: 'Analiz tamamlandı',
    tone: 'sage',
  },
]

export function InsightCards() {
  return (
    <div className="grid gap-5 md:grid-cols-[0.85fr_1.15fr]">
      <section className="flex flex-col rounded-2xl border border-line bg-paper p-5 sm:p-6">
        <div className="flex items-center gap-2.5">
          <span className="grid size-8 place-items-center rounded-lg bg-terracotta-tint text-terracotta">
            <Lightbulb className="size-4" strokeWidth={2} />
          </span>
          <h3 className="text-sm font-semibold text-ink">
            Neden bunu çalışıyoruz?
          </h3>
        </div>
        <p className="mt-4 text-[14px] leading-relaxed text-ink-soft">
          Tanım kümeleri konusunda tekrar eden bir karışıklık görüyoruz.
        </p>
        <button
          type="button"
          className="mt-auto inline-flex items-center gap-1 pt-5 text-sm font-semibold text-ink transition-colors hover:text-terracotta"
        >
          Detayları Gör
          <ChevronRight className="size-4" />
        </button>
      </section>

      <section className="rounded-2xl border border-line bg-paper p-5 sm:p-6">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-ink">Son soruların</h3>
          <button
            type="button"
            className="inline-flex items-center gap-0.5 text-xs font-medium text-ink-soft transition-colors hover:text-ink"
          >
            Tümünü Gör
            <ChevronRight className="size-3.5" />
          </button>
        </div>

        <ul className="mt-4 flex flex-col divide-y divide-line/70">
          {QUESTIONS.map((q) => (
            <li key={q.title} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
              <span
                className={
                  q.tone === 'sage'
                    ? 'grid size-9 shrink-0 place-items-center rounded-lg bg-sage-tint text-sage'
                    : 'grid size-9 shrink-0 place-items-center rounded-lg bg-terracotta-tint text-terracotta'
                }
              >
                <q.icon className="size-4" strokeWidth={2} />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-medium text-ink">
                  {q.title}
                </span>
                <span className="block text-xs text-ink-soft">{q.status}</span>
              </span>
              <span
                className={
                  q.tone === 'sage'
                    ? 'ml-auto hidden rounded-full bg-sage-tint px-2.5 py-1 text-[11px] font-medium text-sage sm:inline-block'
                    : 'ml-auto hidden rounded-full bg-terracotta-tint px-2.5 py-1 text-[11px] font-medium text-terracotta sm:inline-block'
                }
              >
                {q.badge}
              </span>
              <ChevronRight className="ml-auto size-4 shrink-0 text-line-strong sm:ml-2" />
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
