import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Profil from './Profil';

const logout = vi.fn().mockResolvedValue(undefined);

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    user: {
      id: 'u1',
      email: 'ayse@example.com',
      firstName: 'Ayşe',
      lastName: 'Yılmaz',
      role: 'STUDENT',
      emailVerified: true,
      studentProfile: { id: 'sp1', grade: 11 },
    },
    logout,
  }),
}));

vi.mock('@/lib/studentJourney', () => ({
  getMyProfile: vi.fn().mockResolvedValue({
    id: 'sp1',
    userId: 'u1',
    grade: 11,
    school: 'Örnek Lisesi',
    learningStage: 'DISCOVERY',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  }),
}));

vi.mock('@/lib/requestCache', () => ({
  useCachedResource: (key: string, loader: () => Promise<any>, errorMsg: string) => {
    const data = loader();
    return { data, loading: false, error: null, refresh: vi.fn() };
  },
}));

describe('Profil', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows the account details the product actually knows', () => {
    render(<Profil />);

    expect(screen.getByRole('heading', { level: 1, name: 'Hesabın' })).toBeInTheDocument();
    expect(screen.getByText('Ayşe Yılmaz')).toBeInTheDocument();
    expect(screen.getByText('ayse@example.com')).toBeInTheDocument();
    expect(screen.getByText('11. sınıf')).toBeInTheDocument();
  });

  it('does not surface the founder identity or personal biography', () => {
    const { container } = render(<Profil />);
    const text = container.textContent ?? '';

    for (const forbidden of ['Kurucu', 'founder', 'Yaş', 'Lise', 'biyografi']) {
      expect(text).not.toContain(forbidden);
    }
  });

  it('asks for nothing beyond what is already stored', () => {
    render(<Profil />);

    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /kaydet/i })).not.toBeInTheDocument();
  });

  it('explains how the student data is treated', () => {
    render(<Profil />);
    expect(screen.getByText(/yalnızca sana gösterilir/)).toBeInTheDocument();
  });

  it('ends the session through the sign-out action', async () => {
    const user = userEvent.setup();
    render(<Profil />);

    await user.click(screen.getByRole('button', { name: 'Çıkış yap' }));
    expect(logout).toHaveBeenCalled();
  });
});
