import { Link, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

export default function AppShell() {
  const { user, logout } = useAuth();
  const location = useLocation();

  const navigation = [
    { name: 'Bugün', href: '/app/today' },
    { name: 'Soru Çöz', href: '/app/question' },
    { name: 'Yanlışlarım', href: '/app/mistakes' },
    { name: 'Matematik Yolum', href: '/app/path' },
    { name: 'Gelişimim', href: '/app/progress' },
  ];

  return (
    <div className="min-h-screen bg-bg">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex h-16 items-center justify-between">
            <div className="flex items-center">
              <Link to="/app" className="text-xl font-bold text-ink">
                Mentora
              </Link>
              <nav className="ml-10 flex space-x-4">
                {navigation.map((item) => (
                  <Link
                    key={item.name}
                    to={item.href}
                    className={`text-sm font-medium transition-colors ${
                      location.pathname === item.href
                        ? 'text-accent'
                        : 'text-muted hover:text-ink'
                    }`}
                  >
                    {item.name}
                  </Link>
                ))}
              </nav>
            </div>
            <div className="flex items-center space-x-4">
              <Link
                to="/app/profile"
                className="text-sm font-medium text-muted hover:text-ink"
              >
                {user?.firstName} {user?.lastName}
              </Link>
              <button
                onClick={logout}
                className="text-sm font-medium text-muted hover:text-ink"
              >
                Çıkış
              </button>
            </div>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8">
        <Outlet />
      </main>
    </div>
  );
}
