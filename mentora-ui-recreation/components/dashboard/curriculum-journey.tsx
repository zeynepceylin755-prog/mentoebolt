import { BarChart3, ChevronRight, Leaf, Target, Waypoints } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

type Step = {
  icon: LucideIcon
  label: string
  title: string
  sub?: string
}

const STEPS: Step[] = [
  {
    icon: Leaf,
    label: 'Tema',
    title: 'İstatistiksel Araştırma Süreci',
    sub: '2 öğrenme çıktısı',
  },
  {
    icon: Target,
    label: 'Öğrenme çıktısı',
    title: 'Verileri düzenler ve yorumlar.',
  },
  {
    icon: BarChart3,
    label: 'Beceri',
    title: 'İstatistiksel verileri grafikle gösterme',
  },
]

export function CurriculumJourney() {
  return (
    <section className="rounded-2xl border border-line bg-paper p-5 sm:p-6">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2.5">
          <span className="grid size-8 place-items-center rounded-lg bg-sage-tint text-sage">
            <Waypoints className="size-4" strokeWidth={2} />
          </span>
          <h2 className="font-serif text-xl tracking-tight text-ink sm:text-2xl">
            Müfredat Yolculuğu
          </h2>
        </div>
        <button
          type="button"
          className="inline-flex items-center gap-0.5 text-xs font-medium text-ink-soft transition-colors hover:text-ink"
        >
          Tüm Müfredatı Gör
          <ChevronRight className="size-3.5" />
        </button>
      </div>

      <p className="mt-3 text-[14px] leading-relaxed text-ink-soft">
        11. sınıf matematik müfredatına uygun, kişiselleştirilmiş öğrenme planı.
      </p>

      <div className="mt-5 grid items-stretch gap-3 md:grid-cols-[1fr_auto_1fr_auto_1fr]">
        {STEPS.map((step, i) => (
          <div key={step.label} className="contents">
            <div className="rounded-xl border border-line bg-cream p-4">
              <span className="grid size-8 place-items-center rounded-lg bg-sage-tint text-sage">
                <step.icon className="size-4" strokeWidth={2} />
              </span>
              <p className="mt-3 text-xs font-medium uppercase tracking-wide text-ink-soft">
                {step.label}
              </p>
              <p className="mt-1 text-[13px] font-medium leading-snug text-ink">
                {step.title}
              </p>
              {step.sub && (
                <p className="mt-1 text-[11px] text-ink-soft">{step.sub}</p>
              )}
            </div>
            {i < STEPS.length - 1 && (
              <div className="hidden items-center justify-center md:flex">
                <ChevronRight className="size-5 text-terracotta/70" />
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  )
}
