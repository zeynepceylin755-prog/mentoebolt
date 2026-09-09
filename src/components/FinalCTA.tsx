import { ArrowRight } from 'lucide-react';
import Reveal from '@/components/ui/Reveal';
import Eyebrow from '@/components/ui/Eyebrow';

export default function FinalCTA() {
  return (
    <section id="erkek-erisim" className="border-y border-border bg-surface px-5 py-20 sm:px-6 lg:px-8 lg:py-28">
      <div className="mx-auto max-w-content">
        <Reveal className="max-w-2xl">
          <Eyebrow>Matematik Rehberini Oluştur</Eyebrow>
          <h2 className="mt-4 font-sora text-3xl font-semibold leading-tight tracking-tight text-ink sm:text-4xl lg:text-[52px]">
            Nerede olduğunu anla.{' '}
            <span className="text-accent">Sonraki adımını keşfet.</span>
          </h2>
          <p className="mt-5 max-w-lg text-base leading-relaxed text-muted sm:text-lg">
            Mentora'ya çalışmalarını göster. Zaman içinde seni daha iyi tanımasına
            ve sana özel matematik rehberini oluşturmasına izin ver.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <a
              href="mailto:merhaba@mentora.ai?subject=Erken erişim"
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-ink px-6 py-3.5 text-sm font-medium text-bg transition-colors hover:bg-accent hover:text-ink"
            >
              Erken Erişime Katıl
              <ArrowRight className="h-4 w-4" />
            </a>
            <a
              href="#top"
              className="inline-flex items-center justify-center rounded-lg border border-border px-6 py-3.5 text-sm font-medium text-ink transition-colors hover:bg-card"
            >
              Mentora'yı Keşfet
            </a>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
