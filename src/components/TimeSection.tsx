import { ArrowRight, ArrowDown } from 'lucide-react';
import Reveal from '@/components/ui/Reveal';
import Eyebrow from '@/components/ui/Eyebrow';

const timeline = [
  { day: 'Gün 1', label: 'Test sonucu', detail: 'İlk sinyaller', tone: 'neutral' },
  { day: 'Gün 3', label: 'Yeni sorular', detail: 'Beceri sinyali', tone: 'neutral' },
  { day: 'Gün 7', label: 'Tekrarlayan hata', detail: 'Örüntü beliriyor', tone: 'accent' },
  { day: 'Gün 14', label: 'Gelişim sinyali', detail: 'İlerleme görülüyor', tone: 'success' },
];

export default function TimeSection() {
  return (
    <section className="border-y border-border bg-surface px-5 py-20 sm:px-6 lg:px-8 lg:py-28">
      <div className="mx-auto max-w-content">
        <Reveal className="max-w-2xl">
          <Eyebrow>Zamanla Daha İyi Tanır</Eyebrow>
          <h2 className="mt-4 font-sora text-3xl font-semibold leading-tight tracking-tight text-ink sm:text-4xl lg:text-[44px]">
            Mentora seni bir günde tanımaz.
          </h2>
          <p className="mt-4 text-base leading-relaxed text-muted sm:text-lg">
            Her çözdüğün test, her getirdiğin soru ve her yaptığın hata Mentora'ya
            senin hakkında yeni bir şey söyler.
          </p>
        </Reveal>

        <Reveal className="mt-8 max-w-2xl" delay={1}>
          <div className="space-y-4 text-base leading-relaxed text-muted">
            <p>
              İlk gün sadece birkaç sinyal görür. Zamanla bu sinyaller birleşir.
            </p>
            <p>
              Hangi becerilerde güçlü olduğunu, nerelerde tekrar tekrar zorlandığını
              ve hangi alanlarda geliştiğini daha iyi anlamaya başlar.
            </p>
          </div>
        </Reveal>

        <Reveal className="mt-12" delay={2}>
          <div className="hidden lg:block">
            <div className="flex items-stretch gap-0">
              {timeline.map((item, i) => (
                <div key={item.day} className="flex flex-1 items-stretch">
                  <div className="flex-1 rounded-lg border border-border bg-card p-5">
                    <span className="text-[11px] font-medium uppercase tracking-[0.1em] text-muted">
                      {item.day}
                    </span>
                    <p className="mt-3 font-sora text-sm font-semibold text-ink">
                      {item.label}
                    </p>
                    <p className={`mt-1.5 text-[12px] ${item.tone === 'accent' ? 'text-accent' : item.tone === 'success' ? 'text-success' : 'text-muted'}`}>
                      {item.detail}
                    </p>
                  </div>
                  {i < timeline.length - 1 && (
                    <div className="flex items-center px-2">
                      <ArrowRight className="h-4 w-4 text-border" />
                    </div>
                  )}
                </div>
              ))}
              <div className="flex items-center px-2">
                <ArrowRight className="h-4 w-4 text-accent" />
              </div>
              <div className="flex-1 rounded-lg border border-accent bg-accent/10 p-5">
                <span className="text-[11px] font-medium uppercase tracking-[0.1em] text-accent">
                  Sonuç
                </span>
                <p className="mt-3 font-sora text-sm font-semibold text-ink">
                  Matematik rehberin
                </p>
                <p className="mt-1.5 text-[12px] text-ink">
                  Daha kişisel hale gelir
                </p>
              </div>
            </div>
          </div>

          <div className="lg:hidden">
            <div className="space-y-0">
              {timeline.map((item, i) => (
                <div key={item.day} className="flex flex-col items-center">
                  <div className="w-full rounded-lg border border-border bg-card p-4">
                    <span className="text-[11px] font-medium uppercase tracking-[0.1em] text-muted">
                      {item.day}
                    </span>
                    <p className="mt-2 font-sora text-sm font-semibold text-ink">
                      {item.label}
                    </p>
                    <p className={`mt-1 text-[12px] ${item.tone === 'accent' ? 'text-accent' : item.tone === 'success' ? 'text-success' : 'text-muted'}`}>
                      {item.detail}
                    </p>
                  </div>
                  {i < timeline.length - 1 && (
                    <ArrowDown className="my-2 h-4 w-4 text-border" />
                  )}
                </div>
              ))}
              <div className="flex flex-col items-center">
                <ArrowDown className="my-2 h-4 w-4 text-accent" />
                <div className="w-full rounded-lg border border-accent bg-accent/10 p-4">
                  <span className="text-[11px] font-medium uppercase tracking-[0.1em] text-accent">
                    Sonuç
                  </span>
                  <p className="mt-2 font-sora text-sm font-semibold text-ink">
                    Matematik rehberin
                  </p>
                  <p className="mt-1 text-[12px] text-ink">
                    Daha kişisel hale gelir
                  </p>
                </div>
              </div>
            </div>
          </div>
        </Reveal>

        <Reveal className="mt-12" delay={3}>
          <p className="font-sora text-xl font-medium text-ink sm:text-2xl">
            Zamanla oluşan bu anlayış, sana özel matematik rehberine dönüşür.
          </p>
        </Reveal>
      </div>
    </section>
  );
}
