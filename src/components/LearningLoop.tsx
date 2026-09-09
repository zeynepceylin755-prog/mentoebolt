import { ArrowDown, Check, RefreshCw } from 'lucide-react';
import Reveal from '@/components/ui/Reveal';
import Eyebrow from '@/components/ui/Eyebrow';

const items = [
  'Veri Topla',
  'Çöz',
  'Analiz Et',
  'Örüntüyü Bul',
  'Doğrula',
  'Geliş',
  'Tekrar Ölç',
  'Rehberi Güncelle',
];

export default function LearningLoop() {
  return (
    <section className="border-y border-border bg-surface px-5 py-20 sm:px-6 lg:px-8 lg:py-28">
      <div className="mx-auto max-w-content">
        <Reveal className="max-w-2xl">
          <Eyebrow>Öğrenme Döngüsü</Eyebrow>
          <h2 className="mt-4 font-sora text-3xl font-semibold leading-tight tracking-tight text-ink sm:text-4xl lg:text-[44px]">
            Öğrenme tek bir doğru cevaptan ibaret değil.
          </h2>
        </Reveal>

        <Reveal className="mt-12" delay={1}>
          <div className="mx-auto max-w-xl">
            {items.map((item, i) => (
              <div key={item} className="flex flex-col items-center">
                <div
                  className={`flex w-full items-center justify-between rounded-lg border px-5 py-4 sm:px-7 ${
                    i === 3
                      ? 'border-accent bg-accent/10'
                      : i === 7
                      ? 'border-accent/40 bg-card'
                      : 'border-border bg-card'
                  }`}
                >
                  <span className="font-sora text-base font-semibold text-ink">{item}</span>
                  <span className="text-xs text-muted">0{i + 1}</span>
                </div>
                {i < items.length - 1 && <ArrowDown className="my-2 h-4 w-4 text-border" />}
              </div>
            ))}
          </div>
          <div className="mx-auto mt-2 flex max-w-xl flex-col items-center">
            <RefreshCw className="h-5 w-5 text-accent" />
            <p className="mt-1 text-[11px] text-muted">Döngü başa döner</p>
          </div>
        </Reveal>

        <Reveal className="mt-10 text-center" delay={2}>
          <div className="inline-flex items-center gap-2 rounded-md bg-bg px-4 py-2.5 text-sm text-muted">
            <Check className="h-4 w-4 text-success" />
            Her tur, Mentora'nın seni biraz daha iyi anlamasını sağlar.
          </div>
        </Reveal>
      </div>
    </section>
  );
}
