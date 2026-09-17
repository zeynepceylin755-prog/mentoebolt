import { useEffect, useRef, useState } from 'react';
import {
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Check,
  Compass,
  Lightbulb,
  Menu,
  Target,
  X,
} from 'lucide-react';
import Button from '@/components/ui/Button';
import ProductPreview from '@/components/landing/ProductPreview';
import MistakeAnalysisPreview from '@/components/landing/MistakeAnalysisPreview';
import CurriculumPath from '@/components/landing/CurriculumPath';
import { useReveal } from '@/lib/useReveal';

/**
 * The public Mentora landing page.
 *
 * It is the first thing an unauthenticated visitor sees, so it has one job:
 * explain, in a few seconds and in the student's own language, what the product
 * is and how to start. It owns no authentication state — it only reports the two
 * entry intents back to the application shell — and it contains no dashboards,
 * no invented numbers, no testimonials and no AI imagery, the same restraint the
 * student product itself practises.
 *
 * Visually it is an editorial page rather than a SaaS template: warm ivory
 * paper, deep-ink type, a serif display face for headlines, generous margins,
 * hairline rules instead of a grid of feature cards, and two product previews
 * that mimic the real student application instead of an abstract illustration.
 */
interface LandingPageProps {
  /** Opens the existing sign-up experience. */
  onGetStarted: () => void;
  /** Opens the existing sign-in experience. */
  onLogin: () => void;
}

/** The page's anchor navigation, shared by the desktop bar and the mobile sheet. */
const NAV_LINKS = [
  { href: '#ozellikler', label: 'Özellikler' },
  { href: '#nasil-calisir', label: 'Nasıl Çalışır?' },
  { href: '#mufredat', label: 'Müfredat' },
  { href: '#sss', label: 'S.S.' },
] as const;

/** The three-step explanation. Deliberately short and free of AI jargon. */
const STEPS = [
  {
    index: '01',
    title: 'Soruyu getir.',
    description:
      'Kendi çözdüğün soruyu veya üzerinde çalıştığın testi Mentora’ya getir.',
  },
  {
    index: '02',
    title: 'Nerede takıldığını gör.',
    description:
      'Mentora, hatalarının arkasındaki öğrenme eksiklerini anlamana yardımcı olur.',
  },
  {
    index: '03',
    title: 'Sıradaki adımını bil.',
    description:
      'Hangi konuyu ve hangi beceriyi çalışman gerektiğini daha net gör.',
  },
] as const;

/**
 * The product flow, rendered as typographic steps rather than a chart.
 *
 * This describes what the product does with a question — it is not a claim about
 * the student's ability and not a measurement, so no numbers are attached.
 */
const FLOW = [
  'Çözdüğün soru',
  'Hata / zorlandığın nokta',
  'Öğrenme eksikliği',
  'Sıradaki çalışma adımı',
] as const;

/** The three supporting points under the mistake-analysis section. */
const ANALYSIS_POINTS = [
  {
    icon: Target,
    title: 'Hata analizi yapar',
    description: 'Çözdüğün sorudaki hatanın türünü ve takıldığın adımı gösterir.',
  },
  {
    icon: Compass,
    title: 'Eksik konuları belirler',
    description: 'Hatanın arkasındaki konuyu ve ön koşul beceriyi görünür kılar.',
  },
  {
    icon: Lightbulb,
    title: 'Kişiye özel ipuçları sunar',
    description:
      'Cevabı vermek yerine, doğru adımı kendin bulman için ipucu verir.',
  },
] as const;

/** A product example, not a personal student plan. */
const EXAMPLE_FLOW = [
  { index: '01', title: 'Soruyu getir', hint: 'Kendi çözümünden' },
  { index: '02', title: 'Zorlandığın noktayı gör', hint: 'Cevabın ve soru üzerinden' },
  { index: '03', title: 'Neyi tekrar edeceğini öğren', hint: 'İlgili beceriyi bul' },
  { index: '04', title: 'Yeni soruyla dene', hint: 'Sıradaki adımı çalış' },
] as const;

