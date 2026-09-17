import Image from 'next/image'
import Link from 'next/link'
import { ArrowRight } from 'lucide-react'

export function Hero() {
  return (
    <section id="urun" className="border-b border-line/70">
      <div className="mx-auto grid max-w-6xl items-center gap-10 px-5 py-14 sm:px-8 md:grid-cols-2 md:py-20">
        <div>
          <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-terracotta">
            <span className="inline-block size-1.5 rounded-[2px] bg-terracotta" />
            11. Sınıf Matematik
          </p>

          <h1 className="mt-5 font-serif text-5xl leading-[1.02] tracking-tight text-ink sm:text-6xl">
            Matematikte yolunu bul.
          </h1>

          <p className="mt-5 font-serif text-xl text-ink sm:text-2xl">
            Çok çalışmak değil, doğru şeyi çalışmak.
          </p>

          <p className="mt-4 max-w-md text-[15px] leading-relaxed text-ink-soft">
            Mentora, seviyeni ve öğrenme eksiklerini analiz ederek matematikte
            sıradaki doğru adımı bulmana yardımcı olur.
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link
              href="/dashboard"
              className="inline-flex items-center gap-2 rounded-full bg-terracotta px-6 py-3 text-sm font-medium text-cream transition-colors hover:bg-terracotta-dark"
            >
              Hemen Başla
              <ArrowRight className="size-4" />
            </Link>
            <Link
              href="#nasil-calisir"
              className="rounded-full border border-line-strong px-6 py-3 text-sm font-medium text-ink transition-colors hover:bg-paper"
            >
              Nasıl Çalışır?
            </Link>
          </div>
        </div>

        <div className="relative">
          <div className="overflow-hidden rounded-2xl border border-line bg-paper">
            <Image
              src="/images/hero-desk.png"
              alt="Mentora uygulamasının açık olduğu bir çalışma masası illüstrasyonu"
              width={720}
              height={620}
              priority
              className="h-full w-full object-cover"
            />
          </div>
        </div>
      </div>
    </section>
  )
}
