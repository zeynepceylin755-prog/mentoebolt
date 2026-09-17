import { useState } from 'react';
import {
  createIngestion,
  analyzeIngestion,
  transitionIngestion,
  createCanonicalQuestion,
  submitAnswer,
  getAttempt,
  getMySkillProgress,
  getNextRecommendation,
  type AttemptResult,
  type ErrorAnalysisView,
  type NextRecommendation,
  type SkillProgress,
} from '@/lib/studentJourney';
import { ApiError } from '@/lib/apiClient';
import GuidancePanel from '@/components/GuidancePanel';

/**
 * Phase 6.2 — Real StudentJourneyPanel integrated with canonical authentication.
 *
 * This is the authenticated version of the student journey panel that:
 * - Uses the canonical API client with automatic token management
 * - Removes manual JWT input (tokens come from AuthContext)
 * - Integrates with the protected student application shell
 * - Maintains all real backend functionality from Phase 5F.7
 */

type Phase = 'idle' | 'working' | 'answered';

export default function QuestionPage() {
  const [questionText, setQuestionText] = useState('');
  const [studentAnswer, setStudentAnswer] = useState('');

  const [phase, setPhase] = useState<Phase>('idle');
  const [statusLine, setStatusLine] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [reviewRequired, setReviewRequired] = useState(false);

  const [questionId, setQuestionId] = useState<string | null>(null);
  const [instanceId, setInstanceId] = useState<string | null>(null);
  const [attempt, setAttempt] = useState<AttemptResult | null>(null);
  const [errorAnalysis, setErrorAnalysis] = useState<ErrorAnalysisView | null>(null);
  const [mastery, setMastery] = useState<SkillProgress[]>([]);
  const [recommendation, setRecommendation] = useState<NextRecommendation | null>(null);

  function reset() {
    setPhase('idle');
    setStatusLine('');
    setError(null);
    setReviewRequired(false);
    setQuestionId(null);
    setInstanceId(null);
    setAttempt(null);
    setErrorAnalysis(null);
    setMastery([]);
    setRecommendation(null);
  }

  function handleError(err: unknown) {
    if (err instanceof ApiError) {
      if (err.status === 0) {
        setError('Sunucuya ulaşılamadı. Lütfen bağlantını kontrol et.');
      } else if (err.status === 401) {
        setError('Oturum doğrulanamadı. Lütfen tekrar giriş yap.');
      } else if (err.status === 400) {
        setError(`Girdi doğrulanamadı: ${err.message}`);
      } else if (err.status === 409) {
        setError(`Bu adım şu anda yapılamıyor: ${err.message}`);
      } else {
        setError(err.message);
      }
    } else {
      setError('Beklenmeyen bir hata oluştu.');
    }
    setPhase('idle');
  }

  async function runJourney() {
    reset();
    if (questionText.trim().length < 3) {
      setError('Lütfen en az birkaç karakterlik bir soru metni gir.');
      return;
    }

    setPhase('working');
    try {
      setStatusLine('1/5 · Soru altyapıya gönderiliyor…');
      const ingestion = await createIngestion({ rawText: questionText.trim() });

      setStatusLine('2/5 · Soru okuma ve analiz (geliştirme altyapısı) çalışıyor…');
      await analyzeIngestion(ingestion.id, questionText.trim());

      setStatusLine('3/5 · İnceleme adımına ilerletiliyor…');
      let current = await transitionIngestion(ingestion.id, 'MAPPED').catch(async () => {
        return null;
      });
      if (!current) {
        setReviewRequired(true);
      } else {
        await transitionIngestion(ingestion.id, 'REVIEW_REQUIRED');
        setReviewRequired(true);
      }

      setStatusLine('4/5 · Kanonik soru oluşturuluyor…');
      const canonical = await createCanonicalQuestion(ingestion.id);
      setQuestionId(canonical.question.id);

      if (!canonical.instance) {
        setError(
          'Bu soru için sana ait bir örnek (instance) oluşturulamadı. ' +
            'Soru yanıtlama adımı yalnızca kişisel örnek üretildiğinde mümkündür.'
        );
        setPhase('idle');
        return;
      }
      setInstanceId(canonical.instance.id);

      setStatusLine('Hazır · Cevabını girip gönderebilirsin.');
      setPhase('idle');
      setStudentAnswer('');
    } catch (err) {
      handleError(err);
    }
  }

  async function sendAnswer() {
    if (!questionId) return;
    if (studentAnswer.trim().length === 0) {
      setError('Lütfen bir cevap gir.');
      return;
    }

    setError(null);
    setStatusLine('Cevap gönderiliyor…');
    try {
      // The response already carries the authoritative evaluation result and the
      // presence of an ErrorAnalysis — no client-side derivation is performed.
      const result = await submitAnswer(questionId, studentAnswer.trim(), 30, instanceId ?? undefined);
      setAttempt(result);

      const [skills, rec] = await Promise.all([
        getMySkillProgress().catch(() => [] as SkillProgress[]),
        getNextRecommendation().catch(() => null),
      ]);
      setMastery(skills);
      setRecommendation(rec);

      // The error-classification summary comes from the safe submission result.
      // The full persisted ErrorAnalysis (hypothesis prose) is only read for an
      // EVALUATED incorrect attempt, and is shown as backend-owned text.
      if (result.errorAnalysis) {
        const attemptDetail: any = await getAttempt(result.attemptId).catch(() => null);
        setErrorAnalysis({
          errorType: attemptDetail?.errorAnalysis?.errorType ?? null,
          hypothesis: attemptDetail?.errorAnalysis?.hypothesis ?? null,
          validated: result.errorAnalysis.validated,
        });
      } else {
        setErrorAnalysis(null);
      }

      setStatusLine('Cevap değerlendirildi.');
      setPhase('answered');
    } catch (err) {
      handleError(err);
      setStatusLine('');
    }
  }

  const busy = phase === 'working';

  return (
    <div className="max-w-3xl mx-auto">
      <h1 className="text-2xl font-bold text-ink mb-4">Soru Çöz</h1>
      <p className="text-muted mb-6">
        Bu bölüm gerçek backend'e bağlanır: soru altyapıya gönderilir, inceleme adımından
        geçer, kanonik soru oluşturulur ve verdiğin cevap backend tarafından değerlendirilir.
        Doğruluk, ustalık ve hata analizi burada hesaplanmaz — hepsi sunucudan gelir.
      </p>

      <div className="rounded-md border-border bg-surface px-4 py-3 text-sm text-muted mb-6">
        <strong className="font-medium text-ink">Not:</strong> Şu anda soru okuma ve analiz
        altyapısı test sağlayıcısıyla çalışıyor. Bu adımlar geliştirme ortamına aittir ve
        gerçek üretim yapay zekâsı olarak değerlendirilmemelidir.
      </div>

      <div className="space-y-4 rounded-lg border-border bg-card p-5 sm:p-8">
        <div>
          <label className="text-xs font-medium text-muted" htmlFor="question">
            Soru metni
          </label>
          <textarea
            id="question"
            value={questionText}
            onChange={(e) => setQuestionText(e.target.value)}
            rows={3}
            placeholder="Örn: f(x) = 2x + 3 fonksiyonu için f(5) değeri kaçtır?"
            className="mt-1 w-full rounded-md border-border bg-bg px-3 py-2 text-sm text-ink outline-none focus:border-accent"
          />
        </div>

        <button
          onClick={runJourney}
          disabled={busy}
          className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-ink disabled:opacity-50"
        >
          {busy ? 'İşleniyor…' : 'Yolculuğu başlat'}
        </button>

        {statusLine && <p className="text-xs text-muted">{statusLine}</p>}
        {reviewRequired && (
          <p className="text-xs text-muted">
            Bu içerik için inceleme adımı uygulandı. Öğrenci yüklemeleri güvenilir banka
            kaynağına dönüştürülmez; soru doğrulanmamış olarak işaretlenir.
          </p>
        )}
        {error && (
          <p className="rounded-md border-border bg-bg px-3 py-2 text-xs text-ink">
            {error}
          </p>
        )}

        {questionId && (
          <div className="mt-6 space-y-3 border-t border-border pt-5">
            <label className="text-xs font-medium text-muted" htmlFor="answer">
              Cevabın
            </label>
            <input
              id="answer"
              value={studentAnswer}
              onChange={(e) => setStudentAnswer(e.target.value)}
              placeholder="Örn: 13"
              className="w-full rounded-md border-border bg-bg px-3 py-2 text-sm text-ink outline-none focus:border-accent"
            />
            <button
              onClick={sendAnswer}
              disabled={busy}
              className="rounded-md border-accent bg-accent/10 px-4 py-2 text-sm font-semibold text-ink disabled:opacity-50"
            >
              Cevabı gönder
            </button>
          </div>
        )}

        {phase === 'answered' && attempt && (
          <div className="mt-6 space-y-3 border-t border-border pt-5">
            <p className="text-sm font-semibold text-ink">
              {attempt.evaluationState === 'NOT_EVALUABLE'
                ? 'Sunucu sonucu: bu soru için kesin bir cevap anahtarı olmadığından doğruluk değerlendirilemedi.'
                : `Sunucu sonucu: ${attempt.isCorrect ? 'Doğru' : 'Yanlış'}`}
            </p>
            {attempt.evaluationState === 'NOT_EVALUABLE' && (
              <p className="text-xs text-muted">
                Bu durumda ustalık ve hata analizi oluşturulmaz; sistem tahmin yürütmez.
              </p>
            )}

            {mastery.length > 0 && (
              <div className="rounded-md bg-bg px-3 py-2 text-xs">
                <p className="font-medium text-ink">Ustalık (backend)</p>
                <ul className="mt-1 space-y-0.5 text-muted">
                  {mastery.slice(0, 3).map((s) => (
                    <li key={s.skillId}>
                      {s.skillId}: %{Math.round(s.masteryLevel)}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {errorAnalysis && (
              <div className="rounded-md bg-bg px-3 py-2 text-xs">
                <p className="font-medium text-ink">
                  Hata analizi {errorAnalysis.validated ? '(doğrulandı)' : '(inceleme bekliyor)'}
                </p>
                {errorAnalysis.errorType && (
                  <p className="text-muted">Tür: {errorAnalysis.errorType}</p>
                )}
                {errorAnalysis.hypothesis && (
                  <p className="text-muted">{errorAnalysis.hypothesis}</p>
                )}
              </div>
            )}

            {recommendation && (
              <div className="rounded-md bg-bg px-3 py-2 text-xs">
                <p className="font-medium text-ink">Sıradaki adım</p>
                <p className="text-muted">{recommendation.reason}</p>
              </div>
            )}

            {/*
              Phase 6.4 — safe guidance, offered only when the backend actually
              evaluated the attempt (NOT_EVALUABLE has no authoritative result to
              guide against) and the attempt is owned by this student.
            */}
            {attempt.evaluationState === 'EVALUATED' && (
              <GuidancePanel attemptId={attempt.attemptId} isCorrect={attempt.isCorrect} />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
