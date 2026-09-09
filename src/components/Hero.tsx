import { ArrowRight, ArrowDown } from 'lucide-react';
import ProductPreview from '@/components/ProductPreview';
import Eyebrow from '@/components/ui/Eyebrow';

export default function Hero() {
  return (
    <section
      id="top"
      className="relative px-5 pt-[76px] sm:px-6 lg:px-8"
    >
      <div className="mx-auto max-w-content">
        <div className="grid grid-cols-1 items-center gap-12 py-16 lg:grid-cols-2 lg:gap-16 lg:py-24">
          <div>
            <Eyebrow>11. Sınıf Matematik</Eyebrow>

            <h1 className="mt-5 font-sora text-[40px] font-semibold leading-[1.1] tracking-tight text-ink sm:text-[52px] lg:text-[60px]">
              Matematikte{' '}
              <span className="text-accent">yolunu bul.</span>
            </h1>

            <p className="mt-5 font-sora text-xl font-medium text-muted sm:text-2xl">
              Çok çalışmak değil, doğru şeyi çalışmak.
            </p>

            <p className="mt-5 max-w-[480px] text-[15px] leading-relaxed text-muted sm:text-base">
              Çözdüğün testler, getirdiğin sorular ve yaptığın hatalar Mentora'ya
              seni zaman içinde daha iyi tanıtır. Mentora, bu anlayıştan yola
              çıkarak sana özel matematik rehberini sürekli günceller.
            </p>

            <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
              <a
                href="#matematik-yolum"
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-ink px-6 py-3.5 text-sm font-medium text-bg transition-all duration-200 hover:bg-accent hover:text-ink"
              >
                Matematik Rehberimi Oluştur
                <ArrowRight className="h-4 w-4" />
              </a>
              <a
                href="#nasil-calisir"
                className="inline-flex items-center justify-center gap-2 rounded-lg border border-border px-6 py-3.5 text-sm font-medium text-ink transition-colors duration-200 hover:bg-surface"
              >
                Nasıl çalışıyor?
                <ArrowDown className="h-4 w-4" />
              </a>
            </div>
          </div>

          <div className="lg:pl-4">
            <ProductPreview />
          </div>
        </div>
      </div>
    </section>
  );
}
