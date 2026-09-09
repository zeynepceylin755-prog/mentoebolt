import { ArrowRight } from 'lucide-react';
import Reveal from '@/components/ui/Reveal';
import Eyebrow from '@/components/ui/Eyebrow';
import ProgressBar from '@/components/ui/ProgressBar';

const stages = [
  {
    num: '01',
    title: 'Veri toplar',
    text: 'Çözdüğün testleri, getirdiğin soruları ve verdiğin cevapları bir araya getirir.',
  },
  {
    num: '02',
    title: 'Örüntüleri bulur',
    text: 'Tek bir yanlıştan fazlasına bakar. Benzer hataların ve zorlanmaların tekrar edip etmediğini anlamaya çalışır.',
  },
  {
    num: '03',
    title: 'Seni daha iyi tanır',
    text: 'Güçlü olduğun beceriler, zorlandığın alanlar, gelişimin ve öğrenme sinyallerin zaman içinde daha net hale gelir.',
  },
  {
    num: '04',
    title: 'Rehberini günceller',
    text: 'Yeni öğrendikleriyle sana hangi alana odaklanabileceğini ve sıradaki adımının ne olabileceğini yeniden gösterir.',
  },
];

export default function HowItWorks() {
  return (
    <section id="nasil-calisir" className="px-5 py-20 sm:px-6 lg:px-8 lg:py-28">
      <div className="mx-auto max-w-content">
        <Reveal className="max-w-2xl">
          <Eyebrow>Mentora'nın Mantığı</Eyebrow>
          <h2 className="mt-4 font-sora text-3xl font-semibold leading-tight tracking-tight text-ink sm:text-4xl lg:text-[44px]">
            Seni anlamaya çalışır. Sonra yol gösterir.
          </h2>
          <p className="mt-4 text-base leading-relaxed text-muted sm:text-lg">
            Mentora, tek bir sorudan veya tek bir testten kesin sonuç çıkarmaya
            çalışmaz. Farklı çalışmalarından gelen sinyalleri zaman içinde bir
            araya getirir.
          </p>
        </Reveal>

        <div className="mt-14 grid grid-cols-1 gap-6 md:grid-cols-2 lg:gap-8">
          {stages.map((stage, i) => (
            <Reveal key={stage.num} delay={((i % 2) + 1) as 1 | 2}>
              <div className="flex h-full flex-col rounded-lg border border-border bg-card p-6 sm:p-7">
                <div className="flex items-center gap-3">
                  <span className="font-sora text-2xl font-semibold text-border">
                    {stage.num}
                  </span>
                  <div className="h-px flex-1 bg-border" />
                  {stage.num === '01' && <span className="text-[10px] font-medium uppercase tracking-[0.08em] text-muted">Başlangıç</span>}
                  {stage.num === '04' && <span className="text-[10px] font-medium uppercase tracking-[0.08em] text-accent">Sürekli</span>}
                </div>
                <h3 className="mt-4 font-sora text-lg font-semibold text-ink">
                  {stage.title}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-muted">
                  {stage.text}
                </p>
                {stage.num === '02' && (
                  <div className="mt-5 rounded-md border border-border bg-bg p-3">
                    <p className="text-[11px] text-muted">Hata örüntüsü</p>
                    <div className="mt-2 flex items-center gap-2">
                      <ProgressBar value={45} color="#FF8A80" height="4px" className="flex-1" />
                      <span className="text-[11px] font-medium text-muted">3/7</span>
                    </div>
                    <p className="mt-2 text-[10px] text-muted">Benzer hata 3 soruda görüldü</p>
                  </div>
                )}
                {stage.num === '04' && (
                  <div className="mt-5 flex items-center gap-2 rounded-md border border-accent/30 bg-accent/5 p-3">
                    <ArrowRight className="h-3.5 w-3.5 text-accent" />
                    <span className="text-[11px] font-medium text-ink">Rehberin güncellendi</span>
                  </div>
                )}
              </div>
            </Reveal>
          ))}
        </div>

        <Reveal className="mt-16 text-center" delay={2}>
          <p className="font-sora text-xl font-medium text-ink sm:text-2xl">
            Her yeni çalışma, rehberinin biraz daha sana ait olmasını sağlar.
          </p>
        </Reveal>
      </div>
    </section>
  );
}
