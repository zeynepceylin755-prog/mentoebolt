import { type ReactNode, useEffect, useRef, useState } from 'react';
import {
  Compass,
  Upload,
  RotateCcw,
  TrendingUp,
  User,
  LogOut,
  X,
  Sprout,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';

/**
 * The four student-facing learning destinations. Account actions stay outside
 * this list so the mobile bar remains a focused study tool.
 */
export const STUDENT_DESTINATIONS = [
  { id: 'bugun', label: 'Bugün', shortLabel: 'Bugün', icon: Compass },
  { id: 'soru-getir', label: 'Soru Getir', shortLabel: 'Soru', icon: Upload, primary: true },
  { id: 'tekrarlarim', label: 'Tekrarlarım', shortLabel: 'Tekrarlar', icon: RotateCcw },
  { id: 'gelisim', label: 'Gelişim', shortLabel: 'Gelişim', icon: TrendingUp },
] as const;

export type StudentDestinationId = (typeof STUDENT_DESTINATIONS)[number]['id'] | 'profil';

const ACCOUNT_DESTINATIONS = [{ id: 'profil', label: 'Profil', icon: User }] as const;

interface StudentShellProps {
  currentView: string;
  onNavigate: (view: StudentDestinationId) => void;
  children: ReactNode;
}

/**
 * Student application shell.
 *
 * Desktop keeps a quiet learning rail. Mobile deliberately becomes a compact
 * header plus four primary bottom actions; account controls live in a real,
 * dismissible dialog instead of competing with the study destinations.
 */
export default function StudentShell({
  currentView,
  onNavigate,
  children,
}: StudentShellProps) {
  const { user, logout } = useAuth();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const menuTriggerRef = useRef<HTMLButtonElement>(null);
  const menuCloseRef = useRef<HTMLButtonElement>(null);
  const wasMenuOpen = useRef(false);

  const displayName = [user?.firstName, user?.lastName]
    .map((part) => (part ?? '').trim())
    .filter(Boolean)
    .join(' ');

  useEffect(() => {
    if (!mobileMenuOpen) {
      if (wasMenuOpen.current) {
        menuTriggerRef.current?.focus();
        wasMenuOpen.current = false;
      }
      return undefined;
    }

    wasMenuOpen.current = true;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMobileMenuOpen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    const focusFrame = window.requestAnimationFrame(() => menuCloseRef.current?.focus());

    return () => {
      window.cancelAnimationFrame(focusFrame);
      window.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [mobileMenuOpen]);

  const goTo = (view: StudentDestinationId) => {
    onNavigate(view);
    setMobileMenuOpen(false);
  };

  return (
    <div className="min-h-screen bg-bg">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[60] focus:rounded-lg focus:bg-ink focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-bg"
      >
        Ana içeriğe geç
      </a>

      <div className="mx-auto flex w-full max-w-[1440px]">
        <aside
          className="sticky top-0 hidden h-screen w-64 flex-shrink-0 border-r border-border/70 bg-bg px-4 py-6 lg:flex lg:flex-col"
          aria-label="Öğrenme menüsü"
        >
          <div className="px-2">
            <button
              type="button"
              onClick={() => onNavigate('bugun')}
              className="font-sora text-[1.05rem] font-semibold tracking-[0.2em] text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
            >
              MENTORA
            </button>
            <p className="mt-2 max-w-[11rem] text-[0.72rem] leading-relaxed text-muted">Kendi sorularından oluşan matematik rehberin</p>
          </div>

          <nav className="mt-8 flex flex-1 flex-col gap-1" aria-label="Ürün bölümleri">
            <p className="px-3 pb-2 text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-muted">Öğrenme</p>
            <ul className="space-y-1">
              {STUDENT_DESTINATIONS.map((destination) => {
                const Icon = destination.icon;
                const isActive = currentView === destination.id;
                const isPrimary = 'primary' in destination && destination.primary;

                return (
                  <li key={destination.id}>
                    <button
                      type="button"
                      onClick={() => onNavigate(destination.id)}
                      aria-current={isActive ? 'page' : undefined}
                      className={[
                        'flex min-h-[44px] w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-body-sm font-medium transition-colors duration-200',
                        'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
                        isActive
                          ? 'bg-terracotta text-bg'
                          : isPrimary
                            ? 'text-ink hover:bg-card'
                            : 'text-nav hover:bg-card hover:text-ink',
                      ].join(' ')}
                    >
                      <Icon
                        className={`h-4 w-4 flex-shrink-0 ${isPrimary && !isActive ? 'text-accent' : ''}`}
                        aria-hidden="true"
                      />
                      <span className="truncate">{destination.label}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </nav>

          <div className="mt-auto rounded-2xl border border-border bg-card p-4">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-sage-tint text-success" aria-hidden="true"><Sprout className="h-4 w-4" /></span>
            <p className="mt-3 text-[13px] leading-snug text-muted">Matematikte bir adım daha ileri olmak için buradasın.</p>
          </div>
          <div className="mt-4 border-t border-border px-1 pt-4">
            {displayName && <p className="truncate px-3 pb-2 text-body-sm text-muted">{displayName}</p>}
            <nav aria-label="Hesap">
              <ul className="space-y-1">
                {ACCOUNT_DESTINATIONS.map((destination) => {
                  const Icon = destination.icon;
                  const isActive = currentView === destination.id;
                  return (
                    <li key={destination.id}>
                      <button
                        type="button"
                        onClick={() => onNavigate(destination.id)}
                        aria-current={isActive ? 'page' : undefined}
                        className="flex min-h-[44px] w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-body-sm font-medium text-nav transition-colors duration-200 hover:bg-surface hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                      >
                        <Icon className="h-4 w-4 flex-shrink-0" aria-hidden="true" />
                        <span className="truncate">{destination.label}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </nav>
            <button
              type="button"
              onClick={() => void logout()}
              className="mt-2 flex min-h-[44px] w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-body-sm font-medium text-nav transition-colors duration-200 hover:bg-surface hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
            >
              <LogOut className="h-4 w-4 flex-shrink-0" aria-hidden="true" />
              Çıkış
            </button>
          </div>
        </aside>

        <div className="min-w-0 flex-1 pb-28 lg:pb-12">
          <header className="sticky top-0 z-30 border-b border-border bg-bg/95 backdrop-blur-sm lg:hidden">
            <div className="flex items-center justify-between px-5 py-3">
              <button
                type="button"
                onClick={() => onNavigate('bugun')}
                className="font-display text-base uppercase tracking-[0.2em] text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
              >
                MENTORA
              </button>
              <button
                ref={menuTriggerRef}
                type="button"
                onClick={() => setMobileMenuOpen(true)}
                className="flex h-11 w-11 items-center justify-center rounded-lg text-muted transition-colors hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                aria-label="Menüyü aç"
                aria-haspopup="dialog"
                aria-expanded={mobileMenuOpen}
              >
                <span className="sr-only">Menü</span>
                <span aria-hidden="true" className="flex flex-col gap-1.5">
                  <span className="h-px w-5 bg-current" />
                  <span className="h-px w-5 bg-current" />
                  <span className="h-px w-5 bg-current" />
                </span>
              </button>
            </div>
          </header>

          {mobileMenuOpen && (
            <div
              className="fixed inset-0 z-50 lg:hidden"
              role="dialog"
              aria-modal="true"
              aria-labelledby="student-mobile-menu-title"
            >
              <button
                type="button"
                className="absolute inset-0 h-full w-full bg-ink/45"
                onClick={() => setMobileMenuOpen(false)}
                aria-label="Menüyü kapat"
              />
              <section className="absolute right-0 top-0 h-full w-[min(21rem,100%)] bg-bg shadow-xl">
                <div className="flex items-center justify-between border-b border-border px-5 py-4">
                  <h2 id="student-mobile-menu-title" className="font-display text-xl text-ink">
                    Menü
                  </h2>
                  <button
                    ref={menuCloseRef}
                    type="button"
                    onClick={() => setMobileMenuOpen(false)}
                    className="flex h-11 w-11 items-center justify-center rounded-lg text-muted transition-colors hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                    aria-label="Menüyü kapat"
                  >
                    <X className="h-5 w-5" aria-hidden="true" />
                  </button>
                </div>

                <nav className="px-4 py-6" aria-label="Mobil ürün menüsü">
                  <ul className="space-y-1">
                    {STUDENT_DESTINATIONS.map((destination) => {
                      const Icon = destination.icon;
                      const isActive = currentView === destination.id;
                      return (
                        <li key={destination.id}>
                          <button
                            type="button"
                            onClick={() => goTo(destination.id)}
                            aria-current={isActive ? 'page' : undefined}
                            className={[
                              'flex min-h-[44px] w-full items-center gap-3 rounded-lg px-4 py-3 text-left text-body-sm font-medium transition-colors',
                              'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
                              isActive ? 'bg-ink text-bg' : 'text-nav hover:bg-surface hover:text-ink',
                            ].join(' ')}
                          >
                            <Icon className="h-4 w-4 flex-shrink-0" aria-hidden="true" />
                            <span>{destination.label}</span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>

                  <div className="mt-6 border-t border-border pt-6">
                    <ul className="space-y-1">
                      {ACCOUNT_DESTINATIONS.map((destination) => {
                        const Icon = destination.icon;
                        const isActive = currentView === destination.id;
                        return (
                          <li key={destination.id}>
                            <button
                              type="button"
                              onClick={() => goTo(destination.id)}
                              aria-current={isActive ? 'page' : undefined}
                              className="flex min-h-[44px] w-full items-center gap-3 rounded-lg px-4 py-3 text-left text-body-sm font-medium text-nav transition-colors hover:bg-surface hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                            >
                              <Icon className="h-4 w-4 flex-shrink-0" aria-hidden="true" />
                              <span>{destination.label}</span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                    <button
                      type="button"
                      onClick={() => {
                        void logout();
                        setMobileMenuOpen(false);
                      }}
                      className="mt-2 flex min-h-[44px] w-full items-center gap-3 rounded-lg px-4 py-3 text-left text-body-sm font-medium text-nav transition-colors hover:bg-surface hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                    >
                      <LogOut className="h-4 w-4 flex-shrink-0" aria-hidden="true" />
                      <span>Çıkış</span>
                    </button>
                  </div>
                </nav>
              </section>
            </div>
          )}

          <div className="hidden items-center justify-between border-b border-border/70 bg-bg px-8 py-4 lg:flex xl:px-12">
            <p className="editorial-kicker">11. sınıf matematik · öğrenme günlüğü</p>
            <button
              type="button"
              onClick={() => onNavigate('profil')}
              className="flex items-center gap-2.5 text-xs font-medium text-muted transition-colors hover:text-ink"
            >
              <span className="grid h-9 w-9 place-items-center rounded-full bg-terracotta text-sm font-semibold text-bg">
                {(displayName || 'P').slice(0, 1).toUpperCase()}
              </span>
              {displayName || 'Profil'}
            </button>
          </div>

          <main id="main-content" tabIndex={-1}>
            {children}
          </main>
        </div>
      </div>

      <nav
        className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-bg pb-safe lg:hidden"
        aria-label="Ana menü"
      >
        <ul className="flex items-stretch">
          {STUDENT_DESTINATIONS.map((destination) => {
            const Icon = destination.icon;
            const isActive = currentView === destination.id;
            const isPrimary = 'primary' in destination && destination.primary;

            return (
              <li key={destination.id} className="flex-1">
                <button
                  type="button"
                  onClick={() => onNavigate(destination.id)}
                  aria-current={isActive ? 'page' : undefined}
                  className={[
                    'flex min-h-[56px] w-full flex-col items-center justify-center gap-1 px-1 py-2 transition-colors duration-200',
                    'focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/40',
                    isActive ? 'text-terracotta' : 'text-muted',
                  ].join(' ')}
                >
                  <Icon
                    className={`h-5 w-5 ${isActive || isPrimary ? 'text-terracotta' : ''}`}
                    aria-hidden="true"
                  />
                  <span className="text-[10px] font-medium leading-none min-[390px]:text-[11px]">
                    {destination.label}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}
