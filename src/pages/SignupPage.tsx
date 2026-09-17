import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

export default function SignupPage() {
  const [formData, setFormData] = useState({
    email: '',
    password: '',
    firstName: '',
    lastName: '',
    grade: 11,
    school: '',
  });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const { signup } = useAuth();
  const navigate = useNavigate();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      await signup(formData);
      navigate('/app');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Kayıt başarısız');
    } finally {
      setLoading(false);
    }
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: name === 'grade' ? parseInt(value) || 11 : value,
    }));
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-bg px-4 py-8">
      <div className="max-w-md w-full space-y-8">
        <div>
          <h1 className="text-3xl font-bold text-ink text-center">Mentora</h1>
          <h2 className="mt-6 text-center text-2xl font-semibold text-ink">
            Öğrenci kaydı
          </h2>
          <p className="mt-2 text-center text-sm text-muted">
            Matematik öğrenme yolculuğuna başla
          </p>
        </div>

        <form className="mt-8 space-y-6" onSubmit={handleSubmit}>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="firstName" className="block text-sm font-medium text-muted">
                  Ad
                </label>
                <input
                  id="firstName"
                  name="firstName"
                  type="text"
                  required
                  value={formData.firstName}
                  onChange={handleChange}
                  className="mt-1 block w-full rounded-md border-border bg-surface px-3 py-2 text-ink outline-none focus:border-accent"
                  placeholder="Ahmet"
                />
              </div>

              <div>
                <label htmlFor="lastName" className="block text-sm font-medium text-muted">
                  Soyad
                </label>
                <input
                  id="lastName"
                  name="lastName"
                  type="text"
                  required
                  value={formData.lastName}
                  onChange={handleChange}
                  className="mt-1 block w-full rounded-md border-border bg-surface px-3 py-2 text-ink outline-none focus:border-accent"
                  placeholder="Yılmaz"
                />
              </div>
            </div>

            <div>
              <label htmlFor="email" className="block text-sm font-medium text-muted">
                E-posta
              </label>
              <input
                id="email"
                name="email"
                type="email"
                required
                value={formData.email}
                onChange={handleChange}
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
                name="password"
                type="password"
                required
                minLength={8}
                value={formData.password}
                onChange={handleChange}
                className="mt-1 block w-full rounded-md border-border bg-surface px-3 py-2 text-ink outline-none focus:border-accent"
                placeholder="En az 8 karakter"
              />
              <p className="mt-1 text-xs text-muted">
                En az 8 karakter, büyük harf, küçük harf, sayı ve özel karakter içermelidir
              </p>
            </div>

            <div>
              <label htmlFor="grade" className="block text-sm font-medium text-muted">
                Sınıf
              </label>
              <select
                id="grade"
                name="grade"
                required
                value={formData.grade}
                onChange={handleChange}
                className="mt-1 block w-full rounded-md border-border bg-surface px-3 py-2 text-ink outline-none focus:border-accent"
              >
                {Array.from({ length: 12 }, (_, i) => i + 1).map(grade => (
                  <option key={grade} value={grade}>
                    {grade}. Sınıf
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="school" className="block text-sm font-medium text-muted">
                Okul (isteğe bağlı)
              </label>
              <input
                id="school"
                name="school"
                type="text"
                value={formData.school}
                onChange={handleChange}
                className="mt-1 block w-full rounded-md border-border bg-surface px-3 py-2 text-ink outline-none focus:border-accent"
                placeholder="Okul adı"
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
            {loading ? 'Kayıt yapılıyor...' : 'Kayıt ol'}
          </button>

          <p className="text-center text-sm text-muted">
            Zaten hesabın var mı?{' '}
            <Link to="/login" className="font-medium text-accent hover:text-accent/90">
              Giriş yap
            </Link>
          </p>
        </form>
      </div>
    </div>
  );
}
