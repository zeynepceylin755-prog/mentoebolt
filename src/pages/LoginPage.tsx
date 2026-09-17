import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      await login(email, password);
      navigate('/app');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Giriş başarısız');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-bg px-4">
      <div className="max-w-md w-full space-y-8">
        <div>
          <h1 className="text-3xl font-bold text-ink text-center">Mentora</h1>
          <h2 className="mt-6 text-center text-2xl font-semibold text-ink">
            Öğrenci girişi
          </h2>
          <p className="mt-2 text-center text-sm text-muted">
            Matematik öğrenme yolculuğuna devam et
          </p>
        </div>

        <form className="mt-8 space-y-6" onSubmit={handleSubmit}>
          <div className="space-y-4">
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-muted">
                E-posta
              </label>
              <input
                id="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-1 block w-full rounded-md border-border bg-surface px-3 py-2 text-ink outline-none focus:border-accent"
                placeholder="ornek@email.com"
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-medium text-muted">
                Şifre
              </label>
              <input
                id="password"
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="mt-1 block w-full rounded-md border-border bg-surface px-3 py-2 text-ink outline-none focus:border-accent"
                placeholder="••••••••"
              />
            </div>
          </div>

          {error && (
            <div className="rounded-md bg-red-50 border border-red-200 px-4 py-3">
              <p className="text-sm text-red-800">{error}</p>
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-md bg-accent px-4 py-3 text-sm font-semibold text-ink hover:bg-accent/90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? 'Giriş yapılıyor...' : 'Giriş yap'}
          </button>

          <p className="text-center text-sm text-muted">
            Hesabın yok mu?{' '}
            <Link to="/signup" className="font-medium text-accent hover:text-accent/90">
              Kayıt ol
            </Link>
          </p>
        </form>
      </div>
    </div>
  );
}
