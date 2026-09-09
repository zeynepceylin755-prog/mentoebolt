import { ArrowRight, Check, AlertTriangle } from 'lucide-react';
import Reveal from '@/components/ui/Reveal';
import Eyebrow from '@/components/ui/Eyebrow';

function StudentCard({
  title,
  items,
  recommendation,
  tone,
}: {
  title: string;
  items: { label: string; status: 'done' | 'warn' | 'next' }[];
  recommendation: string;
  tone: 'dark' | 'accent';
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-5 sm:p-6">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-ink">{title}</span>
        <span className="text-[11px] text-muted">Örnek öğrenci</span>
      </div>
      <div className="mt-5 space-y-2.5">
        {items.map((item) => (
          <div key={item.label} className="flex items-center gap-3">
            {item.status === 'done' && (
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-success">
                <Check className="h-3 w-3 text-ink" />
              </span>
            )}
            {item.status === 'warn' && (
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-accent/20">
                <AlertTriangle className="h-3 w-3 text-accent" />
              </span>
            )}
            {item.status === 'next' && (
              <span className="flex h-5 w-5 items-center justify-center rounded-full border-2 border-accent">
                <ArrowRight className="h-2.5 w-2.5 text-accent" />
              </span>
            )}
            <span className={`text-sm ${item.status === 'done' ? 'text-ink' : item.status === 'warn' ? 'text-ink' : 'text-ink font-medium'}`}>
              {item.label}
            </span>
          </div>
        ))}
      </div>
      <div className={`mt-5 rounded-md p-3.5 ${tone === 'accent' ? 'bg-accent/10' : 'bg-bg'}`}>
        <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted">Mentora</p>
        <p className="mt-1 text-[13px] leading-relaxed text-ink">{recommendation}</p>
      </div>
    </div>
  );
}

export default function Personalization() {
  return (
    <section className="px-5 py-20 sm:px-6 lg:px-8 lg:py-28">
      <div className="mx-auto max-w-content">
        <Reveal className="max-w-2xl">
          <Eyebrow>Kişiselleştirilmiş Rehberlik</Eyebrow>
          <h2 className="mt-4 font-sora text-3xl font-semibold leading-tight tracking-tight text-ink sm:text-4xl lg:text-[44px]">
            Aynı sınıfta olmak, aynı öğrenme yolunda olmak anlamına gelmez.
          </h2>
        </Reveal>

        <div className="mt-12 grid gap-4 md:grid-cols-2">
          <Reveal delay={1}>
            <StudentCard
              title="Öğrenci A"
              items={[
                { label: 'Fonksiyonlar', status: 'done' },
                { label: 'Grafikler', status: 'done' },
                { label: 'Trigonometri', status: 'next' },
              ]}
              recommendation="Trigonometriye geçebilirsin."
              tone="dark"
            />
          </Reveal>
          <Reveal delay={2}>
            <StudentCard
              title="Öğrenci B"
              items={[
                { label: 'Fonksiyonlar', status: 'done' },
                { label: 'Grafikler', status: 'warn' },
                { label: 'Ön koşullar', status: 'next' },
              ]}
              recommendation="Önce grafik yorumlamadaki temel beceriyi güçlendirelim."
              tone="accent"
            />
          </Reveal>
        </div>

        <Reveal className="mt-10" delay={2}>
          <p className="max-w-2xl text-base leading-relaxed text-muted sm:text-lg">
            İki öğrenci aynı konuları görüyor olabilir. Ama Mentora onların aynı
            noktada olmadığını zaman içindeki verilerinden anlamaya çalışır.
          </p>
        </Reveal>
      </div>
    </section>
  );
}
