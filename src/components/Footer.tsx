import { ArrowUpRight } from 'lucide-react';

const productLinks = [
  { label: 'Matematik Rehberim', href: '#matematik-yolum' },
  { label: 'Matematik Yolum', href: '#matematik-yolum' },
  { label: 'Soru Analizi', href: '#urun' },
  { label: 'Hata Analizi', href: '#urun' },
  { label: 'Öğrenci Profili', href: '#urun' },
  { label: 'Gelişim', href: '#urun' },
];

export default function Footer() {
  return (
    <footer className="px-5 py-12 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-content">
        <div className="grid gap-10 border-b border-border pb-12 md:grid-cols-[1.5fr_1fr_0.6fr]">
          <div>
            <a href="#top" className="font-sora text-lg font-semibold tracking-tight text-ink">
              MENTORA
            </a>
            <p className="mt-4 max-w-xs text-sm leading-relaxed text-muted">
              11. sınıf Matematik için, öğrenciyi zaman içinde tanıyan kişisel öğrenme sistemi.
            </p>
            <a
              href="mailto:merhaba@mentora.ai"
              className="mt-5 inline-flex items-center gap-2 text-sm font-medium text-ink hover:text-accent"
            >
              İletişim
              <ArrowUpRight className="h-3.5 w-3.5" />
            </a>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.1em] text-muted">Ürün</p>
            <div className="mt-4 grid grid-cols-2 gap-x-5 gap-y-3">
              {productLinks.map((link) => (
                <a key={link.label} href={link.href} className="text-sm text-nav transition-colors hover:text-ink">
                  {link.label}
                </a>
              ))}
            </div>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.1em] text-muted">Şirket</p>
            <div className="mt-4 flex flex-col gap-3">
              <a href="#hakkimizda" className="text-sm text-nav hover:text-ink">Hakkımızda</a>
              <a href="mailto:merhaba@mentora.ai" className="text-sm text-nav hover:text-ink">İletişim</a>
            </div>
          </div>
        </div>
        <div className="flex flex-col gap-3 pt-6 text-xs text-muted sm:flex-row sm:items-center sm:justify-between">
          <span>© 2026 Mentora AI</span>
          <div className="flex gap-5">
            <a href="#top" className="hover:text-ink">Gizlilik</a>
            <a href="#top" className="hover:text-ink">Kullanım Koşulları</a>
          </div>
        </div>
      </div>
    </footer>
  );
}
