import { useAuth } from '@/contexts/AuthContext';
import PageContainer from '@/components/ui/PageContainer';
import PageHeader from '@/components/ui/PageHeader';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';

/**
 * "Profil" — the student's own account details.
 *
 * Deliberately minimal: it shows what the product actually knows and asks for
 * nothing more. No avatar picker, no bio, no notification preferences — none of
 * which the learning flow uses. The founder's identity is never surfaced here;
 * the brand stands on its own.
 */
export default function Profil() {
  const { user, logout } = useAuth();

  const displayName = [user?.firstName, user?.lastName]
    .map((part) => (part ?? '').trim())
    .filter(Boolean)
    .join(' ');

  const grade = user?.studentProfile?.grade;

  return (
    <PageContainer size="narrow">
      <PageHeader eyebrow="Profil" title="Hesabın" />

      <Card variant="bordered" className="p-6">
        <dl className="space-y-5">
          <div>
            <dt className="text-label font-medium uppercase tracking-wide text-muted">
              Ad Soyad
            </dt>
            <dd className="mt-1.5 text-body text-ink">{displayName || '—'}</dd>
          </div>

          <div className="border-t border-border pt-5">
            <dt className="text-label font-medium uppercase tracking-wide text-muted">
              E-posta
            </dt>
            <dd className="mt-1.5 break-all text-body text-ink">{user?.email || '—'}</dd>
          </div>

          {grade !== undefined && (
            <div className="border-t border-border pt-5">
              <dt className="text-label font-medium uppercase tracking-wide text-muted">
                Sınıf
              </dt>
              <dd className="mt-1.5 text-body text-ink">{grade}. sınıf</dd>
            </div>
          )}
        </dl>
      </Card>

      <Card variant="bordered" className="mt-5 p-6">
        <h2 className="text-label font-medium uppercase tracking-wide text-muted">
          Verilerin
        </h2>
        <p className="mt-3 text-body-sm leading-relaxed text-muted">
          Çözdüğün sorular ve onlardan çıkan öğrenme kayıtları yalnızca sana
          gösterilir. Doğru cevaplar hiçbir listede açığa çıkarılmaz.
        </p>
      </Card>

      <div className="mt-6">
        <Button variant="secondary" size="lg" fullWidth onClick={() => void logout()}>
          Çıkış yap
        </Button>
      </div>
    </PageContainer>
  );
}
