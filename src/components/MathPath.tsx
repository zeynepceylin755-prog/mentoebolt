import { ArrowRight, Clock, TrendingUp, Sparkles } from 'lucide-react';
import Reveal from '@/components/ui/Reveal';
import Eyebrow from '@/components/ui/Eyebrow';
import ProgressBar from '@/components/ui/ProgressBar';

const areas = [
  { label: 'GÜÇLÜ ALANLAR', item: 'Fonksiyon kavramı', value: 82, tone: 'success' },
  { label: 'GELİŞİYOR', item: 'Fonksiyonlar', value: 74, tone: 'neutral', trend: 'up' },
  { label: 'ODAĞIMIZ', item: 'Grafik yorumlama', value: 61, tone: 'accent' },
  { label: 'YENİ SİNYAL', item: 'Trigonometri', value: null, tone: 'muted' },
];

export default function MathPath() {
  return (
    <section id="matematik-yolum" className="border-y border-border bg-surface px-5 py-20 sm:px-6 lg:px-8 lg:py-28">
      <div className="mx-auto max-w-content">
        <Reveal className="max-w-2xl">
          <Eyebrow>Matematik Rehberin</Eyebrow>
          <h2 className="mt-4 font-sora text-3xl font-semibold leading-tight tracking-tight text-ink sm:text-4xl lg:text-[44px]">
            Rehberin seninle birlikte değişir.
          </h2>
          <p className="mt-4 text-base leading-relaxed text-muted sm:text-lg">
            İlk gün yalnızca başlangıç noktanı görür. Her yeni test, soru ve hata
            ona yeni bir şey öğretir.
          </p>
        </Reveal>

        <Reveal className="mt-12 overflow-hidden rounded-lg border border-border bg-card" delay={1}>
          <div className="grid lg:grid-cols-[1fr_0.8fr]">
            <div className="border-b border-border p-6 sm:p-8 lg:border-b-0 lg:border-r lg:p-10">
              <div className="mb-6 flex items-center justify-between">
                <div>
                  <p className="text-[11px] font-medium uppercase tracking-[0.1em] text-muted">Matematik rehberin</p>
                  <h3 className="mt-2 font-sora text-xl font-semibold text-ink">Mevcut görünüm</h3>
                </div>
                <span className="flex items-center gap-1.5 text-[11px] text-muted">
                  <span className="h-1.5 w-1.5 rounded-full bg-accent" />
                  Güncel
                </span>
              </div>

              <div className="space-y-4">
                {areas.map((area) => (
                  <div key={area.label} className="rounded-lg border border-border bg-bg p-4">
                    <div className="flex items-center justify-between">
                      <span className={`text-[10px] font-medium uppercase tracking-[0.1em] ${area.tone === 'accent' ? 'text-accent' : area.tone === 'success' ? 'text-success' : 'text-muted'}`}>
                        {area.label}
                      </span>
                      {area.trend === 'up' && <TrendingUp className="h-3.5 w-3.5 text-success" />}
                    </div>
                    <div className="mt-2 flex items-center justify-between">
                      <p className="text-sm font-semibold text-ink">{area.item}</p>
                      {area.value !== null && <span className="text-sm font-medium text-muted">{area.value}%</span>}
                    </div>
                    {area.value !== null ? (
                      <div className="mt-2">
                        <ProgressBar value={area.value} color={area.tone === 'accent' ? '#FF8A80' : area.tone === 'success' ? '#8FAF9A' : '#171717'} height="4px" />
                      </div>
                    ) : (
                      <p className="mt-2 text-[11px] text-muted">Henüz yeterli veri yok</p>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div className="flex flex-col justify-between p-6 sm:p-8 lg:p-10">
              <div>
                <div className="flex items-center justify-between">
                  <p className="text-[11px] font-medium uppercase tracking-[0.1em] text-muted">Sıradaki adım</p>
                  <Sparkles className="h-4 w-4 text-accent" />
                </div>
                <h3 className="mt-4 font-sora text-2xl font-semibold text-ink">Grafik yorumlama</h3>
                <p className="mt-3 text-sm leading-relaxed text-muted">
                  Son çalışmalarında bu beceriyle ilişkili benzer hata örüntüleri görüldü.
                </p>
                <div className="mt-5 rounded-lg bg-bg p-4">
                  <p className="text-[12px] leading-relaxed text-ink">
                    Önce grafik eksenlerini ve cebirsel temsili birlikte kontrol et.
                  </p>
                </div>
              </div>
              <div className="mt-8">
                <div className="mb-4 flex items-center gap-2 text-xs text-muted">
                  <Clock className="h-3.5 w-3.5" />14 dk
                </div>
                <button className="flex w-full items-center justify-center gap-2 rounded-lg bg-ink py-3.5 text-sm font-medium text-bg transition-colors hover:bg-accent hover:text-ink">
                  Rehberime Devam Et
                  <ArrowRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
