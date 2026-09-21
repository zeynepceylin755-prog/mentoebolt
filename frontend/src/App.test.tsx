import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';
import * as journey from '@/lib/studentJourney';
import type { NextRecommendation } from '@/lib/studentJourney';

/**
 * App-level integration: authentication gating, protected destinations and the
 * hash-driven routing that the real student uses.
 */

vi.mock('@/lib/studentJourney', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/studentJourney')>();
  return {
    ...actual,
    getNextRecommendation: vi.fn(),
    getMySkillProgress: vi.fn(),
    getAttemptsForStudent: vi.fn(),
    getMyProfile: vi.fn().mockResolvedValue({
      id: 'sp1',
      userId: 'u1',
      grade: 11,
      school: 'Örnek Lisesi',
      learningStage: 'DISCOVERY',
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    }),
  };
});

const getNextRecommendation = vi.mocked(journey.getNextRecommendation);
const getMySkillProgress = vi.mocked(journey.getMySkillProgress);
const getAttemptsForStudent = vi.mocked(journey.getAttemptsForStudent);

const recommendation: NextRecommendation = {
  actionType: 'REMEDIATE_ERROR',
  reasonCode: 'REPEATED_ERROR',
  microSkillId: 'skill-1',
  reason: 'Tekrar eden bir zorlanma var.',
  priority: 1,
  evidence: { repeatedErrorPattern: true },
  estimatedTimeMinutes: 10,
};

/**
 * Seed localStorage with a decodable, non-authoritative access token.
 *
 * A real token always carries an `exp`; the session-restore path rejects an
 * expired or expiry-less token (it refreshes instead), so the fixture must look
 * like a live token for these app-level flows to exercise a signed-in session.
 */
function seedSession() {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const payload = btoa(JSON.stringify({ userId: 'u-1', email: 'ayse@example.com', role: 'STUDENT', exp }));
  const token = `header.${payload}.signature`;
  localStorage.setItem('access_token', token);
  localStorage.setItem('refresh_token', 'refresh-token');
  localStorage.setItem('mentora.readiness.v1:u-1', 'skipped');
}