/** Honest, descriptive answers only — no promises and no invented specifics. */
const FAQ = [
  {
    id: 'cozer',
    question: 'Mentora soruyu benim yerime çözer mi?',
    answer:
      'Hayır. Mentora cevabını analiz eder, nerede hata yaptığını gösterir ve konuyu anlaman için sana özel ipuçları sunar. Çözümü senin bulman esastır.',
  },
  {
    id: 'sinif',
    question: 'Hangi sınıf ve ders için tasarlandı?',
    answer:
      'Mentora şu anda 11. sınıf matematik öğrenme hedefleri için tasarlanıyor. Öğrenme akışı, bu hedeflerle uyumlu bir çalışma sırası kurmayı amaçlar.',
  },
  {
    id: 'seviye',
    question: 'Seviyemi nasıl belirliyor?',
    answer:
      'Elindeki kanıtı analiz eder: getirdiğin soruları ve hatalarını. Matematik seviyeni bağımsız olarak “bilmez”; gördüğü kanıt üzerinden sana yol gösterir.',
  },
  {
    id: 'soru-sayisi',
    question: 'Ne kadar soru çözmem gerekiyor?',
    answer:
      'Amaç sana daha fazla soru vermek değil; doğru soruya doğru zamanda yönelmene yardımcı olmak. Bir soru getirerek başlayabilirsin.',
  },
] as const;

