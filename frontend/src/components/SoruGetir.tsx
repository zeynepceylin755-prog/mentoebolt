import { useState, useRef, useEffect } from 'react';
import { Camera, Upload, ArrowRight, CheckCircle2 } from 'lucide-react';
import {
  uploadAsset,
  createIngestion,
  analyzeIngestion,
  transitionIngestion,
  createCanonicalQuestion,
  submitAnswer,
  getAttempt,
  requestGuidance,
  GUIDANCE_MODES,
  type AttemptResult,
  type GuidanceResult,
  type GuidanceMode,
} from '@/lib/studentJourney';
import { ApiError } from '@/lib/apiClient';
import { invalidateLearningEvidence } from '@/lib/requestCache';
import {
  errorTypeLabel,
  guidanceModeLabel,
} from '@/lib/presentation';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import Input, { Textarea } from '@/components/ui/Input';
import Loading from '@/components/ui/Loading';
import ErrorState from '@/components/ui/ErrorState';
import PageContainer from '@/components/ui/PageContainer';
import PageHeader from '@/components/ui/PageHeader';
import type { StudentDestinationId } from '@/components/StudentShell';
import ImagePreview from '@/components/ImagePreview';

/**
 * The eight student-visible states of "Soru Getir".
 *
 * Every state has its own render path so the student is never left looking at a
 * spinner without knowing what is happening. The wording is deliberately human:
 * no OCR, no API, no provider, no queue.
 */
type Phase =
  | 'empty'
  | 'preview'
  | 'uploading'
  | 'processing'
  | 'answering'
  | 'analyzed'
  | 'error';

const PROGRESS_STEPS = [
  'Soruyu okuyorum...',
  'Çözümünü inceliyorum...',
  'Nerede takıldığını buluyorum...',
] as const;

const ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'application/pdf'] as const;
const MAX_SIZE_MB = 7;

interface SoruGetirProps {
  onNavigate?: (view: StudentDestinationId) => void;
}

