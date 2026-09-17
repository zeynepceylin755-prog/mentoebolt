import { useAuth } from '../../contexts/AuthContext';

export default function ProfilePage() {
  const { user, logout } = useAuth();

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold text-ink">Profil</h1>
      <div className="mt-6 space-y-4">
        <div>
          <p className="text-sm text-muted">Ad</p>
          <p className="text-ink">{user?.firstName} {user?.lastName}</p>
        </div>
        <div>
          <p className="text-sm text-muted">E-posta</p>
          <p className="text-ink">{user?.email}</p>
        </div>
        {user?.studentProfile && (
          <div>
            <p className="text-sm text-muted">Sınıf</p>
            <p className="text-ink">{user.studentProfile.grade}. Sınıf</p>
          </div>
        )}
        <button
          onClick={logout}
          className="mt-4 rounded-md border border-border px-4 py-2 text-sm text-ink hover:bg-surface"
        >
          Çıkış yap
        </button>
      </div>
    </div>
  );
}
