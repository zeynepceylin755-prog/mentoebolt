import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import StudentShell from './StudentShell';

const logout = vi.fn().mockResolvedValue(undefined);

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'u1', email: 'ayse@example.com', firstName: 'Ayşe', lastName: 'Yılmaz', role: 'STUDENT', emailVerified: true },
    logout,
  }),
}));

describe('StudentShell', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('exposes the four primary learning destinations and account area', () => {
    render(<StudentShell currentView="bugun" onNavigate={vi.fn()}>content</StudentShell>);

    const navs = screen.getAllByRole('navigation');
    const text = navs.map((nav) => nav.textContent ?? '').join(' ');

    for (const label of ['Bugün', 'Soru Getir', 'Tekrarlarım', 'Gelişim', 'Profil']) {
      expect(text).toContain(label);
    }
    for (const forbidden of ['Ingestion', 'OCR', 'Skill Mapping', 'Review Queue', 'API', 'Matematik Yolum', 'Yanlışlarım']) {
      expect(text).not.toContain(forbidden);
    }
  });

  it('marks the current destination for assistive technology', () => {
    render(<StudentShell currentView="tekrarlarim" onNavigate={vi.fn()}>x</StudentShell>);
    const current = screen.getAllByRole('button', { current: 'page' });
    expect(current.length).toBeGreaterThan(0);
    expect(current[0].textContent).toContain('Tekrarlarım');
  });

  it('navigates when a destination is chosen', async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    render(<StudentShell currentView="bugun" onNavigate={onNavigate}>x</StudentShell>);

    const nav = screen.getAllByRole('navigation', { name: 'Ana menü' })[0];
    await user.click(within(nav).getByRole('button', { name: /Tekrarlarım/ }));

    expect(onNavigate).toHaveBeenCalledWith('tekrarlarim');
  });

  it('renders the page content it is given', () => {
    render(
      <StudentShell currentView="bugun" onNavigate={vi.fn()}>
        <p>Bugün içeriği</p>
      </StudentShell>
    );
    expect(screen.getByText('Bugün içeriği')).toBeInTheDocument();
  });

  it('offers a way to end the session', async () => {
    const user = userEvent.setup();
    render(<StudentShell currentView="bugun" onNavigate={vi.fn()}>x</StudentShell>);

    const exitButtons = screen.getAllByRole('button', { name: 'Çıkış' });
    await user.click(exitButtons[0]);
    expect(logout).toHaveBeenCalled();
  });

  it('keeps the brand name visible without exposing a founder identity', () => {
    const { container } = render(
      <StudentShell currentView="bugun" onNavigate={vi.fn()}>x</StudentShell>
    );
    const text = container.textContent ?? '';
    expect(text).toContain('MENTORA');
    for (const forbidden of ['Kurucu', 'founder', 'yaşında', 'okul']) {
      expect(text).not.toContain(forbidden);
    }
  });

  it('does not show matematik-yolum or yanlislarim (renamed to tekrarlarim)', () => {
    render(<StudentShell currentView="bugun" onNavigate={vi.fn()}>content</StudentShell>);

    const container = render(<StudentShell currentView="bugun" onNavigate={vi.fn()}>content</StudentShell>).container;
    const text = container.textContent ?? '';
    expect(text).not.toContain('Matematik Yolum');
    expect(text).not.toContain('Yanlışlarım');
  });
});