describe('App', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getNextRecommendation.mockResolvedValue(recommendation);
    getMySkillProgress.mockResolvedValue([]);
    getAttemptsForStudent.mockResolvedValue([]);
    window.location.hash = '';
  });

  afterEach(() => {
    vi.clearAllMocks();
    window.location.hash = '';
  });

  it('shows the Mentora landing page to an unauthenticated visitor', async () => {
    render(<App />);

    expect(
      await screen.findByRole('heading', { level: 1, name: /Matematikte yolunu bul/ })
    ).toBeInTheDocument();
  });

  it('never renders the student product to an unauthenticated visitor', async () => {
    render(<App />);
    await screen.findByRole('heading', { level: 1, name: /Matematikte yolunu bul/ });

    expect(screen.queryByText('Bugün ne yapmalıyım?')).not.toBeInTheDocument();
    expect(screen.queryByText('Bir soru getir')).not.toBeInTheDocument();
  });

  it('restores a session and lands the student on Bugün', async () => {
    seedSession();
    render(<App />);

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Bugün ne yapmalıyım?' })
    ).toBeInTheDocument();
  });

  it('opens the destination named in the URL hash', async () => {
    seedSession();
    window.location.hash = 'tekrarlarim';
    render(<App />);

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Tekrar eden noktaların' })
    ).toBeInTheDocument();
  });

  it('falls back to Bugün for an unknown hash', async () => {
    seedSession();
    window.location.hash = 'bilinmeyen-sayfa';
    render(<App />);

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Bugün ne yapmalıyım?' })
    ).toBeInTheDocument();
  });

  it('navigates between product destinations through the shell', async () => {
    const user = userEvent.setup();
    seedSession();
    render(<App />);
    await screen.findByRole('heading', { level: 1, name: 'Bugün ne yapmalıyım?' });

    const nav = screen.getAllByRole('navigation')[0];
    await user.click(within(nav).getByRole('button', { name: /Soru Getir/ }));

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Bir soru getir' })
    ).toBeInTheDocument();
    expect(window.location.hash).toBe('#soru-getir');
  });

  it('reaches every product destination without a dead end', async () => {
    seedSession();
    const destinations: Array<[string, string]> = [
      ['', 'Bugün ne yapmalıyım?'],
      ['soru-getir', 'Bir soru getir'],
      ['tekrarlarim', 'Tekrar eden noktaların'],
      ['gelisim', 'Gelişimin'],
      ['profil', 'Hesabın'],
    ];

    for (const [hash, heading] of destinations) {
      window.location.hash = hash;
      const { unmount } = render(<App />);
      // Profil now loads data asynchronously, use waitFor with timeout
      if (hash === 'profil') {
        await waitFor(
          () => expect(screen.getByRole('heading', { level: 1, name: heading })).toBeInTheDocument(),
          { timeout: 5000 }
        );
      } else {
        expect(await screen.findByRole('heading', { level: 1, name: heading })).toBeInTheDocument();
      }
      unmount();
    }
  });

  it('syncs the rendered page when the hash changes', async () => {
    seedSession();
    render(<App />);
    await screen.findByRole('heading', { level: 1, name: 'Bugün ne yapmalıyım?' });

    window.location.hash = 'gelisim';
    window.dispatchEvent(new HashChangeEvent('hashchange'));

    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 1, name: 'Gelişimin' })).toBeInTheDocument()
    );
  });

  it('resolves the initial session state before rendering any screen', async () => {
    // The app never flashes the product before it knows whether a session
    // exists: the public screen is only shown once restore has settled.
    render(<App />);

    expect(
      await screen.findByRole('heading', { level: 1, name: /Matematikte yolunu bul/ })
    ).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 1, name: 'Bugün ne yapmalıyım?' }))
      .not.toBeInTheDocument();
  });

  it('returns to the public landing page after logging out', async () => {
    const user = userEvent.setup();
    seedSession();
    render(<App />);
    await screen.findByRole('heading', { level: 1, name: 'Bugün ne yapmalıyım?' });

    await user.click(screen.getAllByRole('button', { name: 'Çıkış' })[0]);

    expect(
      await screen.findByRole('heading', { level: 1, name: /Matematikte yolunu bul/ })
    ).toBeInTheDocument();
  });

  // --------------------------------------------------------------- public flow
  it('opens the sign-up experience from the landing page early-access CTA', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('heading', { level: 1, name: /Matematikte yolunu bul/ });

    await user.click(screen.getAllByRole('button', { name: /Erken Erişime Katıl/ })[0]);

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Yolun buradan başlıyor.' })
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/Sınıfın/)).toBeInTheDocument();
  });

  it('opens the sign-in experience from the landing page "Giriş yap"', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('heading', { level: 1, name: /Matematikte yolunu bul/ });

    await user.click(screen.getAllByRole('button', { name: /^Giriş yap$/ })[0]);

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Tekrar hoş geldin.' })
    ).toBeInTheDocument();
    expect(screen.queryByLabelText(/Sınıfın/)).not.toBeInTheDocument();
  });

  it('returns to the landing page from the auth screen', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('heading', { level: 1, name: /Matematikte yolunu bul/ });
    await user.click(screen.getAllByRole('button', { name: /^Giriş yap$/ })[0]);
    await screen.findByRole('heading', { level: 1, name: 'Tekrar hoş geldin.' });

    await user.click(screen.getByRole('button', { name: /^Geri$/ }));

    expect(
      await screen.findByRole('heading', { level: 1, name: /Matematikte yolunu bul/ })
    ).toBeInTheDocument();
  });

  it('never shows the landing page once a session exists', async () => {
    seedSession();
    render(<App />);
    await screen.findByRole('heading', { level: 1, name: 'Bugün ne yapmalıyım?' });

    expect(
      screen.queryByRole('heading', { level: 1, name: /Matematikte yolunu bul/ })
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 1, name: 'Tekrar hoş geldin.' }))
      .not.toBeInTheDocument();
  });
});