export default function LandingPage({ onGetStarted, onLogin }: LandingPageProps) {
  const pageRef = useRef<HTMLDivElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [openFaq, setOpenFaq] = useState<string | null>(null);

  // One page-wide reveal observer. It is a progressive enhancement only: the
  // copy is present and readable with or without it.
  useReveal(pageRef);

  // The sheet is a navigation surface, but Escape must still close it like any
  // other overlay, and it must not survive a resize into the desktop layout.
  useEffect(() => {
    if (!menuOpen) {
      return;
    }
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMenuOpen(false);
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [menuOpen]);

  return (
    <div ref={pageRef} className="min-h-screen bg-bg text-ink">
      {/* ------------------------------------------------------------ navigation */}
      <header className="sticky top-0 z-40 border-b border-border/70 bg-bg/85 backdrop-blur-md">
        <div className="mx-auto flex w-full max-w-content items-center justify-between gap-4 px-5 py-3.5 sm:px-8 sm:gap-6 lg:px-12">
          <a
            href="#top"
            className="font-display text-[1.0625rem] uppercase tracking-[0.24em] text-ink"
          >
            Mentora
          </a>

          <nav aria-label="Sayfa bölümleri" className="hidden lg:block">
            <ul className="flex items-center gap-9">
              {NAV_LINKS.map((link) => (
                <li key={link.href}>
                  <a
                    href={link.href}
                    className="text-body-sm text-nav transition-colors hover:text-ink"
                  >
                    {link.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>

          <div className="flex items-center gap-1 sm:gap-2">
            <button
              type="button"
              onClick={onLogin}
              className="inline-flex min-h-[44px] items-center px-1.5 text-body-sm text-nav transition-colors hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 sm:px-3"
            >
              Giriş Yap
            </button>
            <Button type="button" onClick={onGetStarted} className="whitespace-nowrap">
              İlk sorunu getir
            </Button>
            <button
              type="button"
              onClick={() => setMenuOpen((open) => !open)}
              aria-expanded={menuOpen}
              aria-controls="landing-mobile-nav"
              aria-label={menuOpen ? 'Menüyü kapat' : 'Menüyü aç'}
              className="ml-0.5 inline-flex h-11 w-11 items-center justify-center rounded-lg text-nav transition-colors hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 lg:hidden"
            >
              {menuOpen ? (
                <X className="h-5 w-5" aria-hidden="true" />
              ) : (
                <Menu className="h-5 w-5" aria-hidden="true" />
              )}
            </button>
          </div>
        </div>

        {/* A compact sheet under the bar — section links only, so the page keeps
            a single pair of entry actions at every width. */}
        {menuOpen && (
          <nav
            id="landing-mobile-nav"
            aria-label="Sayfa bölümleri (mobil)"
            className="border-t border-border bg-bg px-5 pt-2 pb-4 sm:px-8 lg:hidden"
          >
            <ul className="divide-y divide-border">
              {NAV_LINKS.map((link) => (
                <li key={link.href}>
                  <a
                    href={link.href}
                    onClick={() => setMenuOpen(false)}
                    className="flex min-h-[52px] items-center justify-between gap-4 text-body text-ink transition-colors hover:text-accent"
                  >
                    {link.label}
                    <ArrowUpRight className="h-4 w-4 text-muted" aria-hidden="true" />
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        )}
      </header>

      <main id="top">
        {/* --------------------------------------------------------------- hero */}
        <section className="px-5 pt-12 pb-14 sm:px-8 sm:pt-16 sm:pb-20 lg:px-12 lg:pt-20 lg:pb-28">
          <div className="mx-auto grid w-full max-w-content items-center gap-12 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] lg:gap-16 xl:gap-20">
            <div className="min-w-0">
              <p className="reveal text-label font-medium uppercase tracking-eyebrow text-accent">
                11. Sınıf Matematik
              </p>

              <h1 className="reveal reveal-delay-1 mt-5 font-display text-[3rem] leading-[1.02] tracking-[-0.025em] text-ink sm:text-[4rem] lg:text-[4.5rem] xl:text-[5rem]">
                Matematikte
                <br />
                yolunu bul.
              </h1>

              <p className="reveal reveal-delay-2 mt-7 max-w-[34rem] font-display text-[1.35rem] leading-snug text-ink-soft sm:text-[1.6rem]">
                Çözdüğün soruları getir. Nerede zorlandığını anla. Sıradaki doğru şeyi çalış.
              </p>

              <p className="reveal reveal-delay-3 mt-6 max-w-[34rem] text-body leading-relaxed text-muted sm:leading-[1.75rem]">
                Çözdüğün soruları getir. Mentora nerede zorlandığını analiz etsin ve
                sıradaki doğru çalışma adımını birlikte bulalım.
              </p>

              <div className="reveal reveal-delay-4 mt-9 flex-col gap-3 sm:flex-row sm:items-center">
                <Button
                  type="button"
                  size="lg"
                  onClick={onGetStarted}
                  className="w-full sm:w-auto"
                >
                  İlk sorunu getir
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </Button>
                <Button
                  type="button"
                  size="lg"
                  variant="ghost"
                  onClick={onLogin}
                  className="w-full sm:w-auto"
                >
                  Giriş yap
                </Button>
              </div>

              <p className="reveal reveal-delay-4 mt-6 text-body-sm text-muted">
                Erken erişime katıl, ilk sorunu getir.
              </p>
            </div>

            {/* The hero's right side is an actual product interface — the daily
                focus, the areas it rests on, a learning signal and the next
                step — not a decorative dashboard. */}
            <div className="reveal reveal-delay-2 w-full min-w-0 max-w-[30rem] justify-self-start lg:justify-self-end">
              <ProductPreview />
            </div>
          </div>
        </section>

        {/* -------------------------------------------------- nasıl çalışır / akış */}
        <section
          id="nasil-calisir"
          className="border-t border-border px-5 py-16 sm:px-8 sm:py-24 lg:px-12 lg:py-28"
        >
          <div className="mx-auto w-full max-w-content">
            <div className="grid gap-10 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:gap-20">
              <div className="reveal">
                <p className="text-label font-medium uppercase tracking-eyebrow text-muted">
                  Nasıl çalışır?
                </p>
                <h2 className="mt-5 font-display text-[1.875rem] leading-[1.12] tracking-[-0.02em] text-ink sm:text-[2.25rem] lg:text-[2.5rem]">
                  Üç adım. Ne yaptığını bilmek için karmaşık bir arayüz öğrenmen
                  gerekmez.
                </h2>
                <p className="mt-6 max-w-[32rem] text-body leading-relaxed text-muted">
                  Mentora elindeki kanıtı analiz eder: getirdiğin soruları ve
                  hatalarını. Matematik seviyeni bağımsız olarak “bilmez”; gördüğü
                  kanıt üzerinden sana yol gösterir.
                </p>
              </div>

              <ol className="min-w-0">
                {STEPS.map((step, index) => (
                  <li
                    key={step.index}
                    className="reveal grid-cols-[auto_minmax(0,1fr)] gap-x-6 border-t border-border py-7 first:border-t-0 first:pt-0 sm:gap-x-10"
                    style={{ transitionDelay: `${index * 90}ms` }}
                  >
                    <span className="font-display text-[1.75rem] leading-none tabular-nums text-accent/70 sm:text-[2rem]">
                      {step.index}
                    </span>
                    <div className="min-w-0">
                      <h3 className="font-display text-[1.25rem] leading-snug text-ink sm:text-[1.375rem]">
                        {step.title}
                      </h3>
                      <p className="mt-2 max-w-[32rem] text-body-sm leading-relaxed text-muted">
                        {step.description}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            </div>

            {/* The four stages as one calm horizontal chain. */}
            <ol className="reveal mt-14 items-center gap-x-3 gap-y-3 border-t border-border pt-8 sm:mt-16 sm:flex sm:flex-wrap">
              {FLOW.map((step, index) => (
                <li key={step} className="flex items-center gap-3 py-1.5 sm:py-0">
                  <span className="font-sora text-[0.6875rem] tabular-nums text-muted">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <span className="text-body-sm text-ink">{step}</span>
                  {index < FLOW.length - 1 && (
                    <ArrowRight className="h-3.5 w-3.5 text-border" aria-hidden="true" />
                  )}
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* ----------------------------------------------------- özellikler / analiz */}
        <section
          id="ozellikler"
          className="border-t border-border bg-surface/60 px-5 py-16 sm:px-8 sm:py-24 lg:px-12 lg:py-28"
        >
          <div className="mx-auto w-full max-w-content">
            <div className="grid items-center gap-12 lg:grid-cols-[minmax(0,1.02fr)_minmax(0,0.98fr)] lg:gap-20">
              <div className="reveal min-w-0">
                <p className="text-label font-medium uppercase tracking-eyebrow text-muted">
                  Hata analizi
                </p>
                <h2 className="mt-5 font-display text-[1.875rem] leading-[1.12] tracking-[-0.02em] text-ink sm:text-[2.25rem] lg:text-[2.5rem]">
                  Sadece yanlış
                  <br />
                  yaptığını söylemez.
                </h2>
                <p className="mt-6 max-w-[32rem] text-body leading-relaxed text-muted">
                  Mentora, cevabını analiz eder, nerede hata yaptığını gösterir ve
                  konuyu anlaman için sana özel ipuçları sunar.
                </p>

                <ul className="mt-9 space-y-6">
                  {ANALYSIS_POINTS.map((point, index) => (
                    <li
                      key={point.title}
                      className="reveal flex items-start gap-4"
                      style={{ transitionDelay: `${index * 80}ms` }}
                    >
                      <span className="mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg border-border bg-card">
                        <point.icon className="h-4 w-4 text-accent" aria-hidden="true" />
                      </span>
                      <div className="min-w-0">
                        <h3 className="font-display text-[1.0625rem] leading-snug text-ink">
                          {point.title}
                        </h3>
                        <p className="mt-1 max-w-[28rem] text-body-sm leading-relaxed text-muted">
                          {point.description}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="reveal w-full min-w-0 max-w-[30rem] justify-self-start lg:justify-self-end">
                <MistakeAnalysisPreview />
              </div>
            </div>
          </div>
        </section>

        {/* -------------------------------------------------------- günlük çalışma */}
        <section className="border-t border-border px-5 py-16 sm:px-8 sm:py-24 lg:px-12 lg:py-28">
          <div className="mx-auto w-full max-w-content">
            <div className="reveal max-w-[46rem]">
              <p className="text-label font-medium uppercase tracking-eyebrow text-muted">
                Ürün akışı
              </p>
              <h2 className="mt-5 font-display text-[1.875rem] leading-[1.12] tracking-[-0.02em] text-ink sm:text-[2.25rem] lg:text-[2.5rem]">
                Soru, analiz ve sonraki adım aynı yerde.
              </h2>
              <p className="mt-6 text-body leading-relaxed text-muted">
                Aşağıdaki görünüm bir öğrenci planı değil. Mentora’nın kendi sorundan
                nasıl bir çalışma sırası çıkardığını gösteren temsili bir akış.
              </p>
            </div>

            <div className="reveal mt-12 rounded-lg border border-border bg-card sm:mt-14">
              <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-border px-5 py-4 sm:px-8 sm:py-5">
                <p className="font-display text-[1.0625rem] uppercase tracking-[0.24em] text-ink">
                  Örnek akış
                </p>
                <p className="text-body-sm text-muted">Gerçek öğrenci verisi değil</p>
              </div>

              <ol className="grid sm:grid-cols-2">
                {EXAMPLE_FLOW.map((item, index) => (
                  <li
                    key={item.index}
                    className={[
                      'flex items-baseline gap-5 border-border px-5 py-6 sm:px-8 sm:py-7',
                      index < EXAMPLE_FLOW.length - 1 ? 'border-b' : '',
                      index % 2 === 0 ? 'sm:border-r' : '',
                      index >= EXAMPLE_FLOW.length - 2 ? 'sm:border-b-0' : '',
                    ].join(' ')}
                  >
                    <span className="font-sora text-[0.6875rem] tabular-nums text-accent/80">
                      {item.index}
                    </span>
                    <div className="min-w-0">
                      <p className="font-display text-[1.25rem] leading-snug text-ink sm:text-[1.375rem]">
                        {item.title}
                      </p>
                      <p className="mt-1 text-body-sm text-muted">{item.hint}</p>
                    </div>
                  </li>
                ))}
              </ol>

              <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-border px-5 py-4 sm:px-8">
                <Check className="h-4 w-4 flex-shrink-0 text-success" aria-hidden="true" />
                <p className="text-body-sm text-muted">
                  Sıra, çözdüğün sorulardan çıkarılan öğrenme verilerine dayanır.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* -------------------------------------------------------------- müfredat */}
        <section
          id="mufredat"
          className="border-t border-border bg-surface/60 px-5 py-16 sm:px-8 sm:py-24 lg:px-12 lg:py-28"
        >
          <div className="mx-auto w-full max-w-content">
            <div className="grid gap-12 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)] lg:gap-20">
              <div className="reveal min-w-0">
                <p className="text-label font-medium uppercase tracking-eyebrow text-muted">
                  Müfredat
                </p>
                <h2 className="mt-5 font-display text-[1.875rem] leading-[1.12] tracking-[-0.02em] text-ink sm:text-[2.25rem] lg:text-[2.5rem]">
                  11. sınıf matematik
                  <br />
                  için tasarlandı.
                </h2>
                <p className="mt-6 max-w-[32rem] text-body leading-relaxed text-muted">
                  Mentora’nın öğrenme akışı, Türkiye Yüzyılı Maarif Modeli’ndeki
                  11. sınıf matematik öğrenme hedeflerini temel alacak şekilde
                  yapılandırılıyor. Ürün, bu hedeflerle uyumlu bir çalışma sırası
                  kurmayı amaçlar.
                </p>

                <div className="mt-9 flex items-start gap-4 border-t border-border pt-7">
                  <BookOpen
                    className="mt-0.5 h-4 w-4 flex-shrink-0 text-accent"
                    aria-hidden="true"
                  />
                  <p className="max-w-[30rem] text-body-sm leading-relaxed text-muted">
                    Mentora resmî bir onay ya da sertifika iddiası taşımaz. Öğrenme
                    hedefleri, ürün kendi çalışma sırasını kurmak için kullandığı
                    çerçevedir.
                  </p>
                </div>
              </div>

              <div className="reveal min-w-0">
                <p className="text-label font-medium uppercase tracking-eyebrow text-muted">
                  11. sınıf boyunca
                </p>
                <div className="mt-6">
                  <CurriculumPath />
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ------------------------------------------------------------------ S.S. */}
        <section
          id="sss"
          className="border-t border-border px-5 py-16 sm:px-8 sm:py-24 lg:px-12 lg:py-28"
        >
          <div className="mx-auto w-full max-w-content">
            <div className="grid gap-10 lg:grid-cols-[minmax(0,0.7fr)_minmax(0,1.3fr)] lg:gap-20">
              <div className="reveal">
                <p className="text-label font-medium uppercase tracking-eyebrow text-muted">
                  S.S.
                </p>
                <h2 className="mt-5 font-display text-[1.875rem] leading-[1.12] tracking-[-0.02em] text-ink sm:text-[2.25rem]">
                  Sık sorulan sorular
                </h2>
                <p className="mt-5 max-w-[26rem] text-body-sm leading-relaxed text-muted">
                  Mentora’nın ne yaptığı ve ne yapmadığı hakkında kısa cevaplar.
                </p>
              </div>

              <div className="reveal min-w-0 border-t border-border">
                {FAQ.map((item) => {
                  const open = openFaq === item.id;
                  return (
                    <div key={item.id} className="border-b border-border">
                      <h3>
                        <button
                          type="button"
                          onClick={() => setOpenFaq(open ? null : item.id)}
                          aria-expanded={open}
                          aria-controls={`faq-${item.id}`}
                          className="flex w-full items-start justify-between gap-6 py-5 text-left transition-colors hover:text-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                        >
                          <span className="font-display text-[1.125rem] leading-snug text-ink sm:text-[1.25rem]">
                            {item.question}
                          </span>
                          <span
                            className="mt-1 flex h-5 w-5 flex-shrink-0 items-center justify-center text-muted"
                            aria-hidden="true"
                          >
                            <span className="relative block h-3 w-3">
                              <span className="absolute top-1/2 left-0 h-px w-3 -translate-y-1/2 bg-current" />
                              <span
                                className={[
                                  'absolute top-0 left-1/2 h-3 w-px -translate-x-1/2 bg-current transition-transform duration-200',
                                  open ? 'scale-y-0' : 'scale-y-100',
                                ].join(' ')}
                              />
                            </span>
                          </span>
                        </button>
                      </h3>
                      {open && (
                        <p
                          id={`faq-${item.id}`}
                          className="max-w-[40rem] pr-8 pb-6 text-body-sm leading-relaxed text-muted"
                        >
                          {item.answer}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </section>

        {/* -------------------------------------------------------------- final CTA */}
        <section className="bg-ink px-5 py-18 sm:px-8 sm:py-24 lg:px-12 lg:py-28">
          <div className="mx-auto w-full max-w-content">
            <div className="reveal max-w-[46rem]">
              <p className="text-label font-medium uppercase tracking-eyebrow text-bg/55">
                11. Sınıf Matematik
              </p>
              <h2 className="mt-6 font-display text-[2rem] leading-[1.08] tracking-[-0.025em] text-bg sm:text-[2.5rem] lg:text-[3rem]">
                Matematikte sıradaki
                <br />
                doğru adımı bul.
              </h2>
              <p className="mt-6 max-w-[34rem] text-body leading-relaxed text-bg/70">
                Çözdüğün sorulardan başlayarak kendi matematik yolunu oluştur.
              </p>

              {/*
               * `flex-col` on phones is deliberate: two stacked full-width rows
               * are unambiguous on a small screen, whereas Tailwind's `flex-row`
               * is emitted after `flex-col` and would win at every width. The
               * container only becomes a row from the `sm` breakpoint up.
               */}
              <div className="mt-9 flex-col gap-3 sm:flex-row sm:items-center">
                <Button
                  type="button"
                  size="lg"
                  tone="onInk"
                  onClick={onGetStarted}
                  className="w-full sm:w-auto"
                >
                  Erken Erişime Katıl
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </Button>
                <Button
                  type="button"
                  size="lg"
                  variant="ghost"
                  onClick={onLogin}
                  className="w-full bg-transparent text-bg/80 hover:bg-bg/10 hover:text-bg focus-visible:ring-bg/50 sm:w-auto"
                >
                  Giriş yap
                </Button>
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* ---------------------------------------------------------------- footer */}
      <footer className="bg-ink px-5 pt-14 pb-12 sm:px-8 sm:pb-14 lg:px-12">
        <div className="mx-auto w-full max-w-content">
          <div className="grid gap-10 border-b border-bg/15 pb-10 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_auto] lg:gap-16">
            <div>
              <span className="font-display text-[1.0625rem] uppercase tracking-[0.24em] text-bg">
                Mentora
              </span>
              <p className="mt-3 max-w-[22rem] text-body-sm leading-relaxed text-bg/60">
                Matematikte yolunu bul. Çözdüğün sorulardan başlayarak sıradaki
                doğru adımı belirle.
              </p>
            </div>

            <nav aria-label="Alt menü">
              <ul className="space-y-3">
                {NAV_LINKS.map((link) => (
                  <li key={link.href}>
                    <a
                      href={link.href}
                      className="text-body-sm text-bg/70 transition-colors hover:text-bg"
                    >
                      {link.label}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>

            <div className="flex flex-col items-start gap-3 sm:flex-row lg:flex-col">
              <button
                type="button"
                onClick={onLogin}
                className="inline-flex min-h-[44px] items-center text-body-sm text-bg/70 transition-colors hover:text-bg focus:outline-none focus-visible:ring-2 focus-visible:ring-bg/50"
              >
                Giriş Yap
              </button>
              <Button
                type="button"
                tone="onInk"
                onClick={onGetStarted}
                className="whitespace-nowrap"
              >
                Ücretsiz Başla
              </Button>
            </div>
          </div>

          <p className="pt-6 text-body-sm text-bg/45">
            © {new Date().getFullYear()} Mentora
          </p>
        </div>
      </footer>
    </div>
  );
}
