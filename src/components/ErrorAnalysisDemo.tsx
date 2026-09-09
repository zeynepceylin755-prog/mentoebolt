import { useEffect, useState } from 'react';
import { Check, CircleAlert, Sparkles, History, FlaskConical, RefreshCw } from 'lucide-react';
import Reveal from '@/components/ui/Reveal';
import Eyebrow from '@/components/ui/Eyebrow';

const steps = [
  { label: 'Soruyu getir', short: 'Getir' },
  { label: 'Çözümünü incele', short: 'İncele' },
  { label: 'Hatayı analiz et', short: 'Analiz' },
  { label: 'Geçmişle karşılaştır', short: 'Geçmiş' },
  { label: 'Hipotez oluştur', short: 'Hipotez' },
  { label: 'Doğrula', short: 'Doğrula' },
  { label: 'Rehberi güncelle', short: 'Güncelle' },
];

function DemoContent({ step }: { step: number }) {
  if (step === 0) {
    return (
      <div className="rounded-lg border border-border bg-card p-5">
        <p className="text-[10px] font-medium uppercase tracking-[0.1em] text-muted">Dışarıdan soru</p>
        <p className="mt-3 font-sora text-base leading-relaxed text-ink">
          Takıldığın soruyu paylaş — kendi testinden, kitabından veya çalışma kağıdından.
        </p>
        <div className="mt-4 flex items-center gap-2 rounded-md bg-bg px-3 py-2.5 text-[12px] text-muted">
          <span className="h-2 w-2 rounded-full bg-accent" />
          Soru yüklendi · Çözümün hazır
        </div>
      </div>
    );
  }

  if (step === 1) {
    return (
      <div className="rounded-lg border border-border bg-card p-5">
        <p className="text-[10px] font-medium uppercase tracking-[0.1em] text-muted">Çözüm incelemesi</p>
        <p className="mt-3 font-sora text-base leading-relaxed text-ink">
          y = 2x + 4 doğrusunun y-eksenini kestiği nokta nedir?
        </p>
        <div className="mt-4 rounded-md border border-accent/40 bg-accent/5 px-4 py-3">
          <span className="text-xs text-muted">Senin cevabın</span>
          <p className="mt-1 text-lg font-semibold text-accent">(4, 0)</p>
        </div>
        <p className="mt-3 text-[12px] leading-relaxed text-muted">
          Cevabın, y-eksenini x-eksenine karıştırmış olabileceğini düşündürüyor.
        </p>
      </div>
    );
  }

  if (step === 2) {
    return (
      <div className="rounded-lg border border-border bg-card p-5">
        <div className="flex items-start gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-accent/10">
            <CircleAlert className="h-4 w-4 text-accent" />
          </div>
          <div>
            <p className="text-sm font-semibold text-ink">Hata türü belirlenmeye çalışıldı</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {['Kavram', 'Beceri', 'Ön koşul', 'İşlem'].map((tag, i) => (
                <span key={tag} className={`rounded-md border px-2.5 py-1 text-[11px] ${i === 1 ? 'border-accent bg-accent/10 font-medium text-ink' : 'border-border text-muted'}`}>
                  {tag}
                </span>
              ))}
            </div>
            <p className="mt-3 text-[12px] leading-relaxed text-muted">
              Hata; kavram, beceri, ön koşul veya işlem kaynaklı olabilir.
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (step === 3) {
    return (
      <div className="rounded-lg border border-border bg-card p-5">
        <div className="flex items-start gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-bg">
            <History className="h-4 w-4 text-muted" />
          </div>
          <div>
            <p className="text-sm font-semibold text-ink">Geçmişle karşılaştırıldı</p>
            <p className="mt-2 text-[13px] leading-relaxed text-muted">
              Daha önce benzer bir hata yaptın mı?
            </p>
            <div className="mt-3 space-y-2">
              <div className="flex items-center gap-2 rounded-md bg-bg px-3 py-2 text-[12px]">
                <span className="h-1.5 w-1.5 rounded-full bg-accent" />
                <span className="text-ink">Test 2 — Grafik okuma hatası</span>
              </div>
              <div className="flex items-center gap-2 rounded-md bg-bg px-3 py-2 text-[12px]">
                <span className="h-1.5 w-1.5 rounded-full bg-accent" />
                <span className="text-ink">Getirdiğin soru — Eksen karışıklığı</span>
              </div>
            </div>
            <p className="mt-3 text-[12px] leading-relaxed text-muted">
              Benzer hatalar tekrar ediyor — bu bir örüntü olabilir.
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (step === 4) {
    return (
      <div className="rounded-lg border border-accent/30 bg-card p-5">
        <div className="flex items-start gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-accent/10">
            <FlaskConical className="h-4 w-4 text-accent" />
          </div>
          <div>
            <p className="text-sm font-semibold text-ink">Öğrenme hipotezi</p>
            <p className="mt-2 text-[13px] leading-relaxed text-muted">
              Bu hatanın altında hangi öğrenme boşluğu olabilir?
            </p>
            <div className="mt-3 rounded-md bg-accent/5 px-3 py-2.5">
              <p className="text-[12px] font-medium text-ink">
                Grafik → cebirsel temsil arasında bağlantı eksikliği
              </p>
            </div>
            <p className="mt-3 text-[11px] text-muted">
              Bu bir tahmindir — henüz kesin bir sonuç değil.
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (step === 5) {
    return (
      <div className="rounded-lg border border-border bg-card p-5">
        <p className="text-[10px] font-medium uppercase tracking-[0.1em] text-muted">Doğrulama sorusu</p>
        <p className="mt-3 font-sora text-base leading-relaxed text-ink">
          y = 3x − 5 doğrusunun y-eksenini kestiği nokta?
        </p>
        <div className="mt-4 flex gap-2">
          {['(0, -5)', '(-5, 0)', '(3, -5)'].map((answer, i) => (
            <span key={answer} className={`rounded-md border px-3 py-2 text-xs ${i === 0 ? 'border-success bg-success/10 font-semibold text-ink' : 'border-border text-muted'}`}>
              {answer}
            </span>
          ))}
        </div>
        <p className="mt-3 text-[12px] leading-relaxed text-muted">
          Benzer mantığı ölçen yeni bir soruyla hipotez kontrol ediliyor.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-success/40 bg-card p-5">
      <div className="flex items-start gap-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-success/10">
          <RefreshCw className="h-4 w-4 text-success" />
        </div>
        <div>
          <p className="text-sm font-semibold text-ink">Rehberin güncellendi</p>
          <p className="mt-2 text-[13px] leading-relaxed text-muted">
            Sonuç, matematik profilinin ve sonraki adımının bir parçası oldu.
          </p>
          <div className="mt-3 flex items-center gap-2 rounded-md bg-bg px-3 py-2 text-[12px]">
            <Sparkles className="h-3.5 w-3.5 text-accent" />
            <span className="text-ink">Yeni odak alanı: Grafik yorumlama</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function ErrorAnalysisDemo() {
  const [activeStep, setActiveStep] = useState(0);

  useEffect(() => {
    const interval = window.setInterval(() => {
      setActiveStep((current) => (current + 1) % steps.length);
    }, 3500);
    return () => window.clearInterval(interval);
  }, []);

  return (
    <section id="urun" className="px-5 py-20 sm:px-6 lg:px-8 lg:py-28">
      <div className="mx-auto max-w-content">
        <Reveal className="max-w-2xl">
          <Eyebrow>Hata Bir Sinyaldir</Eyebrow>
          <h2 className="mt-4 font-sora text-3xl font-semibold leading-tight tracking-tight text-ink sm:text-4xl lg:text-[44px]">
            Bir yanlış, hikâyenin sonu değil. Bir ipucu.
          </h2>
          <p className="mt-4 text-base leading-relaxed text-muted sm:text-lg">
            Mentora, yanlış cevabı yalnızca doğru cevapla karşılaştırmaz. Hatanın
            altında ne olabileceğini anlamaya çalışır.
          </p>
        </Reveal>

        <Reveal className="mt-12 rounded-lg border border-border bg-surface p-5 sm:p-8 lg:p-10" delay={1}>
          <div className="mb-8 overflow-x-auto pb-2 scrollbar-hide">
            <div className="flex min-w-max items-center gap-0">
              {steps.map((step, index) => (
                <button
                  key={step.short}
                  onClick={() => setActiveStep(index)}
                  className="group flex items-center"
                  aria-label={`${index + 1}. adım: ${step.label}`}
                >
                  <div className={`flex flex-col items-center gap-2 ${index <= activeStep ? 'text-ink' : 'text-muted'}`}>
                    <span className={`flex h-8 w-8 items-center justify-center rounded-full border text-[11px] font-semibold transition-all duration-300 ${index === activeStep ? 'border-accent bg-accent text-ink' : index < activeStep ? 'border-success bg-success text-ink' : 'border-border bg-card'}`}>
                      {index < activeStep ? <Check className="h-3.5 w-3.5" /> : index + 1}
                    </span>
                    <span className="text-[10px] font-medium sm:text-[11px]">{step.short}</span>
                  </div>
                  {index < steps.length - 1 && (
                    <div className={`mx-2 mt-[-17px] h-px w-6 transition-colors duration-300 sm:w-10 ${index < activeStep ? 'bg-success' : 'bg-border'}`} />
                  )}
                </button>
              ))}
            </div>
          </div>

          <div className="mx-auto max-w-2xl">
            <div className="mb-4 flex items-center justify-between">
              <span className="text-xs font-medium text-muted">{steps[activeStep].label}</span>
              <span className="text-xs text-muted">{activeStep + 1} / {steps.length}</span>
            </div>
            <div className="min-h-[200px] transition-all duration-300" key={activeStep}>
              <DemoContent step={activeStep} />
            </div>
          </div>
        </Reveal>

        <Reveal className="mt-8 max-w-2xl" delay={2}>
          <p className="font-sora text-lg font-medium leading-relaxed text-ink sm:text-xl">
            Mentora bir hatadan kesin sonuç çıkarmaya çalışmaz. Önce bir öğrenme
            hipotezi oluşturur, sonra bunu yeni verilerle doğrulamaya çalışır.
          </p>
        </Reveal>
      </div>
    </section>
  );
}
