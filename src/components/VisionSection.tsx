import { ArrowUpRight } from 'lucide-react';
import Reveal from '@/components/ui/Reveal';

export default function VisionSection() {
  return (
    <section id="hakkimizda" className="px-5 py-24 sm:px-6 lg:px-8 lg:py-40">
      <div className="mx-auto max-w-content">
        <Reveal>
          <p className="max-w-5xl font-sora text-3xl font-medium leading-[1.25] tracking-tight text-ink sm:text-4xl lg:text-6xl">
            Eğitim, öğrencinin sisteme uyduğu değil; sistemin öğrenciyi anlamaya
            başladığı yer olmalı.
          </p>
        </Reveal>

        <Reveal className="mt-10 border-t border-border pt-8" delay={1}>
          <p className="max-w-xl text-base leading-relaxed text-muted">
            Bugün 11. sınıf Matematikle başlıyoruz. Uzun vadede hedefimiz; öğrencinin
            ne bildiğini, nerelerde zorlandığını, hangi hataları tekrar ettiğini, zaman
            içinde nasıl geliştiğini ve sırada neye ihtiyacı olabileceğini anlayan
            kişisel bir öğrenme sistemi oluşturmak.
          </p>
        </Reveal>

        <Reveal className="mt-10 flex items-center gap-2" delay={2}>
          <span className="text-sm font-medium text-ink">Mentora'nın yönü</span>
          <ArrowUpRight className="h-4 w-4 text-accent" />
          <span className="text-sm font-medium text-accent">Öğrenciyi her gün biraz daha iyi anlamak.</span>
        </Reveal>
      </div>
    </section>
  );
}
