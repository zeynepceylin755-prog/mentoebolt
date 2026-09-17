import { useState } from 'react';
import {
  requestGuidance,
  GUIDANCE_MODES,
  type GuidanceMode,
  type GuidanceResult,
} from '@/lib/studentJourney';
import { ApiError } from '@/lib/apiClient';

/**
 * Phase 6.4 — Safe guidance panel for the real student journey.
 *
 * After the backend has authoritatively evaluated an attempt, the student chooses
 * ONE pedagogical mode. The client sends only `{ attemptId, mode }`; the backend
 * derives the whole context from the authenticated attempt and returns
 * answer-suppressed guidance. Nothing internal (provider, model, confidence,
 * MicroSkill/ErrorPattern ids) is ever surfaced here, and no wording implies the
 * guidance was produced by a generative model.
 */

interface ModeOption {
  mode: GuidanceMode;
  label: string;
  hint: string;
}

const MODE_OPTIONS: ModeOption[] = [
  { mode: 'HINT', label: 'İpucu', hint: 'Küçük bir yönlendirme' },
  { mode: 'SOCRATIC', label: 'Birlikte düşün', hint: 'Sana yol gösterecek bir soru' },
  { mode: 'FORMULA_REMINDER', label: 'Formülü hatırla', hint: 'İlgili kuralı hatırla' },
  { mode: 'MISTAKE_GUIDANCE', label: 'Hatanı anla', hint: 'Nerede takıldığını gözden geçir' },
  { mode: 'NEXT_STEP', label: 'Sonraki adım', hint: 'Sırada ne yapacağını düşün' },
];

// Guardian against drift: the UI modes must be exactly the backend-safe modes.
if (MODE_OPTIONS.length !== GUIDANCE_MODES.length) {
  throw new Error('Guidance mode list is out of sync with the backend contract');
}

interface Props {
  attemptId: string;
  /** Authoritative correctness from the backend; drives the heading and mode set. */
  isCorrect: boolean;
  /** Optional token override for isolated/test harnesses. Normal usage omits it. */
  authToken?: string;
}

export default function GuidancePanel({ attemptId, isCorrect, authToken }: Props) {
  const [activeMode, setActiveMode] = useState<GuidanceMode | null>(null);
  const [guidance, setGuidance] = useState<GuidanceResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A correct attempt must not be offered "hatasını anla": there is no error to
  // understand, and the backend would refuse to invent one.
  const modes = MODE_OPTIONS.filter(
    (m) => m.mode !== 'MISTAKE_GUIDANCE' || !isCorrect
  );

  async function load(mode: GuidanceMode) {
    setActiveMode(mode);
    setLoading(true);
    setError(null);
    try {
      const result = await requestGuidance(attemptId, mode, authToken);
      setGuidance(result);
    } catch (err) {
      setGuidance(null);
      if (err instanceof ApiError) {
        if (err.status === 401) {
          setError('Oturum doğrulanamadı. Lütfen tekrar giriş yap.');
        } else if (err.status === 403 || err.status === 404) {
          setError('Bu çözüm için yönlendirme alınamadı.');
        } else {
          setError('Şu anda yönlendirme oluşturulamadı. Tekrar deneyebilirsin.');
        }
      } else {
        setError('Şu anda yönlendirme oluşturulamadı. Tekrar deneyebilirsin.');
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-md bg-bg px-3 py-3 text-xs">
      <p className="text-sm font-medium text-ink">
        {isCorrect ? 'Doğru yaptın. Bir adım ileri gidelim.' : 'Nerede takıldığını bulalım.'}
      </p>
      <p className="mt-1 text-muted">
        {isCorrect
          ? 'İstersen konuyu biraz daha derinleştirelim. Cevabı vermeyiz, birlikte düşünelim.'
          : 'Sana cevabı söylemeyiz; doğru adımı kendin bulman için yol gösteririz.'}
      </p>

      <div className="mt-3 flex-wrap gap-2">
        {modes.map((option) => (
          <button
            key={option.mode}
            onClick={() => load(option.mode)}
            disabled={loading}
            title={option.hint}
            className={`rounded-md border px-3 py-1.5 text-xs font-medium disabled:opacity-50 ${
              activeMode === option.mode
                ? 'border-accent bg-accent/20 text-ink'
                : 'border-border bg-card text-ink'
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>

      {loading && <p className="mt-3 text-muted">Yönlendirme hazırlanıyor…</p>}

      {error && <p className="mt-3 text-ink">{error}</p>}

      {guidance && !loading && (
        <div className="mt-3 space-y-2 border-t border-border pt-3">
          <p className="text-ink">{guidance.explanation}</p>

          {guidance.stepByStep.length > 0 && (
            <ul className="list-disc space-y-0.5 pl-4 text-muted">
              {guidance.stepByStep.map((step, i) => (
                <li key={i}>{step}</li>
              ))}
            </ul>
          )}

          {guidance.keyPoints.length > 0 && (
            <div>
              <p className="font-medium text-ink">Aklında tut</p>
              <ul className="list-disc space-y-0.5 pl-4 text-muted">
                {guidance.keyPoints.map((point, i) => (
                  <li key={i}>{point}</li>
                ))}
              </ul>
            </div>
          )}

          {guidance.practiceSuggestion && (
            <p className="text-muted">{guidance.practiceSuggestion}</p>
          )}

          {guidance.isFallback && (
            <p className="text-muted">
              Şu an için genel bir yönlendirme gösteriyoruz. Soruyu bir kez daha
              inceleyip tekrar denemek en iyisi.
            </p>
          )}

          <p className="text-muted">Şimdi bu yönlendirmeyle soruyu bir kez daha dene.</p>
        </div>
      )}
    </div>
  );
}
