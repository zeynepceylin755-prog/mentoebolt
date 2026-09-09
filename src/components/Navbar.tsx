import { useEffect, useState } from 'react';
import { Menu, X, ArrowRight } from 'lucide-react';

const navLinks = [
  { label: 'Ürün', href: '#urun' },
  { label: 'Nasıl Çalışır?', href: '#nasil-calisir' },
  { label: 'Hakkımızda', href: '#hakkimizda' },
];

export default function Navbar() {
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    document.body.style.overflow = menuOpen ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [menuOpen]);

  return (
    <header
      className={`fixed inset-x-0 top-0 z-50 bg-bg transition-colors duration-300 ${
        scrolled ? 'border-b border-border' : 'border-b border-transparent'
      }`}
      style={{ height: '76px' }}
    >
      <nav className="mx-auto flex h-full max-w-content items-center justify-between px-5 sm:px-6 lg:px-8">
        <a
          href="#top"
          className="font-sora text-[18px] font-semibold tracking-tight text-ink"
          aria-label="Mentora ana sayfa"
        >
          MENTORA
        </a>

        <div className="hidden items-center gap-8 md:flex">
          {navLinks.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="text-[14px] font-medium text-nav transition-colors duration-200 hover:text-ink"
            >
              {link.label}
            </a>
          ))}
        </div>

        <div className="hidden md:block">
          <a
            href="#erkek-erisim"
            className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-ink px-6 py-2.5 text-[14px] font-medium text-bg transition-all duration-200 hover:bg-accent hover:text-ink"
            style={{ width: '132px', height: '42px' }}
          >
            Erken Erişim
            <ArrowRight className="h-3.5 w-3.5" />
          </a>
        </div>

        <button
          className="flex items-center justify-center text-ink md:hidden"
          onClick={() => setMenuOpen((v) => !v)}
          aria-label={menuOpen ? 'Menüyü kapat' : 'Menüyü aç'}
          aria-expanded={menuOpen}
        >
          {menuOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
        </button>
      </nav>

      {menuOpen && (
        <div className="fixed inset-0 top-[76px] z-40 bg-bg md:hidden">
          <div className="flex flex-col gap-2 px-6 py-8">
            {navLinks.map((link) => (
              <a
                key={link.href}
                href={link.href}
                onClick={() => setMenuOpen(false)}
                className="border-b border-border py-4 text-lg font-medium text-ink"
              >
                {link.label}
              </a>
            ))}
            <a
              href="#erkek-erisim"
              onClick={() => setMenuOpen(false)}
              className="mt-6 inline-flex items-center justify-center gap-2 rounded-lg bg-ink px-6 py-3.5 text-base font-medium text-bg"
            >
              Erken Erişime Katıl
              <ArrowRight className="h-4 w-4" />
            </a>
          </div>
        </div>
      )}
    </header>
  );
}
