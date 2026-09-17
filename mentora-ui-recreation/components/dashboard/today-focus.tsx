import { ArrowRight, BookOpen, RefreshCcw, Tag, Upload } from 'lucide-react'

export function TodayFocus() {
  return (
    <section className="rounded-2xl border border-line bg-paper p-5 sm:p-6">
      <div className="flex items-start justify-between gap-4">
        <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-terracotta">
          <span className="inline-block size-1.5 rounded-[2px] bg-terracotta" />
          Bugünün Odağın
        </p>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-sage-tint px-3 py-1 text-xs font-medium text-sage">
          <Tag className="size-3.5" strokeWidth={2} />
          Konu: Fonksiyonlar
        </span>
      </div>

      <div className="mt-4 grid gap-6 md:grid-cols-[1.5fr_1fr] md:items-center">
        <div>
          <h2 className="font-serif text-2xl tracking-tight text-ink sm:text-3xl">
            Fonksiyon Bileşkesi
          </h2>
          <p className="mt-2 max-w-md text-[15px] leading-relaxed text-ink-soft">
            Son sorularındaki benzer zorlanmalardan dolayı bugün buna
            odaklanmanı öneriyoruz.
          </p>

          <div className="mt-5 flex flex-wrap items-center gap-5 text-[13px] text-ink-soft">
            <span className="inline-flex items-center gap-1.5">
              <RefreshCcw className="size-4 text-terracotta" strokeWidth={2} />
              3 benzer hata
            </span>
            <span className="inline-flex items-center gap-1.5">
              <BookOpen className="size-4 text-sage" strokeWidth={2} />4 soru
            </span>
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-full bg-terracotta px-5 py-2.5 text-sm font-medium text-cream transition-colors hover:bg-terracotta-dark"
            >
              Çalışmaya başla
              <ArrowRight className="size-4" />
            </button>
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-full border border-line-strong bg-paper px-5 py-2.5 text-sm font-medium text-ink transition-colors hover:bg-cream"
            >
              <Upload className="size-4" />
              Soru getir
            </button>
          </div>
        </div>

        <div className="grid place-items-center rounded-2xl border border-line bg-cream p-8">
          <span className="inline-flex items-center gap-1.5 font-serif text-3xl italic text-ink">
            (g
            <span
              aria-hidden
              className="inline-block size-2.5 rounded-full border-[1.5px] border-ink"
            />
            f)(x)
          </span>
        </div>
      </div>
    </section>
  )
}
