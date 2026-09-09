import { ArrowRight } from 'lucide-react';
import Reveal from '@/components/ui/Reveal';
import Eyebrow from '@/components/ui/Eyebrow';

const traditional = ['Test', 'Puan', 'Yanlışlar'];
const mentora = ['Test / Soru', 'Hata', 'Örüntü', 'Öğrenme sinyali', 'Doğrulama', 'Öğrenci profili', 'Güncellenen rehber'];

export default function WhyMentora() {
  return (
    <section className="px-5 py-20 sm:px-6 lg:px-8 lg:py-28">
      <div className="mx-auto max-w-content">
        <Reveal className="max-w-2xl">
          <Eyebrow>Yaklaşımımız</Eyebrow>
          <h2 className="mt-4 font-sora text-3xl font-semibold leading-tight tracking-tight text-ink sm:text-4xl lg:text-[44px]">
            Daha fazla soru değil. Daha fazla anlayış.
          </h2>
        </Reveal>

        <div className="mt-12 grid gap-5 lg:grid-cols-2">
          {/* Traditional */}
          <Reveal delay={1}>
            <div className="h-full rounded-lg border border-border bg-card p-6 sm:p-8">
              <div className="flex items-center justify-between">
                <h3 className="font-sora text-lg font-semibold text-ink">Geleneksel çalışma</h3>
                <span className="text-[11px] text-muted">Odak: Sonucu görmek</span>
              </div>
              <div className="mt-6 flex flex-wrap items-center gap-2">
                {traditional.map((item, i) => (
                  <div key={item} className="flex items-center gap-2">
                    <span className="rounded-md bg-bg px-3 py-2 text-xs font-medium text-muted">{item}</span>
                    {i < traditional.length - 1 && <ArrowRight className="h-3 w-3 text-border" />}
                  </div>
                ))}
              </div>
            </div>
          </Reveal>

          {/* Mentora */}
          <Reveal delay={2}>
            <div className="h-full rounded-lg border border-accent/30 bg-accent/5 p-6 sm:p-8">
              <div className="flex items-center justify-between">
                <h3 className="font-sora text-lg font-semibold text-ink">Mentora</h3>
                <span className="text-[11px] font-medium text-accent">Odak: Yolu görmek</span>
              </div>
              <div className="mt-6 flex flex-wrap items-center gap-2">
                {mentora.map((item, i) => (
                  <div key={item} className="flex items-center gap-2">
                    <span className={`rounded-md px-3 py-2 text-xs font-medium ${i === mentora.length - 1 ? 'bg-accent text-ink' : 'bg-card text-ink'}`}>{item}</span>
                    {i < mentora.length - 1 && <ArrowRight className="h-3 w-3 text-accent" />}
                  </div>
                ))}
              </div>
            </div>
          </Reveal>
        </div>

        <Reveal className="mt-12" delay={2}>
          <p className="max-w-2xl text-base leading-relaxed text-muted sm:text-lg">
            Mentora, öğrencinin yerine karar vermeyi değil; öğrencinin kendi
            öğrenmesini daha anlaşılır hale getirmeyi amaçlar.
          </p>
        </Reveal>
      </div>
    </section>
  );
}
