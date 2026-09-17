import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AuthScreen from './AuthScreen';
import { ApiError } from '@/lib/apiClient';

const login = vi.fn();
const signup = vi.fn();

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ login, signup }),
}));

describe('AuthScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    login.mockResolvedValue(undefined);
    signup.mockResolvedValue(undefined);
  });

  it('starts on sign-in and offers sign-up', () => {
    render(<AuthScreen onAuthenticated={vi.fn()} />);

    expect(screen.getByRole('heading', { level: 1, name: 'Tekrar hoş geldin.' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Henüz hesabım yok/ })).toBeInTheDocument();
  });

  it('opens directly on sign-up when asked to, without a second form', async () => {
    const user = userEvent.setup();
    render(<AuthScreen initialMode="signup" onAuthenticated={vi.fn()} />);

    expect(
      screen.getByRole('heading', { level: 1, name: 'Yolun buradan başlıyor.' })
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/Sınıfın/)).toBeInTheDocument();

    // The sign-in form is still reachable through the same component.
    await user.click(screen.getByRole('button', { name: /Zaten hesabım var/ }));
    expect(screen.getByRole('heading', { level: 1, name: 'Tekrar hoş geldin.' })).toBeInTheDocument();
  });

  it('offers a way back to the landing page only when a handler is given', async () => {
    const user = userEvent.setup();
    const onBack = vi.fn();
    render(<AuthScreen onAuthenticated={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /^Geri$/ })).not.toBeInTheDocument();

    render(<AuthScreen onAuthenticated={vi.fn()} onBack={onBack} />);
    await user.click(screen.getByRole('button', { name: /^Geri$/ }));

    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('signs in with the entered credentials', async () => {
    const user = userEvent.setup();
    const onAuthenticated = vi.fn();
    render(<AuthScreen onAuthenticated={onAuthenticated} />);

    await user.type(screen.getByLabelText(/E-posta/), 'ayse@example.com');
    await user.type(screen.getByLabelText(/^Şifre/), 'gizli-sifre');
    await user.click(screen.getByRole('button', { name: /Giriş yap/ }));

    expect(login).toHaveBeenCalledWith('ayse@example.com', 'gizli-sifre');
    expect(onAuthenticated).toHaveBeenCalled();
  });

  it('never asks for credentials the backend does not require on sign-in', () => {
    render(<AuthScreen onAuthenticated={vi.fn()} />);

    expect(screen.queryByLabelText(/Sınıf/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Soyad/)).not.toBeInTheDocument();
  });

  it('explains itself in the product own words, not startup marketing', () => {
    render(<AuthScreen onAuthenticated={vi.fn()} />);

    const text = document.body.textContent ?? '';
    expect(text).toContain('MENTORA');
    for (const forbidden of ['AI-powered', 'revolutionary', 'devrim', 'sihir', 'AI destekli']) {
      expect(text).not.toContain(forbidden);
    }
  });

  it('validates missing sign-in fields before calling the backend', async () => {
    const user = userEvent.setup();
    render(<AuthScreen onAuthenticated={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: /Giriş yap/ }));

    expect(login).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(/E-posta ve şifreni/);
  });

  it('asks only for what signup needs and no long survey', async () => {
    const user = userEvent.setup();
    render(<AuthScreen onAuthenticated={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: /Henüz hesabım yok/ }));

    expect(screen.getByLabelText(/Adın/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Soyadın/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Sınıfın/)).toBeInTheDocument();
    // Nothing beyond name, e-mail, password and grade is requested: no school,
    // no phone, no preferences.
    expect(screen.queryByLabelText(/Okul/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Telefon/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Hedef/)).not.toBeInTheDocument();
  });

  it('rejects a short password on signup', async () => {
    const user = userEvent.setup();
    render(<AuthScreen onAuthenticated={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: /Henüz hesabım yok/ }));

    await user.type(screen.getByLabelText(/Adın/), 'Ayşe');
    await user.type(screen.getByLabelText(/Soyadın/), 'Yılmaz');
    await user.type(screen.getByLabelText(/E-posta/), 'ayse@example.com');
    await user.type(screen.getByLabelText(/^Şifre/), 'kisa');
    await user.type(screen.getByLabelText(/Sınıfın/), '11');
    await user.click(screen.getByRole('button', { name: /Hesabımı oluştur/ }));

    expect(signup).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(/en az 8 karakter/);
  });

  it('creates the account with the grade the backend requires', async () => {
    const user = userEvent.setup();
    const onAuthenticated = vi.fn();
    render(<AuthScreen onAuthenticated={onAuthenticated} />);
    await user.click(screen.getByRole('button', { name: /Henüz hesabım yok/ }));

    await user.type(screen.getByLabelText(/Adın/), 'Ayşe');
    await user.type(screen.getByLabelText(/Soyadın/), 'Yılmaz');
    await user.type(screen.getByLabelText(/E-posta/), 'ayse@example.com');
    await user.type(screen.getByLabelText(/^Şifre/), 'Guclu!Sifre1');
    await user.type(screen.getByLabelText(/Sınıfın/), '11');
    await user.click(screen.getByRole('button', { name: /Hesabımı oluştur/ }));

    expect(signup).toHaveBeenCalledWith({
      email: 'ayse@example.com',
      password: 'Guclu!Sifre1',
      firstName: 'Ayşe',
      lastName: 'Yılmaz',
      grade: 11,
    });
    expect(onAuthenticated).toHaveBeenCalled();
  });

  it('shows a calm message when the credentials are wrong', async () => {
    const user = userEvent.setup();
    login.mockRejectedValue(new ApiError('Yetkisiz', 401));
    render(<AuthScreen onAuthenticated={vi.fn()} />);

    await user.type(screen.getByLabelText(/E-posta/), 'ayse@example.com');
    await user.type(screen.getByLabelText(/^Şifre/), 'Yanlis!Sifre1');
    await user.click(screen.getByRole('button', { name: /Giriş yap/ }));

    expect(await screen.findByRole('alert')).toHaveTextContent('E-posta veya şifre eşleşmedi');
  });

  it('shows a calm message when the network is unreachable', async () => {
    const user = userEvent.setup();
    login.mockRejectedValue(new ApiError('offline', 0));
    render(<AuthScreen onAuthenticated={vi.fn()} />);

    await user.type(screen.getByLabelText(/E-posta/), 'ayse@example.com');
    await user.type(screen.getByLabelText(/^Şifre/), 'Sifre!1234A');
    await user.click(screen.getByRole('button', { name: /Giriş yap/ }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Sunucuya ulaşamadık');
  });

  it('labels every credential input for assistive technology', () => {
    render(<AuthScreen onAuthenticated={vi.fn()} />);

    expect(screen.getByLabelText(/E-posta/)).toHaveAttribute('type', 'email');
    expect(screen.getByLabelText(/^Şifre/)).toHaveAttribute('type', 'password');
  });
});
