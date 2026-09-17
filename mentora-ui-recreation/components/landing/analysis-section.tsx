import Link from 'next/link'
import {
  ArrowRight,
  BookOpen,
  CircleAlert,
  ImageUp,
  ShieldAlert,
  Waypoints,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

type Item = {
  icon: LucideIcon
  tone: 'sage' | 'terracotta'
  label: string
  desc: string
}

const ITEMS: Item[] = [
  { icon: BookOpen, tone: 'sage', label: 'Konu', desc: 'Fonksiyonlar' },
  {
    icon: ShieldAlert,
    tone: 'terracotta',
    label: 'Zorlanılan alan',
    desc: 'Fonksiyon bileşkesi',
  },
  {
    icon: CircleAlert,
    tone: 'terracotta',
    label: 'Olası hata',
    desc: 'Tanım kümelerini eşleştirmede karışıklık',
  },
  {
    icon: Waypoints,
    tone: 'sage',
    label: 'Sonraki adım',
    desc: 'Bileşke fonksiyonlarda tanım kümesi ilişkisini tekrar et.',
  },
]

export function AnalysisSection() {
  return (
    <section className="border-b border-line/70 bg-[#f2eee5]">
      <div className="mx-auto max-w-6xl px-5 py-16 sm:px-8 md:py-20">
        <div className="grid items-center gap-10 md:grid-cols-2 md:gap-14">
          <div>
            <h2 className="font-serif text-3xl leading-tight tracking-tight text-ink sm:text-4xl">
              Soru <span className="text-terracotta">→</span> Analiz{' '}
              <span className="text-terracotta">→</span>
              <br className="hidden sm:block" /> Doğru Adım
            </h2>
            <p className="mt-5 max-w-md text-[15px] leading-relaxed text-ink-soft">
              Mentora, sadece doğru cevabı vermez. Nerede zorlandığını anlar ve
              sana en doğru öğrenme adımını önerir.
            </p>
            <Link
              href="#mufredat"
              className="mt-6 inline-flex items-center gap-1.5 text-sm font-semibold text-ink transition-colors hover:text-terracotta"
            >
              Ürünü Keşfet
              <ArrowRight className="size-4" />
            </Link>
          </div>

          <div className="grid gap-4 rounded-2xl border border-line bg-paper p-5 sm:grid-cols-2 sm:p-6">
            <div className="flex flex-col">
              <div className="flex items-center justify-between">
                <span className="font-serif text-base font-semibold text-ink">
                  Soru Analizi
                </span>
                <span className="inline-flex items-center gap-1 rounded-full bg-sage-tint px-2.5 py-1 text-[11px] font-medium text-sage">
                  <span className="size-1.5 rounded-full bg-sage" />
                  Demo
                </span>
              </div>

              <div className="mt-4 rounded-xl border border-line bg-cream p-4">
                <p className="font-serif text-sm italic leading-relaxed text-ink">
                  f(x) = 2x + 1 ve g(x) = x²
                  <br />
                  olduğuna göre, (g
                  <span
                    aria-hidden
                    className="mx-1 inline-block size-1.5 rounded-full border border-ink align-middle"
                  />
                  f)(1) kaçtır?
                </p>
              </div>

              <button
                type="button"
                className="mt-4 inline-flex items-center justify-center gap-2 rounded-lg border border-line-strong bg-paper px-3 py-2.5 text-xs font-medium text-ink-soft"
              >
                <ImageUp className="size-4" />
                Soru görselini yükle
              </button>
            </div>

            <div className="sm:border-l sm:border-line sm:pl-5">
              <p className="text-xs font-semibold uppercase tracking-wider text-ink-soft">
                Mentora Analizi
              </p>
              <ul className="mt-3 flex flex-col gap-3">
                {ITEMS.map((item) => (
                  <li key={item.label} className="flex items-start gap-3">
                    <span
                      className={
                        item.tone === 'sage'
                          ? 'mt-0.5 grid size-7 shrink-0 place-items-center rounded-md bg-sage-tint text-sage'
                          : 'mt-0.5 grid size-7 shrink-0 place-items-center rounded-md bg-terracotta-tint text-terracotta'
                      }
                    >
                      <item.icon className="size-3.5" strokeWidth={2} />
                    </span>
                    <span>
                      <span className="block text-[13px] font-semibold text-ink">
                        {item.label}
                      </span>
                      <span className="block text-[13px] leading-snug text-ink-soft">
                        {item.desc}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
