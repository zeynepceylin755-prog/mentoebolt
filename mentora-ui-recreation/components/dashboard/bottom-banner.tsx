import { ArrowRight, Sprout } from 'lucide-react'

export function BottomBanner() {
  return (
    <section className="flex flex-col items-start gap-4 rounded-2xl border border-line bg-[#f2eee5] p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
      <div className="flex items-center gap-4">
        <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-sage-tint text-sage">
          <Sprout className="size-5" strokeWidth={2} />
        </span>
        <div>
          <h3 className="font-serif text-lg text-ink sm:text-xl">
            Küçük adımlar, büyük hedefler.
          </h3>
          <p className="mt-1 text-[14px] text-ink-soft">
            Mentora ile matematikte kendine güvenen bir sen.
          </p>
        </div>
      </div>
      <button
        type="button"
        className="inline-flex shrink-0 items-center gap-2 rounded-full bg-terracotta px-5 py-2.5 text-sm font-medium text-cream transition-colors hover:bg-terracotta-dark"
      >
        Hemen Başla
        <ArrowRight className="size-4" />
      </button>
    </section>
  )
}
