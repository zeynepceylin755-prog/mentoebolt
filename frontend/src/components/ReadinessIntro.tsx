import { ArrowRight, Clock3, SkipForward } from 'lucide-react';
import Button from '@/components/ui/Button';

interface ReadinessIntroProps {
  onStart: () => void;
  onSkip: () => void;
}

/**
 * A non-blocking first-login orientation. The assessment engine is not exposed
 * until the backend can provide a student-facing question discovery contract,
 * so the primary action starts the same honest first-question path instead of a
 * fake quiz or a fabricated result.
 */
export default function ReadinessIntro({ onStart, onSkip }: ReadinessIntroProps) {
  return (
    <div className="min-h-screen bg-bg text-ink">
      <header className="border-b border-border px-5 py-5 sm:px-8">
        <div className="mx-auto flex max-w-content items-center justify-between">
          <span className="font-display text-lg uppercase tracking-[0.22em] text-ink">Mentora</span>
          <span className="text-body-sm text-muted">11. sınıf matematik</span>
        </div>
      </header>

      <main className="px-5 py-12 sm:px-8 sm:py-20 lg:px-12">
        <div className="mx-auto grid w-full max-w-content gap-12 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:gap-24">
          <div>
            <p className="text-label font-medium uppercase tracking-eyebrow text-accent">İlk adım</p>
            <h1 className="mt-5 max-w-xl font-display text-[2.5rem] leading-[1.08] tracking-[-0.025em] text-ink sm:text-[3.25rem]">
              Önce seni biraz tanıyalım.
            </h1>
            <p className="mt-6 max-w-xl text-body leading-relaxed text-muted sm:text-lg">
              Kısa bir hazırbulunuşluk çalışmasıyla matematikte hangi konularda güçlü olduğunu
              ve nereden başlamanın daha anlamlı olacağını birlikte bulabiliriz.
            </p>

            <div className="mt-6 inline-flex min-h-[44px] items-center gap-2 border-y border-border py-3 text-body-sm text-ink">
              <Clock3 className="h-4 w-4 text-accent" aria-hidden="true" />
              Yaklaşık 10 dakika
            </div>

            <p className="mt-5 max-w-lg text-body-sm leading-relaxed text-muted">
              Hazırbulunuşluk akışı şu an devreye alınmadı. Başlayalım dediğinde ilk sorunu getirerek
              aynı öğrenme haritasını gerçek çözümünden oluşturmaya başlayacağız.
            </p>
          </div>

          <section className="self-start border-y border-border" aria-labelledby="readiness-path-title">
            <div className="border-b border-border py-5">
              <h2 id="readiness-path-title" className="font-display text-2xl text-ink">
                Başlangıç haritan nasıl oluşacak?
              </h2>
              <p className="mt-2 max-w-xl text-body-sm leading-relaxed text-muted">
                Bir puan vermek yerine, kendi sorularından gelen kanıtları sıraya koyacağız.
              </p>
            </div>

            <ol>
              <li className="grid grid-cols-[auto_minmax(0,1fr)] gap-4 border-b border-border py-5">
                <span className="font-sora text-sm tabular-nums text-accent">01</span>
                <div>
                  <h3 className="font-medium text-ink">Soruyu getir</h3>
                  <p className="mt-1 text-body-sm leading-relaxed text-muted">
                    Kendi çözümünü ve nerede durduğunu paylaş.
                  </p>
                </div>
              </li>
              <li className="grid grid-cols-[auto_minmax(0,1fr)] gap-4 border-b border-border py-5">
                <span className="font-sora text-sm tabular-nums text-accent">02</span>
                <div>
                  <h3 className="font-medium text-ink">Zorlandığın yeri gör</h3>
                  <p className="mt-1 text-body-sm leading-relaxed text-muted">
                    Mentora’nın backend analizinden gelen sinyali birlikte okuyalım.
                  </p>
                </div>
              </li>
              <li className="grid grid-cols-[auto_minmax(0,1fr)] gap-4 py-5">
                <span className="font-sora text-sm tabular-nums text-accent">03</span>
                <div>
                  <h3 className="font-medium text-ink">Sıradaki adımı seç</h3>
                  <p className="mt-1 text-body-sm leading-relaxed text-muted">
                    Tekrar etmen gereken beceriyi gerçek kanıt oluştuğunda göreceksin.
                  </p>
                </div>
              </li>
            </ol>

            <div className="flex flex-col gap-3 border-t border-border py-5 sm:flex-row sm:items-center">
              <Button type="button" size="lg" onClick={onStart}>
                Başlayalım
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Button>
              <Button type="button" size="lg" variant="ghost" onClick={onSkip}>
                <SkipForward className="h-4 w-4" aria-hidden="true" />
                Şimdilik geç
              </Button>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
