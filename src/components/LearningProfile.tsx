import { ArrowRight, TrendingUp, AlertTriangle, Sparkles } from 'lucide-react';
import Reveal from '@/components/ui/Reveal';
import Eyebrow from '@/components/ui/Eyebrow';
import ProgressBar from '@/components/ui/ProgressBar';

const skills = [
  { label: 'Fonksiyonlar', value: 82 },
  { label: 'Grafikler', value: 61 },
  { label: 'Trigonometri', value: 74 },
  { label: 'Cebirsel temsil', value: 55 },
];

const errorPatterns = ['Grafik yorumlama', 'Cebirsel temsil'];

const newSignals = [
  { count: '3', label: 'benzer hata' },
  { count: '2', label: 'doğrulama çalışması' },
  { count: '1', label: 'yeni odak alanı' },
];

export default function LearningProfile() {
  return (
    <section className="bg-surface px-5 py-20 sm:px-6 lg:px-8 lg:py-28">
      <div className="mx-auto max-w-content">
        <Reveal className="max-w-2xl">
          <Eyebrow>Matematik Profilin</Eyebrow>
          <h2 className="mt-4 font-sora text-3xl font-semibold leading-tight tracking-tight text-ink sm:text-4xl lg:text-[44px]">
            Mentora seni tek bir puanla tanımlamaz.
          </h2>
          <p className="mt-4 text-base leading-relaxed text-muted sm:text-lg">
            Matematik profilin, zaman içinde oluşan bir öğrenme haritasıdır.
          </p>
        </Reveal>

        <Reveal className="mt-12 overflow-hidden rounded-lg border border-border bg-card" delay={1}>
          <div className="grid lg:grid-cols-3">
            {/* Skills */}
            <div className="border-b border-border p-6 sm:p-8 lg:border-b-0 lg:border-r lg:p-10">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[11px] uppercase tracking-[0.1em] text-muted">Becerilerin</p>
                  <h3 className="mt-2 font-sora text-lg font-semibold text-ink">Mevcut görünüm</h3>
                </div>
                <TrendingUp className="h-5 w-5 text-success" />
              </div>
              <div className="mt-8 space-y-5">
                {skills.map((skill, i) => (
                  <div key={skill.label}>
                    <div className="mb-2 flex justify-between text-sm">
                      <span className="text-ink">{skill.label}</span>
                      <span className="font-medium text-muted">{skill.value}%</span>
                    </div>
                    <ProgressBar value={skill.value} color={i === 1 ? '#FF8A80' : '#171717'} />
                  </div>
                ))}
              </div>
            </div>

            {/* Error patterns */}
            <div className="border-b border-border p-6 sm:p-8 lg:border-b-0 lg:border-r lg:p-10">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[11px] uppercase tracking-[0.1em] text-muted">Hata örüntüleri</p>
                  <h3 className="mt-2 font-sora text-lg font-semibold text-ink">Tekrarlayan</h3>
                </div>
                <AlertTriangle className="h-5 w-5 text-accent" />
              </div>
              <div className="mt-8 space-y-3">
                {errorPatterns.map((pattern) => (
                  <div key={pattern} className="flex items-center gap-3 rounded-md bg-bg p-3.5">
                    <span className="h-2 w-2 rounded-full bg-accent" />
                    <span className="text-sm text-ink">{pattern}</span>
                  </div>
                ))}
              </div>
              <div className="mt-6">
                <p className="text-[11px] uppercase tracking-[0.1em] text-muted">Gelişim</p>
                <p className="mt-2 text-sm text-ink">Son çalışmalar <span className="text-success font-medium">↑</span></p>
              </div>
            </div>

            {/* New signals */}
            <div className="p-6 sm:p-8 lg:p-10">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[11px] uppercase tracking-[0.1em] text-muted">Yeni sinyaller</p>
                  <h3 className="mt-2 font-sora text-lg font-semibold text-ink">Son analiz</h3>
                </div>
                <Sparkles className="h-5 w-5 text-accent" />
              </div>
              <div className="mt-8 space-y-3">
                {newSignals.map((signal) => (
                  <div key={signal.label} className="flex items-center gap-3 rounded-md border border-border bg-bg p-3.5">
                    <span className="font-sora text-lg font-semibold text-ink">{signal.count}</span>
                    <span className="text-sm text-muted">{signal.label}</span>
                  </div>
                ))}
              </div>
              <div className="mt-6 flex items-center gap-2 text-[12px] text-muted">
                <ArrowRight className="h-3 w-3 text-accent" />
                <span>Rehberin güncelleniyor</span>
              </div>
            </div>
          </div>
        </Reveal>

        <Reveal className="mt-6" delay={2}>
          <p className="text-[12px] text-muted">
            Bu bir ürün arayüzü örneğidir; gösterilen veriler tanıtım amaçlıdır.
          </p>
        </Reveal>
      </div>
    </section>
  );
}
