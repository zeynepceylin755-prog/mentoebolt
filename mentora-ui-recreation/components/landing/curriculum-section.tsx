import Link from 'next/link'
import { ArrowRight, Calculator, Leaf, Target } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

type Col = {
  icon: LucideIcon
  label: string
  value: string
}

const COLS: Col[] = [
  { icon: Leaf, label: 'Tema', value: 'Fonksiyonlar' },
  {
    icon: Target,
    label: 'Öğrenme çıktısı',
    value: 'Fonksiyon bileşkelerini açıklar ve uygular.',
  },
  { icon: Calculator, label: 'Beceri', value: 'Bileşik fonksiyon hesaplama' },
]

export function CurriculumSection() {
  return (
    <section id="mufredat" className="bg-[#f2eee5]">
      <div className="mx-auto max-w-6xl px-5 pb-20 pt-4 sm:px-8">
        <div className="grid items-center gap-10 rounded-2xl border border-line bg-cream p-6 sm:p-8 md:grid-cols-[0.85fr_1.15fr] md:gap-12">
          <div>
            <h2 className="font-serif text-2xl leading-snug tracking-tight text-ink sm:text-3xl">
              Müfredatla tam uyumlu, kişiselleştirilmiş öğrenme.
            </h2>
            <p className="mt-4 max-w-sm text-[15px] leading-relaxed text-ink-soft">
              MEB Türkiye Yüzyılı Maarif Modeli&apos;ne uygun müfredat yapısıyla
              her öğrencinin seviyesine ve ihtiyacına özel bir öğrenme planı
              oluşturur.
            </p>
            <Link
              href="/dashboard"
              className="mt-6 inline-flex items-center gap-1.5 text-sm font-semibold text-ink transition-colors hover:text-terracotta"
            >
              Müfredatı İncele
              <ArrowRight className="size-4" />
            </Link>
          </div>

          <div className="rounded-2xl border border-line bg-paper p-5 sm:p-6">
            <div className="flex items-center gap-2">
              <span className="size-1.5 rounded-[2px] bg-sage" />
              <span className="text-sm font-semibold text-ink">
                11. Sınıf Matematik
              </span>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              {COLS.map((col) => (
                <div
                  key={col.label}
                  className="rounded-xl border border-line bg-cream p-4"
                >
                  <span className="grid size-8 place-items-center rounded-lg bg-sage-tint text-sage">
                    <col.icon className="size-4" strokeWidth={2} />
                  </span>
                  <p className="mt-3 text-xs font-medium uppercase tracking-wide text-ink-soft">
                    {col.label}
                  </p>
                  <p className="mt-1 text-[13px] font-medium leading-snug text-ink">
                    {col.value}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
