import { ArrowDown } from 'lucide-react';
import Reveal from '@/components/ui/Reveal';
import Eyebrow from '@/components/ui/Eyebrow';

const levels = [
  'Tema',
  'Öğrenme çıktısı',
  'Mikro beceri',
  'Ön koşul',
  'Öğrencinin sorusu / testi',
  'Hata',
  'Öğrenme sinyali',
  'Öğrenci profili',
  'Matematik rehberi',
  'Sonraki adım',
];

export default function CurriculumSection() {
  return (
    <section className="border-y border-border bg-surface px-5 py-20 sm:px-6 lg:px-8 lg:py-28">
      <div className="mx-auto max-w-content">
        <Reveal className="max-w-2xl">
          <Eyebrow>Akademik Yapı</Eyebrow>
          <h2 className="mt-4 font-sora text-3xl font-semibold leading-tight tracking-tight text-ink sm:text-4xl lg:text-[44px]">
            11. sınıf Matematik için tasarlandı.
          </h2>
          <p className="mt-4 text-base leading-relaxed text-muted sm:text-lg">
            Mentora, 11. sınıf Matematik konularını tema, öğrenme çıktısı ve mikro
            beceriler üzerinden anlamaya yardımcı olan bir yapı sunar.
          </p>
        </Reveal>

        <Reveal className="mt-12 rounded-lg border border-border bg-card p-6 sm:p-8 lg:p-10" delay={1}>
          <div className="mx-auto flex max-w-3xl flex-col items-center">
            {levels.map((level, i) => (
              <div key={level} className="flex w-full flex-col items-center">
                <div
                  className={`flex w-full items-center justify-between rounded-lg border px-5 py-3.5 ${
                    i === 5
                      ? 'border-accent bg-accent/10'
                      : i === 6
                      ? 'border-accent/40 bg-accent/5'
                      : i >= 7
                      ? 'border-success/30 bg-success/5'
                      : 'border-border bg-bg'
                  }`}
                >
                  <span className="text-sm font-medium text-ink">{level}</span>
                  <span className="text-[11px] text-muted">{i + 1 < 10 ? `0${i + 1}` : i + 1}</span>
                </div>
                {i < levels.length - 1 && <ArrowDown className="my-1.5 h-4 w-4 text-border" />}
              </div>
            ))}
          </div>
          <p className="mx-auto mt-8 max-w-2xl text-center text-xs leading-relaxed text-muted">
            Bu yapı, öğrencinin yalnızca hangi konuda olduğunu değil; o konudaki hangi
            becerilerde zorlandığını, hangi ön koşulların etkili olabileceğini ve zaman
            içinde nasıl değiştiğini anlamaya yardımcı olmayı amaçlar.
          </p>
        </Reveal>
      </div>
    </section>
  );
}
