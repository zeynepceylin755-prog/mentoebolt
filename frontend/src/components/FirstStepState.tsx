import { ArrowRight, Compass } from 'lucide-react';
import Button from '@/components/ui/Button';

interface FirstStepStateProps {
  onMeasureReadiness?: () => void;
  onBringQuestion: () => void;
}

/** A purposeful first-step surface for students with no learning evidence yet. */
export default function FirstStepState({
  onMeasureReadiness,
  onBringQuestion,
}: FirstStepStateProps) {
  return (
    <section className="border-y border-border py-10 sm:py-14" aria-labelledby="first-step-title">
      <div className="max-w-2xl">
        <div className="flex h-10 w-10 items-center justify-center border border-border text-accent" aria-hidden="true">
          <Compass className="h-5 w-5" />
        </div>
        <h2 id="first-step-title" className="mt-6 font-display text-[2rem] leading-tight text-ink sm:text-[2.5rem]">
          Henüz seni yeterince tanımıyoruz.
        </h2>
        <p className="mt-4 max-w-xl text-body leading-relaxed text-muted">
          İstersen kısa bir hazırbulunuşluk çalışmasıyla başlayabilir veya doğrudan ilk sorunu
          getirebilirsin. Her iki yol da geçerli; Mentora yolunu senin gerçek çözümlerinden çıkarır.
        </p>
        <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
          {onMeasureReadiness && (
            <Button type="button" size="lg" variant="secondary" onClick={onMeasureReadiness}>
              Hazırbulunuşluğumu ölç
            </Button>
          )}
          <Button type="button" size="lg" onClick={onBringQuestion}>
            İlk sorumu getir
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
      </div>
    </section>
  );
}
