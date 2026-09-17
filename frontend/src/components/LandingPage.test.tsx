import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import LandingPage from './LandingPage';

/**
 * The public landing page.
 *
 * The tests cover the two things that matter for this screen: it says what the
 * product is in the student's own words, and its calls to action report the
 * correct intent back to the application shell (it performs no authentication
 * itself).
 */
describe('LandingPage', () => {
  it('carries the Mentora brand and positioning', () => {
    render(<LandingPage onGetStarted={vi.fn()} onLogin={vi.fn()} />);

    expect(screen.getAllByText(/Mentora/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/11\. Sınıf Matematik/).length).toBeGreaterThan(0);
  });

  it('states the product idea in one line', () => {
    render(<LandingPage onGetStarted={vi.fn()} onLogin={vi.fn()} />);

    expect(
      screen.getByRole('heading', { level: 1, name: /Matematikte yolunu bul/ })
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Çözdüğün soruları getir\. Nerede zorlandığını anla\. Sıradaki doğru şeyi çalış\./)
    ).toBeInTheDocument();
  });

  it('explains how it works in three steps without AI jargon', () => {
    render(<LandingPage onGetStarted={vi.fn()} onLogin={vi.fn()} />);

    expect(screen.getByText('Nasıl çalışır?')).toBeInTheDocument();
    for (const title of ['Soruyu getir.', 'Nerede takıldığını gör.', 'Sıradaki adımını bil.']) {
      expect(screen.getByRole('heading', { level: 3, name: title })).toBeInTheDocument();
    }

    const text = document.body.textContent ?? '';
    for (const forbidden of [
      'AI-powered',
      'Yapay zekâ öğretmenin',
      'MEB onaylı',
      '%100',
      'garanti',
      'Powered by AI',
    ]) {
      expect(text).not.toContain(forbidden);
    }
  });

  it('explains the mistake analysis without ever claiming to solve the question', () => {
    render(<LandingPage onGetStarted={vi.fn()} onLogin={vi.fn()} />);

    expect(
      screen.getByRole('heading', { level: 2, name: /Sadece yanlış\s+yaptığını söylemez\./ })
    ).toBeInTheDocument();
    expect(
      screen.getByText(/cevabını analiz eder, nerede hata yaptığını gösterir/)
    ).toBeInTheDocument();
    for (const title of [
      'Hata analizi yapar',
      'Eksik konuları belirler',
      'Kişiye özel ipuçları sunar',
    ]) {
      expect(screen.getByRole('heading', { level: 3, name: title })).toBeInTheDocument();
    }

    // The promise the product does not make: it guides, it does not solve.
    expect(screen.getByText(/soruyu senin yerine çözmez/)).toBeInTheDocument();
  });

  it('shows the product loop as four ordered example steps', () => {
    render(<LandingPage onGetStarted={vi.fn()} onLogin={vi.fn()} />);

    expect(
      screen.getByRole('heading', { level: 2, name: 'Soru, analiz ve sonraki adım aynı yerde.' })
    ).toBeInTheDocument();
    expect(screen.getByText('Gerçek öğrenci verisi değil')).toBeInTheDocument();
    for (const title of [
      'Soruyu getir',
      'Zorlandığın noktayı gör',
      'Neyi tekrar edeceğini öğren',
      'Yeni soruyla dene',
    ]) {
      expect(screen.getAllByText(title).length).toBeGreaterThan(0);
    }
  });

  it('aligns with the curriculum without inventing an official claim', () => {
    render(<LandingPage onGetStarted={vi.fn()} onLogin={vi.fn()} />);

    expect(screen.getByText(/Türkiye Yüzyılı Maarif Modeli/)).toBeInTheDocument();
    expect(screen.getByText(/resmî bir onay ya da sertifika iddiası taşımaz/)).toBeInTheDocument();
  });

  it('shows the closing call to action', () => {
    render(<LandingPage onGetStarted={vi.fn()} onLogin={vi.fn()} />);

    expect(
      screen.getByRole('heading', { level: 2, name: /Matematikte sıradaki doğru adımı bul\./ })
    ).toBeInTheDocument();
    expect(
      screen.getByText('Çözdüğün sorulardan başlayarak kendi matematik yolunu oluştur.')
    ).toBeInTheDocument();
  });

  it('offers both entry points, with the primary CTA labelled', () => {
    render(<LandingPage onGetStarted={vi.fn()} onLogin={vi.fn()} />);

    expect(screen.getAllByRole('button', { name: /İlk sorunu getir/ }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: /^Giriş [Yy]ap$/ }).length).toBeGreaterThan(0);
  });

  it('calls onGetStarted when the early-access CTA is clicked', async () => {
    const user = userEvent.setup();
    const onGetStarted = vi.fn();
    render(<LandingPage onGetStarted={onGetStarted} onLogin={vi.fn()} />);

    await user.click(screen.getAllByRole('button', { name: /İlk sorunu getir/ })[0]);

    expect(onGetStarted).toHaveBeenCalledTimes(1);
  });

  it('calls onLogin when "Giriş yap" is clicked', async () => {
    const user = userEvent.setup();
    const onLogin = vi.fn();
    render(<LandingPage onGetStarted={vi.fn()} onLogin={onLogin} />);

    await user.click(screen.getAllByRole('button', { name: /^Giriş [Yy]ap$/ })[0]);

    expect(onLogin).toHaveBeenCalledTimes(1);
  });

  it('keeps the section navigation available on a phone without a second CTA pair', async () => {
    const user = userEvent.setup();
    render(<LandingPage onGetStarted={vi.fn()} onLogin={vi.fn()} />);

    // The sheet is closed until it is asked for...
    expect(screen.queryByRole('navigation', { name: 'Sayfa bölümleri (mobil)' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Menüyü aç' }));

    const mobileNav = screen.getByRole('navigation', { name: 'Sayfa bölümleri (mobil)' });
    expect(within(mobileNav).getByRole('link', { name: /S.S\./ })).toBeInTheDocument();
    // ...and it carries no entry action of its own: those stay in the bar.
    expect(within(mobileNav).queryByRole('button')).not.toBeInTheDocument();
  });

  it('folds the FAQ answers behind their questions', async () => {
    const user = userEvent.setup();
    render(<LandingPage onGetStarted={vi.fn()} onLogin={vi.fn()} />);

    expect(
      screen.getByRole('heading', { level: 2, name: 'Sık sorulan sorular' })
    ).toBeInTheDocument();

    const toggle = screen.getByRole('button', { name: /Mentora soruyu benim yerime çözer mi\?/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');

    await user.click(toggle);

    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText(/Çözümü senin bulman esastır\./)).toBeInTheDocument();
  });

  it('performs no authentication of its own', () => {
    render(<LandingPage onGetStarted={vi.fn()} onLogin={vi.fn()} />);

    // There is exactly one credential field on the site and it lives in the
    // existing AuthScreen; the landing page must not ask for a password.
    expect(screen.queryByLabelText(/Şifre/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/E-posta/)).not.toBeInTheDocument();
  });

  it('keeps a single page-level heading for assistive technology', () => {
    render(<LandingPage onGetStarted={vi.fn()} onLogin={vi.fn()} />);

    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });
});
