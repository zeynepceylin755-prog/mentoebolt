import { BookOpen, ClipboardList, Compass, FileSearch, HelpCircle, ListChecks, MapPinned, Route, Sparkles, Target, TrendingUp, Upload, UserRound } from 'lucide-react';
import Reveal from '@/components/ui/Reveal';
import Eyebrow from '@/components/ui/Eyebrow';

const groups = [
  {
    num: '01',
    title: 'Seni tanır',
    icon: UserRound,
    items: [
      { label: 'Matematik Seviye Tespiti', icon: Compass },
      { label: 'Test Sonuçları', icon: ClipboardList },
      { label: 'Öğrenci Profili', icon: UserRound },
      { label: 'Gelişim Takibi', icon: TrendingUp },
    ],
  },
  {
    num: '02',
    title: 'Hatalarını anlar',
    icon: FileSearch,
    items: [
      { label: 'Dışarıdan Soru Getir', icon: Upload },
      { label: 'Soru Analizi', icon: HelpCircle },
      { label: 'Hata Analizi', icon: FileSearch },
      { label: 'Yanlışlarım', icon: ClipboardList },
      { label: 'İkiz / Doğrulama Soruları', icon: ListChecks },
    ],
  },
  {
    num: '03',
    title: 'Rehberlik eder',
    icon: MapPinned,
    items: [
      { label: 'Matematik Rehberin', icon: Sparkles },
      { label: 'Matematik Yolum', icon: Route },
      { label: 'Günlük Öneriler', icon: Target },
      { label: 'Çalışma Planım', icon: BookOpen },
      { label: 'Sonraki Adım', icon: ArrowRightIcon },
    ],
  },
];

function ArrowRightIcon({ className }: { className?: string }) {
  return <span className={className}>→</span>;
}

export default function ProductModules() {
  return (
    <section className="border-y border-border bg-surface px-5 py-20 sm:px-6 lg:px-8 lg:py-28">
      <div className="mx-auto max-w-content">
        <Reveal className="max-w-2xl">
          <Eyebrow>Ürün Alanları</Eyebrow>
          <h2 className="mt-4 font-sora text-3xl font-semibold leading-tight tracking-tight text-ink sm:text-4xl lg:text-[44px]">
            Seni tanır, hatalarını anlar, rehberlik eder.
          </h2>
          <p className="mt-4 text-base leading-relaxed text-muted sm:text-lg">
            Mentora'nın her bölümü, öğrenme sürecinin farklı bir sorusuna cevap verir.
          </p>
        </Reveal>

        <div className="mt-12 grid gap-5 lg:grid-cols-3">
          {groups.map((group, gi) => (
            <Reveal key={group.title} delay={(gi + 1) as 1 | 2 | 3}>
              <div className="flex h-full flex-col rounded-lg border border-border bg-card p-5 sm:p-6">
                <div className="flex items-center gap-3 border-b border-border pb-5">
                  <span className="font-sora text-xl font-semibold text-border">{group.num}</span>
                  <div className="flex h-9 w-9 items-center justify-center rounded-md bg-bg">
                    <group.icon className="h-4 w-4 text-ink" />
                  </div>
                  <h3 className="font-sora text-lg font-semibold text-ink">{group.title}</h3>
                </div>
                <div className="mt-2 flex-1">
                  {group.items.map((item) => (
                    <div key={item.label} className="group flex items-center gap-3 border-b border-border py-3.5 last:border-0">
                      <item.icon className="h-4 w-4 shrink-0 text-muted transition-colors group-hover:text-accent" />
                      <span className="text-sm text-ink">{item.label}</span>
                      <span className="ml-auto h-1.5 w-1.5 rounded-full bg-border transition-colors group-hover:bg-accent" />
                    </div>
                  ))}
                </div>
                {group.num === '02' && (
                  <div className="mt-3 rounded-md border border-accent/30 bg-accent/5 px-3 py-2">
                    <p className="text-[11px] font-medium text-ink">
                      Kendi sorularını getir — Mentora'nın soru bankasına bağımlı değilsin.
                    </p>
                  </div>
                )}
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
