import { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { getMyProfile, updateStudentGrade, type StudentProfile } from '@/lib/studentJourney';
import { useCachedResource } from '@/lib/requestCache';
import { ApiError } from '@/lib/apiClient';
import PageContainer from '@/components/ui/PageContainer';
import PageHeader from '@/components/ui/PageHeader';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Loading from '@/components/ui/Loading';
import ErrorState from '@/components/ui/ErrorState';

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
  const [editingGrade, setEditingGrade] = useState(false);
  const [newGrade, setNewGrade] = useState('');
  const [gradeError, setGradeError] = useState<string | null>(null);
  const [updating, setUpdating] = useState(false);

  const { data: profile, loading, error, refresh } = useCachedResource(
    'student/profile',
    () => getMyProfile(),
    'Profil bilgileri şu anda yüklenemedi. Lütfen tekrar dene.'
  );

  const displayName = [user?.firstName, user?.lastName]
    .map((part) => (part ?? '').trim())
    .filter(Boolean)
    .join(' ');

  const grade = profile?.grade ?? user?.studentProfile?.grade;

  async function handleGradeUpdate() {
    if (!profile) return;
    const gradeNum = Number(newGrade);
    if (!gradeNum || !Number.isInteger(gradeNum) || gradeNum < 1 || gradeNum > 12) {
      setGradeError('Sınıfını 1 ile 12 arasında seçmen gerekiyor.');
      return;
    }

    setGradeError(null);
    setUpdating(true);
    try {
      await updateStudentGrade(profile.id, gradeNum);
      setEditingGrade(false);
      refresh();
    } catch (err) {
      if (err instanceof ApiError) {
        setGradeError(err.message);
      } else {
        setGradeError('Güncelleme başarısız oldu. Tekrar dene.');
      }
    } finally {
      setUpdating(false);
    }
  }

  if (loading) {
    return (
      <PageContainer>
        <Loading state="loading" message="Profil bilgileri yükleniyor..." />
      </PageContainer>
    );
  }

  if (error) {
    return (
      <PageContainer>
        <ErrorState
          title="Profil bilgilerine ulaşamadık"
          message={error}
          onRetry={() => void refresh()}
        />
      </PageContainer>
    );
  }

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

          <div className="border-t border-border pt-5">
            <dt className="text-label font-medium uppercase tracking-wide text-muted">
              Sınıf
            </dt>
            {editingGrade ? (
              <div className="mt-1.5">
                <Input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={12}
                  value={newGrade}
                  onChange={(e) => setNewGrade(e.target.value)}
                  helperText={gradeError || undefined}
                  error={gradeError || undefined}
                  className="max-w-[120px]"
                />
                <div className="mt-2 flex gap-2">
                  <Button
                    type="button"
                    size="sm"
                    loading={updating}
                    onClick={handleGradeUpdate}
                  >
                    Kaydet
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setEditingGrade(false);
                      setGradeError(null);
                      setNewGrade('');
                    }}
                  >
                    İptal
                  </Button>
                </div>
              </div>
            ) : (
              <div className="mt-1.5 flex items-center justify-between">
                <dd className="text-body text-ink">{grade ? `${grade}. sınıf` : '—'}</dd>
                {profile && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setEditingGrade(true);
                      setNewGrade(String(grade || ''));
                      setGradeError(null);
                    }}
                  >
                    Düzenle
                  </Button>
                )}
              </div>
            )}
          </div>

          {profile?.school && (
            <div className="border-t border-border pt-5">
              <dt className="text-label font-medium uppercase tracking-wide text-muted">
                Okul
              </dt>
              <dd className="mt-1.5 text-body text-ink">{profile.school || '—'}</dd>
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
