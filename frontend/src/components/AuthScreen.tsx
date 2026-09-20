import { useState } from 'react';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { ApiError } from '@/lib/apiClient';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';

interface AuthScreenProps {
  /** Called once the student is authenticated and the short intro is done. */
  onAuthenticated: () => void;
  /**
   * Which form to open on. Defaults to 'login', which is what the screen has
   * always done, so existing callers keep their behaviour unchanged.
   */
  initialMode?: Mode;
  /**
   * Optional escape hatch back to the public landing page. When omitted the
   * button is not rendered, so the screen stays usable on its own.
   */
  onBack?: () => void;
}

type Mode = 'login' | 'signup' | 'forgot-password' | 'reset-password' | 'reset-password-sent' | 'reset-success';

/**
 * The backend's password policy, mirrored so the student gets an actionable
 * message before a round trip instead of a generic rejection.
 *
 * These rules MUST stay in sync with `PasswordService.validatePasswordStrength`
 * — the backend remains authoritative, this is only an early, specific hint.
 */
function describePasswordProblem(password: string): string | null {
  if (password.length < 8) {
    return 'Şifren en az 8 karakter olmalı.';
  }
  if (!/[A-Zçğıöşü]/.test(password)) {
    return 'Şifrende en az bir büyük harf olmalı.';
  }
  if (!/[a-zçğıöşü]/.test(password)) {
    return 'Şifrende en az bir küçük harf olmalı.';
  }
  if (!/\d/.test(password)) {
    return 'Şifrende en az bir rakam olmalı.';
  }
  if (!/[!@#$%^&*(),.?":{}|<>]/.test(password)) {
    return 'Şifrende en az bir özel karakter olmalı (ör. ! ? . ,).';
  }
  return null;
}

/**
 * Mentora's only public screen.
 *
 * It is intentionally a single, quiet page: no marketing panels, no illustration,
 * no social sign-in the backend does not support. It asks only for what the
 * backend genuinely requires to create a student account, and explains in one
 * line what the product is before asking for anything.
 *
 * The "onboarding" is the signup form itself — the student reaches first value in
 * one step instead of a survey.
 */
export default function AuthScreen({ onAuthenticated, initialMode = 'login', onBack }: AuthScreenProps) {
  const { login, signup, forgotPassword, resetPassword } = useAuth();
  const [mode, setMode] = useState<Mode>(initialMode);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [grade, setGrade] = useState('');
  const [resetToken, setResetToken] = useState('');

  /** Human wording for auth failures. Raw backend/provider text is never shown. */
  function describeAuthFailure(err: unknown): string {
    if (err instanceof ApiError) {
      if (err.status === 0) {
        return 'Sunucuya ulaşamadık. Bağlantını kontrol edip tekrar deneyebilirsin.';
      }
      if (err.status === 401) {
        return 'E-posta veya şifre eşleşmedi. Tekrar deneyebilirsin.';
      }
      if (err.status === 409) {
        return 'Bu e-posta ile zaten bir hesap var. Giriş yapmayı deneyebilirsin.';
      }
      if (err.status === 400) {
        // The backend reports password-policy failures with a generic code; turn
        // it into the specific requirement the student has to satisfy.
        if (/password/i.test(err.message)) {
          return (
            describePasswordProblem(password) ??
            'Şifren güvenlik koşullarını karşılamıyor. Büyük harf, küçük harf, rakam ve özel karakter kullan.'
          );
        }
        if (/email/i.test(err.message)) {
          return 'Bu e-posta adresi geçerli görünmüyor. Kontrol edip tekrar dene.';
        }
        return 'Girdiğin bilgileri kontrol edip tekrar dene.';
      }
      if (err.status >= 500) {
        return 'Şu anda giriş yapamadık. Bir sorun oluştu, tekrar deneyebilirsin.';
      }
      return err.message;
    }
    if (err instanceof Error && err.message) {
      // AuthContext surfaces backend validation text directly; keep it.
      return err.message;
    }
    return 'Şu anda giriş yapamadık. Tekrar deneyebilirsin.';
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    if (mode === 'login') {
      if (!email.trim() || !password) {
        setError('E-posta ve şifreni girmen gerekiyor.');
        return;
      }
      setSubmitting(true);
      try {
        await login(email.trim(), password);
        onAuthenticated();
      } catch (err) {
        setError(describeAuthFailure(err));
      } finally {
        setSubmitting(false);
      }
      return;
    }

    // ---------------------------------------------------------------- forgot password
    if (mode === 'forgot-password') {
      if (!email.trim()) {
        setError('E-posta adresini girmen gerekiyor.');
        return;
      }
      setSubmitting(true);
      try {
        await forgotPassword(email.trim());
        setMode('reset-password-sent');
      } catch (err) {
        setError(describeAuthFailure(err));
      } finally {
        setSubmitting(false);
      }
      return;
    }

    // ---------------------------------------------------------------- reset password
    if (mode === 'reset-password') {
      if (!resetToken.trim() || !newPassword || !confirmPassword) {
        setError('Tüm alanları doldurman gerekiyor.');
        return;
      }
      if (newPassword !== confirmPassword) {
        setError('Şifreler eşleşmi.');
        return;
      }
      const passwordProblem = describePasswordProblem(newPassword);
      if (passwordProblem) {
        setError(passwordProblem);
        return;
      }
      setSubmitting(true);
      try {
        await resetPassword(resetToken.trim(), newPassword);
        setMode('reset-success');
      } catch (err) {
        setError(describeAuthFailure(err));
      } finally {
        setSubmitting(false);
      }
      return;
    }

    // ---------------------------------------------------------------- signup
    if (!email.trim() || !password || !firstName.trim() || !lastName.trim()) {
      setError('Devam etmek için tüm alanları doldur.');
      return;
    }
    const passwordProblem = describePasswordProblem(password);
    if (passwordProblem) {
      setError(passwordProblem);
      return;
    }
    const gradeNumber = Number(grade);
    if (!grade || !Number.isInteger(gradeNumber) || gradeNumber < 1 || gradeNumber > 12) {
      setError('Sınıfını 1 ile 12 arasında seçmen gerekiyor.');
      return;
    }

    setSubmitting(true);
    try {
      await signup({
        email: email.trim(),
        password,
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        grade: gradeNumber,
      });
      onAuthenticated();
    } catch (err) {
      setError(describeAuthFailure(err));
    } finally {
      setSubmitting(false);
    }
  }

  function switchMode(next: Mode) {
    setMode(next);
    setError(null);
  }

  const isSignup = mode === 'signup';
  const isLogin = mode === 'login';
  const isForgotPassword = mode === 'forgot-password';
  const isResetPassword = mode === 'reset-password';
  const isResetSent = mode === 'reset-password-sent';
  const isResetSuccess = mode === 'reset-success';

  return (
    <div className="flex min-h-screen flex-col bg-bg">
      <header className="flex items-center justify-between gap-4 px-5 py-6 sm:px-8">
        <span className="font-sora text-lg font-semibold tracking-tight text-ink">
          MENTORA
        </span>
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            className="inline-flex min-h-[44px] items-center gap-2 text-body-sm font-medium text-nav transition-colors hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Geri
          </button>
        )}
      </header>

      <main className="flex flex-1 items-start justify-center px-5 pb-16 sm:items-center sm:px-8">
        <div className="w-full max-w-[420px]">
          <h1 className="font-sora text-page-title font-semibold tracking-tight text-ink">
            {mode === 'forgot-password' ? 'Şifreni mi unuttun?' :
             mode === 'reset-password' ? 'Yeni şifre belirle' :
             mode === 'reset-password-sent' ? 'E-posta gönderildi' :
             mode === 'reset-success' ? 'Şifre sıfırlandı' :
             isSignup ? 'Yolun buradan başlıyor.' : 'Tekrar hoş geldin.'}
          </h1>
          <p className="mt-3 text-body leading-relaxed text-muted">
            {mode === 'forgot-password' ? 'E-posta adresine şifre sıfırlama bağlantısı göndereceğiz.' :
             mode === 'reset-password' ? 'Yeni şifreni belirleyebilirsin.' :
             mode === 'reset-password-sent' ? 'E-postanı kontrol et ve gelen bağlantıyı kullan.' :
             mode === 'reset-success' ? 'Şifren başarıyla sıfırlandı. Artık yeni şifrenle giriş yapabilirsin.' :
             isSignup ? 'Çözdüğün soruları getir, nerede takıldığını birlikte bulalım.' :
             'Kaldığın yerden devam edelim.'}
          </p>

          {mode === 'reset-password-sent' || mode === 'reset-success' ? (
            <div className="mt-8">
              <Button type="button" size="lg" fullWidth onClick={() => switchMode('login')}>
                Giriş yap
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="mt-8 space-y-4" noValidate>
            {mode === 'reset-password' && (
              <Input
                label="Sıfırlama kodu"
                value={resetToken}
                onChange={(e) => setResetToken(e.target.value)}
                autoComplete="one-time-code"
                required
              />
            )}

            <Input
              label="E-posta"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              placeholder="ornek@email.com"
              required={mode !== 'reset-password'}
              disabled={mode === 'reset-password'}
            />

            <Input
              label="Şifre"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={isSignup ? 'new-password' : 'current-password'}
              helperText={
                isSignup
                  ? 'En az 8 karakter; büyük harf, küçük harf, rakam ve özel karakter içermeli.'
                  : undefined
              }
              required={mode !== 'reset-password'}
              disabled={mode === 'reset-password'}
            />

            {mode === 'reset-password' && (
              <>
                <Input
                  label="Yeni şifre"
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  autoComplete="new-password"
                  helperText="En az 8 karakter; büyük harf, küçük harf, rakam ve özel karakter içermeli."
                  required
                />
                <Input
                  label="Şifre tekrar"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  autoComplete="new-password"
                  required
                />
              </>
            )}

            {isSignup && (
              <div className="grid gap-4 sm:grid-cols-2">
                <Input
                  label="Adın"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  autoComplete="given-name"
                  required
                />
                <Input
                  label="Soyadın"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  autoComplete="family-name"
                  required
                />
              </div>
            )}

            {isSignup && (
              <Input
                label="Sınıfın"
                type="number"
                inputMode="numeric"
                min={1}
                max={12}
                value={grade}
                onChange={(e) => setGrade(e.target.value)}
                helperText="Soruları sana uygun zorlukta hazırlamak için kullanılır."
                required
              />
            )}

            {error && (
              <p
                className="rounded-lg border-accent/30 bg-accent/5 px-4 py-3 text-body-sm leading-relaxed text-ink"
                role="alert"
              >
                {error}
              </p>
            )}

            <Button type="submit" size="lg" fullWidth loading={submitting}>
              {mode === 'forgot-password' ? 'Gönder' :
               mode === 'reset-password' ? 'Şifreyi sıfırla' :
               isSignup ? 'Hesabımı oluştur' : 'Giriş yap'}
              {!submitting && <ArrowRight className="h-4 w-4" aria-hidden="true" />}
            </Button>
          </form>
          )}

          <div className="mt-6 border-t border-border pt-6">
            {mode === 'login' && (
              <>
                <button
                  type="button"
                  onClick={() => switchMode('forgot-password')}
                  className="inline-flex min-h-[44px] items-center gap-2 text-body-sm font-medium text-ink transition-colors hover:text-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                >
                  Şifremi unuttum
                </button>
                <button
                  type="button"
                  onClick={() => switchMode('signup')}
                  className="inline-flex min-h-[44px] items-center gap-2 text-body-sm font-medium text-ink transition-colors hover:text-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                >
                  Henüz hesabım yok
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </button>
              </>
            )}
            {mode === 'forgot-password' && (
              <button
                type="button"
                onClick={() => switchMode('login')}
                className="inline-flex min-h-[44px] items-center gap-2 text-body-sm font-medium text-ink transition-colors hover:text-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
              >
                <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                Girişe dön
              </button>
            )}
            {mode === 'reset-password' && (
              <button
                type="button"
                onClick={() => switchMode('login')}
                className="inline-flex min-h-[44px] items-center gap-2 text-body-sm font-medium text-ink transition-colors hover:text-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
              >
                <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                Girişe dön
              </button>
            )}
            {isSignup && (
              <button
                type="button"
                onClick={() => switchMode('login')}
                className="inline-flex min-h-[44px] items-center gap-2 text-body-sm font-medium text-ink transition-colors hover:text-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
              >
                <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                Zaten hesabım var
              </button>
            )}
          </div>

          <p className="mt-10 text-body-sm leading-relaxed text-muted">
            Mentora bir matematik öğrenme ürünüdür. Soruyu sen getir, yolunu
            birlikte çıkaralım.
          </p>
        </div>
      </main>
    </div>
  );
}
