import { ArrowRight } from 'lucide-react'

type Node = {
  label: string
  value: string
  done?: boolean
}

const NODES: Node[] = [
  { label: 'Konu', value: 'Fonksiyonlar', done: true },
  { label: 'Beceri', value: 'Bileşik fonksiyon', done: true },
  { label: 'Seviye', value: 'Orta' },
]

export function ProgressSection() {
  return (
    <section className="rounded-2xl border border-line bg-paper p-5 sm:p-6">
      <div className="grid items-center gap-6 md:grid-cols-[1fr_1.1fr]">
        <div>
          <h2 className="font-serif text-xl tracking-tight text-ink sm:text-2xl">
            Matematikte neredesin?
          </h2>
          <p className="mt-2 max-w-sm text-[14px] leading-relaxed text-ink-soft">
            Gelişim yolculuğunu görmek için son analizlerine göz at.
          </p>
          <button
            type="button"
            className="mt-5 inline-flex items-center gap-2 rounded-full bg-sage px-5 py-2.5 text-sm font-medium text-cream transition-colors hover:bg-sage-dark"
          >
            Gelişimimi Gör
            <ArrowRight className="size-4" />
          </button>
        </div>

        <div className="rounded-xl border border-line bg-cream p-5">
          <div className="flex items-center justify-between">
            {NODES.map((node, i) => (
              <div key={node.label} className="flex flex-1 items-center">
                <div className="flex flex-col items-center text-center">
                  <span
                    className={
                      node.done
                        ? 'grid size-6 place-items-center rounded-full bg-sage text-[10px] font-semibold text-cream'
                        : 'grid size-6 place-items-center rounded-full border-2 border-terracotta bg-paper text-[10px] font-semibold text-terracotta'
                    }
                  >
                    {i + 1}
                  </span>
                  <span className="mt-2 text-xs font-semibold text-ink">
                    {node.label}
                  </span>
                  <span className="mt-0.5 text-[11px] leading-tight text-ink-soft">
                    {node.value}
                  </span>
                </div>
                {i < NODES.length - 1 && (
                  <span className="mx-1 mb-8 h-px flex-1 bg-line-strong" />
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
