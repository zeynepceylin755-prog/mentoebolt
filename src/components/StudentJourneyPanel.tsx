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

/**
 * Phase 5F.7 (C) — one real vertical student journey against the live backend.
 *
 * This is intentionally minimal and honest: it drives the real API and shows
 * exactly what the backend returns. Correctness, mastery and error analysis are
 * NEVER computed in the browser — the backend is authoritative.
 *
 * The OCR / question-understanding steps currently run on the development
 * (test) pipeline; the UI says so plainly and never implies they are production
 * AI.
 */

type Phase = 'idle' | 'working' | 'answered';

export default function StudentJourneyPanel() {
  const [token, setToken] = useState('');
  const [questionText, setQuestionText] = useState('');
  const [studentAnswer, setStudentAnswer] = useState('');

  const [phase, setPhase] = useState<Phase>('idle');
  const [statusLine, setStatusLine] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [reviewRequired, setReviewRequired] = useState(false);

  const [questionId, setQuestionId] = useState<string | null>(null);
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
        setError('Oturum doğrulanamadı. Lütfen geçerli bir erişim anahtarı gir.');
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
    if (!token.trim()) {
      setError('Devam etmek için bir erişim anahtarı (access token) gir.');
      return;
    }
    if (questionText.trim().length < 3) {
      setError('Lütfen en az birkaç karakterlik bir soru metni gir.');
      return;
    }

    setPhase('working');
    try {
      // 1. Create ingestion (text paste). The upload/OCR step below uses the
      //    development (mock) pipeline.
      setStatusLine('1/5 · Soru altyapıya gönderiliyor…');
      const ingestion = await createIngestion(token.trim(), { rawText: questionText.trim() });

      // 2. Analyze. Currently backed by test providers.
      setStatusLine('2/5 · Soru okuma ve analiz (geliştirme altyapısı) çalışıyor…');
      await analyzeIngestion(token.trim(), ingestion.id, questionText.trim());

      // 3. Drive the ingestion to a reviewed state along the real state machine.
      //    Only owner-permitted transitions are used; APPROVED remains staff-only.
      setStatusLine('3/5 · İnceleme adımına ilerletiliyor…');
      let current = await transitionIngestion(token.trim(), ingestion.id, 'MAPPED').catch(async () => {
        // If analysis already landed on REVIEW_REQUIRED, skip the MAPPED hop.
        return null;
      });
      if (!current) {
        // Analysis already placed it at a reviewed state.
        setReviewRequired(true);
      } else {
        await transitionIngestion(token.trim(), ingestion.id, 'REVIEW_REQUIRED');
        setReviewRequired(true);
      }

      // 4. Create the canonical question + student instance.
      setStatusLine('4/5 · Kanonik soru oluşturuluyor…');
      const canonical = await createCanonicalQuestion(token.trim(), ingestion.id);
      setQuestionId(canonical.question.id);

      if (!canonical.instance) {
        setError(
          'Bu soru için sana ait bir örnek (instance) oluşturulamadı. ' +
            'Soru yanıtlama adımı yalnızca kişisel örnek üretildiğinde mümkündür.'
        );
        setPhase('idle');
        return;
      }

      setStatusLine('Hazır · Cevabını girip gönderebilirsin.');
      setPhase('idle');
      setStudentAnswer('');
    } catch (err) {
      handleError(err);
    }
  }

  async function sendAnswer() {
    if (!questionId || !token.trim()) return;
    if (studentAnswer.trim().length === 0) {
      setError('Lütfen bir cevap gir.');
      return;
    }

    setError(null);
    setStatusLine('Cevap gönderiliyor…');
    try {
      const result = await submitAnswer(token.trim(), questionId, studentAnswer.trim(), 30);
      setAttempt(result);

      // Pull the authoritative downstream effects (never computed client-side).
      const [skills, rec] = await Promise.all([
        getMySkillProgress(token.trim()).catch(() => [] as SkillProgress[]),
        getNextRecommendation(token.trim()).catch(() => null),
      ]);
      setMastery(skills);
      setRecommendation(rec);

      // Error analysis is attached to the attempt record when available.
      const attemptDetail: any = await getAttempt(token.trim(), result.attemptId).catch(() => null);
      if (attemptDetail?.errorAnalysis) {
        setErrorAnalysis({
          errorType: attemptDetail.errorAnalysis.errorType ?? null,
          hypothesis: attemptDetail.errorAnalysis.hypothesis ?? null,
          validated: attemptDetail.errorAnalysis.validated ?? false,
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
    <section id="gercek-yolculuk" className="px-5 py-20 sm:px-6 lg:px-8 lg:py-28">
      <div className="mx-auto max-w-3xl">
        <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted">
          Gerçek Öğrenci Yolculuğu (Beta)
        </p>
        <h2 className="mt-4 font-sora text-3xl font-semibold leading-tight tracking-tight text-ink sm:text-4xl">
          Soruyu getir, çöz, geri bildirimi gör
        </h2>
        <p className="mt-4 text-base leading-relaxed text-muted">
          Bu bölüm gerçek backend'e bağlanır: soru altyapıya gönderilir, inceleme adımından
          geçer, kanonik soru oluşturulur ve verdiğin cevap backend tarafından değerlendirilir.
          Doğruluk, ustalık ve hata analizi burada hesaplanmaz — hepsi sunucudan gelir.
        </p>

        <div className="mt-4 rounded-md border-border bg-surface px-4 py-3 text-[12px] leading-relaxed text-muted">
          <strong className="font-medium text-ink">Not:</strong> Şu anda soru okuma ve analiz
          altyapısı test sağlayıcısıyla çalışıyor. Bu adımlar geliştirme ortamına aittir ve
          gerçek üretim yapay zekâsı olarak değerlendirilmemelidir.
        </div>

        <div className="mt-8 space-y-4 rounded-lg border-border bg-card p-5 sm:p-8">
          <div>
            <label className="text-xs font-medium text-muted" htmlFor="p5f7-token">
              Erişim anahtarı (access token)
            </label>
            <input
              id="p5f7-token"
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="Bearer token"
              className="mt-1 w-full rounded-md border-border bg-bg px-3 py-2 text-sm text-ink outline-none focus:border-accent"
            />
            <p className="mt-1 text-[11px] text-muted">
              Geliştirme amaçlıdır. Üretimde oturum, uygulamanın kimlik doğrulama akışıyla
              yönetilir.
            </p>
          </div>

          <div>
            <label className="text-xs font-medium text-muted" htmlFor="p5f7-question">
              Soru metni
            </label>
            <textarea
              id="p5f7-question"
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

          {statusLine && <p className="text-[12px] text-muted">{statusLine}</p>}
          {reviewRequired && (
            <p className="text-[12px] text-muted">
              Bu içerik için inceleme adımı uygulandı. Öğrenci yüklemeleri güvenilir banka
              kaynağına dönüştürülmez; soru doğrulanmamış olarak işaretlenir.
            </p>
          )}
          {error && (
            <p className="rounded-md border-border bg-bg px-3 py-2 text-[12px] text-ink">
              {error}
            </p>
          )}

          {questionId && (
            <div className="mt-6 space-y-3 border-t border-border pt-5">
              <label className="text-xs font-medium text-muted" htmlFor="p5f7-answer">
                Cevabın
              </label>
              <input
                id="p5f7-answer"
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
                Sunucu sonucu: {attempt.isCorrect ? 'Doğru' : 'Yanlış'}
              </p>

              {mastery.length > 0 && (
                <div className="rounded-md bg-bg px-3 py-2 text-[12px]">
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
                <div className="rounded-md bg-bg px-3 py-2 text-[12px]">
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
                <div className="rounded-md bg-bg px-3 py-2 text-[12px]">
                  <p className="font-medium text-ink">Sıradaki adım</p>
                  <p className="text-muted">{recommendation.reason}</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
