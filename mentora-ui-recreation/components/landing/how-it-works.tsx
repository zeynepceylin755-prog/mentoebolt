import { ArrowRight, Brain, FileUp, Target } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

type Step = {
  no: string
  icon: LucideIcon
  title: string
  desc: string
}

const STEPS: Step[] = [
  {
    no: '01',
    icon: FileUp,
    title: 'Soruyu getir',
    desc: 'Çözdüğün soruyu yükle ya da yaz. Mentora hemen analiz etmeye başlar.',
  },
  {
    no: '02',
    icon: Brain,
    title: 'Nerede takıldığını bul',
    desc: 'Yanlışlarını ve eksiklerini analiz ederek hangi beceride zorlandığını ortaya çıkarır.',
  },
  {
    no: '03',
    icon: Target,
    title: 'Sıradaki adımı çalış',
    desc: 'Sana özel hazırlanan öneri ve çalışma planıyla eksiklerini kapatırsın.',
  },
]

export function HowItWorks() {
  return (
    <section id="nasil-calisir" className="border-b border-line/70">
      <div className="mx-auto max-w-6xl px-5 py-16 sm:px-8 md:py-20">
        <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-terracotta">
          <span className="inline-block size-1.5 rounded-[2px] bg-terracotta" />
          Nasıl Çalışır?
        </p>
        <h2 className="mt-4 font-serif text-3xl tracking-tight text-ink sm:text-4xl">
          3 adımda kişisel öğrenme yolun
        </h2>

        <div className="mt-12 grid gap-10 md:grid-cols-3 md:gap-6">
          {STEPS.map((step, i) => (
            <div key={step.no} className="relative">
              <div className="flex items-center gap-4">
                <span className="grid size-11 place-items-center rounded-full bg-sage font-serif text-sm font-semibold text-cream">
                  {step.no}
                </span>
                <span className="grid size-11 place-items-center rounded-xl border border-line bg-paper text-sage">
                  <step.icon className="size-5" strokeWidth={1.75} />
                </span>
                {i < STEPS.length - 1 && (
                  <ArrowRight className="ml-auto hidden size-5 text-terracotta/70 md:block" />
                )}
              </div>

              <h3 className="mt-6 font-serif text-xl text-ink">{step.title}</h3>
              <p className="mt-2 max-w-xs text-[15px] leading-relaxed text-ink-soft">
                {step.desc}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
