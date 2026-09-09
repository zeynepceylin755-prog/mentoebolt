import { ArrowDown, ArrowRight } from 'lucide-react';
import Reveal from '@/components/ui/Reveal';
import Eyebrow from '@/components/ui/Eyebrow';

const days = [
  {
    day: 'Pazartesi',
    title: '20 soruluk test',
    detail: 'Fonksiyonlar → iyi · Grafikler → zorlanıyor',
    tone: 'neutral',
  },
  {
    day: 'Çarşamba',
    title: 'Yeni test',
    detail: 'Grafik performansı → gelişiyor',
    tone: 'success',
  },
  {
    day: 'Cuma',
    title: 'Yeni test + getirilen soru',
    detail: 'Benzer hata → tekrar görüldü',
    tone: 'accent',
  },
];

export default function DailyTests() {
  return (
    <section className="px-5 py-20 sm:px-6 lg:px-8 lg:py-28">
      <div className="mx-auto max-w-content">
        <Reveal className="max-w-2xl">
          <Eyebrow>Her Gün Yeni Bir Veri</Eyebrow>
          <h2 className="mt-4 font-sora text-3xl font-semibold leading-tight tracking-tight text-ink sm:text-4xl lg:text-[44px]">
            Bugünkü test, yarının rehberini değiştirir.
          </h2>
          <p className="mt-4 text-base leading-relaxed text-muted sm:text-lg">
            Çözdüğün testleri gün gün Mentora'ya aktardıkça sistem yalnızca bugünkü
            performansına değil, zaman içindeki değişimine de bakmaya başlar.
          </p>
        </Reveal>

        <Reveal className="mt-12 rounded-lg border border-border bg-surface p-6 sm:p-8 lg:p-10" delay={1}>
          <div className="mx-auto max-w-2xl">
            {days.map((item, i) => (
              <div key={item.day} className="flex flex-col items-center">
                <div className="w-full rounded-lg border border-border bg-card p-4 sm:p-5">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-medium uppercase tracking-[0.1em] text-muted">
                      {item.day}
                    </span>
                    <span className={`h-2 w-2 rounded-full ${item.tone === 'accent' ? 'bg-accent' : item.tone === 'success' ? 'bg-success' : 'bg-border'}`} />
                  </div>
                  <p className="mt-2 font-sora text-sm font-semibold text-ink">{item.title}</p>
                  <p className={`mt-1.5 text-[12px] ${item.tone === 'accent' ? 'text-accent' : item.tone === 'success' ? 'text-success' : 'text-muted'}`}>
                    {item.detail}
                  </p>
                </div>
                {i < days.length - 1 && <ArrowDown className="my-2 h-4 w-4 text-border" />}
              </div>
            ))}

            <div className="flex flex-col items-center">
              <ArrowDown className="my-2 h-4 w-4 text-accent" />
              <div className="w-full rounded-lg border border-accent/30 bg-accent/5 p-4 sm:p-5">
                <span className="text-[11px] font-medium uppercase tracking-[0.1em] text-accent">
                  Mentora'nın yorumu
                </span>
                <p className="mt-2 text-sm font-medium leading-relaxed text-ink">
                  Grafik yorumlamada ilerleme var. Ancak belirli bir hata örüntüsü
                  devam ediyor.
                </p>
              </div>
            </div>

            <div className="flex flex-col items-center">
              <ArrowDown className="my-2 h-4 w-4 text-accent" />
              <div className="w-full rounded-lg border border-accent bg-accent/10 p-4 sm:p-5">
                <span className="text-[11px] font-medium uppercase tracking-[0.1em] text-accent">
                  Güncellenen rehber
                </span>
                <p className="mt-2 flex items-center gap-2 text-sm font-semibold text-ink">
                  Grafik yorumlama
                  <ArrowRight className="h-3.5 w-3.5 text-accent" />
                  Cebirsel temsil
                </p>
              </div>
            </div>
          </div>
        </Reveal>

        <Reveal className="mt-8" delay={2}>
          <p className="font-sora text-lg font-medium text-ink sm:text-xl">
            Mentora'nın seni tanıması tek bir testle değil, zaman içinde gerçekleşir.
          </p>
        </Reveal>
      </div>
    </section>
  );
}