export default function SoruGetir({ onNavigate }: SoruGetirProps) {
  const [phase, setPhase] = useState<Phase>('empty');
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [questionText, setQuestionText] = useState('');
  const [answer, setAnswer] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [progressIndex, setProgressIndex] = useState(0);
  const [questionId, setQuestionId] = useState<string | null>(null);
  const [displayQuestion, setDisplayQuestion] = useState('');
  const [attempt, setAttempt] = useState<AttemptResult | null>(null);
  const [guidance, setGuidance] = useState<GuidanceResult | null>(null);
  const [guidanceLoading, setGuidanceLoading] = useState<GuidanceMode | null>(null);
  /** The action that failed, so "Tekrar dene" replays exactly that action. */
  const [retryAction, setRetryAction] = useState<'analyze' | 'answer' | null>(null);

  const galleryInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Object URLs must be revoked or a long session leaks memory.
  useEffect(() => {
    return () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  function clearPreview() {
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }
    setPreviewUrl(null);
  }

  function handleFile(selected: File) {
    // A rejected file leaves the student exactly where they were — the picker is
    // still available — with an explicit reason, so the selection can be fixed
    // without losing the surrounding form state.
    clearPreview();
    setFile(null);
    setPhase('empty');

    if (!ACCEPTED_TYPES.includes(selected.type as (typeof ACCEPTED_TYPES)[number])) {
      setError('Bu dosya türünü okuyamıyorum. PNG, JPEG, WEBP veya PDF yükleyebilirsin.');
      return;
    }
    if (selected.size > MAX_SIZE_MB * 1024 * 1024) {
      setError(`Dosya çok büyük. En fazla ${MAX_SIZE_MB} MB yükleyebilirsin.`);
      return;
    }

    setError(null);
    setFile(selected);

    if (selected.type.startsWith('image/')) {
      setPreviewUrl(URL.createObjectURL(selected));
    }
    setPhase('preview');
  }

  function handleRemoveFile() {
    clearPreview();
    setFile(null);
    setPhase('empty');
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (galleryInputRef.current) galleryInputRef.current.value = '';
    if (cameraInputRef.current) cameraInputRef.current.value = '';
  }

  function reset() {
    clearPreview();
    setPhase('empty');
    setFile(null);
    setQuestionText('');
    setAnswer('');
    setError(null);
    setProgressIndex(0);
    setQuestionId(null);
    setDisplayQuestion('');
    setAttempt(null);
    setGuidance(null);
    setGuidanceLoading(null);
    setRetryAction(null);
  }

  /** Human, non-technical error text — never a raw backend or provider message. */
  function describeFailure(err: unknown): string {
    if (err instanceof ApiError) {
      if (err.status === 0) {
        return 'Bağlantı kurulamadı. İnternet bağlantını kontrol edip tekrar deneyebilirsin.';
      }
      if (err.status === 401 || err.status === 403) {
        return 'Oturumun sona ermiş görünüyor. Tekrar giriş yapman gerekiyor.';
      }
      if (err.status === 429) {
        return 'Şu anda çok fazla istek var. Kısa bir mola verip tekrar deneyebilirsin.';
      }
      if (err.status === 413) {
        return 'Dosya yüklemek için çok büyük. Daha küçük bir fotoğrafla tekrar dene.';
      }
      // 503 (AI_PROVIDER_UNAVAILABLE): the analysis service is temporarily busy
      // (provider rate limit or a short outage). This is recoverable, so say so
      // instead of implying the question can never be analysed.
      if (err.status === 503 || err.code === 'AI_PROVIDER_UNAVAILABLE') {
        return 'Analiz servisi şu anda yoğun. Kısa bir süre sonra tekrar deneyebilirsin.';
      }
      if (err.status >= 500) {
        return 'Soruyu şu anda analiz edemedik. Bir sorun oluştu, tekrar deneyebilirsin.';
      }
    }
    return 'Soruyu şu anda analiz edemedik. Bir sorun oluştu, tekrar deneyebilirsin.';
  }

  async function runAnalysis() {
    if (!file && questionText.trim().length === 0) {
      setError('Önce çözdüğün sorun fotoğrafını yükle ya da soruyu yaz.');
      return;
    }

    setPhase('uploading');
    setProgressIndex(0);
    setError(null);
    setRetryAction('analyze');

    try {
      let ingestionId: string | null = null;
      let analysisText: string;
      let ingestMethod: string;

      if (file) {
        const uploaded = await uploadAsset(file);
        ingestionId = uploaded.ingestion.id;
        ingestMethod = 'IMAGE_UPLOAD';
        // The photo is the question. Any text the student also typed is optional
        // additional context, never a substitute for the image.
        analysisText = questionText.trim();
      } else {
        const ingestion = await createIngestion({ rawText: questionText.trim() });
        ingestionId = ingestion.id;
        ingestMethod = 'TEXT_PASTE';
        analysisText = questionText.trim();
      }

      if (!ingestionId) {
        throw new Error('ingestion-missing');
      }

      setPhase('processing');
      setProgressIndex(1);

      // The backend reads the question from the uploaded image for IMAGE_UPLOAD,
      // so an absent text field is a legitimate state rather than an early stop.
      await analyzeIngestion(ingestionId, {
        normalizedText: analysisText,
        ingestMethod,
      });

      setProgressIndex(2);
      // The student journey produces a canonical Question from the REVIEW_REQUIRED
      // state (the documented student path: the produced Question stays
      // UNVERIFIED and isActive=false, and a human reviewer acts on it later).
      // MAPPED/ANALYZED are NOT reviewed states, so the backend intentionally
      // refuses canonical creation from them. Moving to REVIEW_REQUIRED first is
      // idempotent when the analysis already ended there — a no-op transition
      // fails and is swallowed, leaving the state unchanged.
      await transitionIngestion(ingestionId, 'REVIEW_REQUIRED').catch(() => undefined);

      const canonical = await createCanonicalQuestion(ingestionId);
      setQuestionId(canonical.question.id);
      setDisplayQuestion(
        canonical.question.content || analysisText || 'Fotoğraftaki soru'
      );

      if (!canonical.instance) {
        setError(
          'Bu soru için sana ait bir kayıt oluşturamadık. Soruyu tekrar getirmeyi deneyebilirsin.'
        );
        setPhase('error');
        return;
      }

      setPhase('answering');
      setRetryAction(null);
    } catch (err) {
      setError(describeFailure(err));
      setPhase('error');
    }
  }

  async function sendAnswer() {
    if (!questionId || answer.trim().length === 0) {
      setError('Cevabını yazmadan devam edemiyorum.');
      return;
    }

    setPhase('processing');
    setProgressIndex(1);
    setError(null);
    setRetryAction('answer');

    try {
      const result = await submitAnswer(questionId, answer.trim(), 30);

      // The attempt read is an enrichment, not a precondition: a failure here must
      // never discard an evaluation the backend already committed.
      const detail = await getAttempt(result.attemptId).catch(() => null);
      setAttempt(detail ? { ...result, ...detail } : result);

      // The attempt just changed the student's mastery, error profile and next
      // recommendation, so every evidence-derived screen must refetch rather than
      // serve the pre-attempt snapshot.
      invalidateLearningEvidence();

      setPhase('analyzed');
      setRetryAction(null);
    } catch (err) {
      setError(describeFailure(err));
      setPhase('error');
    }
  }

  async function askForGuidance(mode: GuidanceMode) {
    if (!attempt) return;
    setGuidanceLoading(mode);
    setError(null);
    try {
      const result = await requestGuidance(attempt.attemptId, mode);
      setGuidance(result);
    } catch (err) {
      setError(describeFailure(err));
    } finally {
      setGuidanceLoading(null);
    }
  }

  function handleRetry() {
    if (retryAction === 'answer') {
      void sendAnswer();
      return;
    }
    void runAnalysis();
  }

  // ------------------------------------------------------------------ rendering

  if (phase === 'uploading' || phase === 'processing') {
    return (
      <PageContainer size="narrow">
        <Loading
          state={phase === 'uploading' ? 'uploading' : 'analyzing'}
          message={PROGRESS_STEPS[progressIndex]}
          steps={[...PROGRESS_STEPS]}
          activeStep={progressIndex}
        />
      </PageContainer>
    );
  }

  if (phase === 'error') {
    return (
      <PageContainer size="narrow">
        <ErrorState
          title="Soruyu şu anda analiz edemedik"
          message={error ?? 'Bir sorun oluştu.'}
          onRetry={handleRetry}
        />
        <div className="mt-6 text-center">
          <Button variant="ghost" onClick={reset}>
            Vazgeç
          </Button>
        </div>
      </PageContainer>
    );
  }

  if (phase === 'analyzed' && attempt) {
    return (
      <PageContainer size="narrow">
        <PageHeader
          eyebrow="Soru Getir"
          title={
            attempt.evaluationState === 'NOT_EVALUABLE'
              ? 'Bu cevabı değerlendiremedik'
              : attempt.isCorrect
                ? 'Bu soruyu doğru çözdün'
                : 'Nerede takıldığını bulduk'
          }
        />

        <div className="space-y-5">
          <Card variant="bordered" className="p-6">
            <Section title="Soruda ne oldu?">
              <p className="text-body leading-relaxed text-ink">
                {attempt.question?.content || displayQuestion}
              </p>
            </Section>

            <Section title="Nerede takıldın?">
              {attempt.evaluationState === 'NOT_EVALUABLE' ? (
                <p className="text-body leading-relaxed text-muted">
                  Bu cevabı güvenle değerlendiremedik, bu yüzden sana kesin bir şey
                  söylemek istemiyoruz. Cevabı bir kez daha yazıp deneyebilirsin.
                </p>
              ) : attempt.isCorrect ? (
                <p className="text-body leading-relaxed text-muted">
                  Bir ayrımı doğru yakalamışsın. Bu adımı sağlam attığın anlamına
                  geliyor; sıradaki adıma geçebiliriz.
                </p>
              ) : (
                <p className="text-body leading-relaxed text-muted">
                  {attempt.errorAnalysis?.hypothesis ??
                    'Burada küçük bir ayrım kaçmış. Çözümü birlikte netleştirelim.'}
                </p>
              )}
            </Section>

            {attempt.evaluationState !== 'NOT_EVALUABLE' &&
              attempt.errorAnalysis?.errorType && (
                <Section title="Bu neyle ilgili?">
                  <p className="text-body leading-relaxed text-ink">
                    {errorTypeLabel(attempt.errorAnalysis.errorType)}
                  </p>
                  {attempt.skillName && (
                    <p className="mt-1 text-body-sm text-muted">{attempt.skillName}</p>
                  )}
                  {attempt.errorAnalysis.validated === false && (
                    <p className="mt-2 text-body-sm text-muted">
                      Bu değerlendirme henüz kesinleşmedi.
                    </p>
                  )}
                </Section>
              )}
          </Card>

          <Card variant="bordered" className="p-6">
            <h2 className="font-sora text-card-title font-semibold text-ink">
              Şimdi ne yapmalısın?
            </h2>
            <p className="mt-2 text-body-sm leading-relaxed text-muted">
              Sana cevabı vermeyen, nasıl ilerleyeceğini hatırlatan kısa bir
              yönlendirme isteyebilirsin.
            </p>

            <div className="mt-5 flex-wrap gap-2">
              {GUIDANCE_MODES.map((mode) => (
                <Button
                  key={mode}
                  variant="secondary"
                  size="sm"
                  onClick={() => void askForGuidance(mode)}
                  loading={guidanceLoading === mode}
                  disabled={guidanceLoading !== null && guidanceLoading !== mode}
                >
                  {guidanceModeLabel(mode)}
                </Button>
              ))}
            </div>

            {guidance && (
              <div className="mt-6 border-t border-border pt-5" role="status">
                <p className="text-body leading-relaxed text-ink">
                  {guidance.explanation}
                </p>
                {guidance.stepByStep.length > 0 && (
                  <ol className="mt-4 space-y-2">
                    {guidance.stepByStep.map((step, index) => (
                      <li key={index} className="flex gap-3 text-body-sm leading-relaxed text-muted">
                        <span className="flex-shrink-0 font-sora text-ink">{index + 1}.</span>
                        <span>{step}</span>
                      </li>
                    ))}
                  </ol>
                )}
                {guidance.keyPoints.length > 0 && (
                  <ul className="mt-4 space-y-1.5">
                    {guidance.keyPoints.map((point, index) => (
                      <li key={index} className="text-body-sm leading-relaxed text-muted">
                        • {point}
                      </li>
                    ))}
                  </ul>
                )}
                {guidance.practiceSuggestion && (
                  <p className="mt-4 text-body-sm leading-relaxed text-ink">
                    {guidance.practiceSuggestion}
                  </p>
                )}
                {guidance.metadata.source === 'fallback' && (
                  <p className="mt-4 text-body-sm text-muted">
                    Şu anda kısa bir hatırlatma gösteriyoruz.
                  </p>
                )}
              </div>
            )}
          </Card>

          <div className="flex flex-col gap-3 sm:flex-row">
            <Button onClick={reset} size="lg" fullWidth>
              Yeni Soru Getir
            </Button>
            {onNavigate && (
              <Button
                variant="secondary"
                size="lg"
                fullWidth
                onClick={() => onNavigate('tekrarlarim')}
              >
                Tekrarlarıma bak
              </Button>
            )}
          </div>
        </div>
      </PageContainer>
    );
  }

  if (phase === 'answering') {
    return (
      <PageContainer size="narrow">
        <PageHeader
          eyebrow="Soru Getir"
          title="Şimdi cevabını yaz"
          lead="Sadece sonucu değil, senin çözümünü görmek istiyoruz."
        />
        <Card variant="bordered" className="p-6">
          <p className="text-label font-medium uppercase tracking-wide text-muted">Soru</p>
          <p className="mt-3 text-body leading-relaxed text-ink">{displayQuestion}</p>

          <div className="mt-6">
            <Input
              label="Cevabın"
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              placeholder="Örn: 13"
              error={error ?? undefined}
              autoComplete="off"
              inputMode="text"
            />
          </div>

          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <Button
              onClick={() => void sendAnswer()}
              size="lg"
              fullWidth
              disabled={answer.trim().length === 0}
            >
              Cevabı gönder
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Button>
            <Button variant="secondary" size="lg" fullWidth onClick={reset}>
              Vazgeç
            </Button>
          </div>
        </Card>
      </PageContainer>
    );
  }

  // ------------------------------------------------------- empty / preview
  return (
    <PageContainer size="narrow">
      <PageHeader
        eyebrow="SORU GETİR"
        title="Bir soru getir"
        lead="Kitabından, ödevinden veya testinden. Fotoğraf yükle ya da soruyu metin olarak yaz; ikisi de aynı analiz akışına bağlanır."
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-2xl border border-border bg-card p-5 sm:p-7">
          <p className="editorial-kicker">YÖNTEM 01</p>
          <h2 className="mt-3 font-display text-2xl text-ink">Soruyu metin olarak yaz</h2>
          <p className="mt-2 text-sm leading-relaxed text-muted">Kendi çözüm adımlarını da eklersen nerede takıldığını daha iyi inceleyebiliriz.</p>
          <div className="mt-6">
            <Textarea
              label="Soruyu yazmak istersen"
              value={questionText}
              onChange={(e) => setQuestionText(e.target.value)}
              placeholder="Soruyu ve mümkünse kendi çözüm adımlarını buraya yazabilirsin."
              rows={7}
              helperText="Metin, şu an soruyu incelemek için en güvenilir yol."
            />
          </div>
        </section>

        {phase === 'preview' && file && previewUrl ? (
          <ImagePreview
            src={previewUrl}
            fileName={file.name}
            onRemove={handleRemoveFile}
            onReplace={() => galleryInputRef.current?.click()}
          />
        ) : (
          <section className="rounded-2xl border border-border bg-card p-5 sm:p-7" aria-labelledby="optional-upload-title">
            <div className="flex items-start gap-3">
              <Upload className="mt-0.5 h-4 w-4 flex-shrink-0 text-accent" aria-hidden="true" />
              <div>
                <p className="editorial-kicker">YÖNTEM 02</p>
                <h2 id="optional-upload-title" className="mt-3 font-display text-2xl text-ink">
                  Fotoğraf veya PDF yükle
                </h2>
                <p className="mt-2 text-sm leading-relaxed text-muted">
                  Kitabından, ödevinden veya testinden bir soru getir. Fotoğrafı eklediğinde soruyu metin olarak da yazman gerekebilir.
                </p>
              </div>
            </div>

            <div className="mt-4 flex flex-col gap-3 sm:flex-row">
              <button
                type="button"
                onClick={() => cameraInputRef.current?.click()}
                className="inline-flex min-h-[48px] flex-1 items-center justify-center gap-2 rounded-lg border border-border bg-card px-4 py-3 text-body-sm font-medium text-ink transition-colors hover:border-accent hover:bg-accent/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
              >
                <Camera className="h-4 w-4 text-accent" aria-hidden="true" />
                Kamerayla çek
              </button>
              <button
                type="button"
                onClick={() => galleryInputRef.current?.click()}
                className="inline-flex min-h-[48px] flex-1 items-center justify-center gap-2 rounded-lg border border-border bg-card px-4 py-3 text-body-sm font-medium text-ink transition-colors hover:border-accent hover:bg-accent/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
              >
                <Upload className="h-4 w-4 text-muted" aria-hidden="true" />
                Fotoğraf yükle
              </button>
            </div>
            <p className="mt-4 text-xs uppercase tracking-[0.08em] text-muted">
              PNG, JPEG, WEBP veya PDF · en fazla {MAX_SIZE_MB} MB
            </p>
          </section>
        )}
      </div>

      {/* Hidden inputs: one with capture for the camera, one without. */}
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        aria-hidden="true"
        tabIndex={-1}
        onChange={(e) => {
          const selected = e.target.files?.[0];
          if (selected) handleFile(selected);
        }}
      />
      <input
        ref={galleryInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,application/pdf"
        className="sr-only"
        aria-hidden="true"
        tabIndex={-1}
        onChange={(e) => {
          const selected = e.target.files?.[0];
          if (selected) handleFile(selected);
        }}
      />
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,application/pdf"
        className="sr-only"
        aria-hidden="true"
        tabIndex={-1}
        onChange={(e) => {
          const selected = e.target.files?.[0];
          if (selected) handleFile(selected);
        }}
      />

      {error && (
        <p
          className="mt-4 rounded-lg border-accent/30 bg-accent/5 px-4 py-3 text-body-sm leading-relaxed text-ink"
          role="alert"
        >
          {error}
        </p>
      )}

      <div className="mt-7">
        <Button
          onClick={() => void runAnalysis()}
          size="lg"
          fullWidth
          disabled={!file && questionText.trim().length === 0}
        >
          Soruyu incele
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
    </PageContainer>
  );
}

/** A titled block inside the analysis card. */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-b border-border py-5 first:pt-0 last:border-b-0 last:pb-0">
      <h2 className="text-label font-medium uppercase tracking-wide text-muted">{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}
