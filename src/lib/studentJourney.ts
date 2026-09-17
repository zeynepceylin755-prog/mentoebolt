import { apiRequest } from './apiClient';

/**
 * Thin, typed wrappers over the existing backend endpoints used by the real
 * student journey. No business logic is duplicated here: the backend remains
 * authoritative for correctness, mastery and error analysis.
 */

export type IngestionState =
  | 'INGESTED'
  | 'EXTRACTED'
  | 'EXTRACTION_FAILED'
  | 'NORMALIZED'
  | 'ANALYZED'
  | 'MAPPED'
  | 'REVIEW_REQUIRED'
  | 'APPROVED'
  | 'REJECTED';

export interface QuestionIngestion {
  id: string;
  state: IngestionState;
  ingestMethod: string;
  sourceId: string | null;
  normalizedText: string | null;
  ocrConfidence: number | null;
  requiresReview: boolean;
  reviewNotes: string | null;
  resultingQuestionId: string | null;
}

export interface CanonicalQuestionResult {
  question: { id: string; content: string; type: string };
  instance: { id: string } | null;
}

/**
 * Phase 6.3 — the safe, backend-owned result of submitting an answer.
 * Everything here comes from the server; nothing is computed in the browser.
 */
export interface AttemptResult {
  attemptId: string;
  /** EVALUATED = backend established correctness; NOT_EVALUABLE = no answer key. */
  evaluationState: 'EVALUATED' | 'NOT_EVALUABLE';
  isCorrect: boolean;
  correctAnswer: string | null;
  /** Present only when an ErrorAnalysis was persisted for an incorrect attempt. */
  errorAnalysis: {
    validated: boolean;
    errorPatternId: string | null;
  } | null;
}

export interface SkillProgress {
  skillId: string;
  masteryLevel: number;
  confidence: number;
  attempts: number;
  correctAttempts: number;
  accuracy: number;
}

/**
 * Phase 6.5 — the deterministic next-learning recommendation contract.
 *
 * The backend decides the action, MicroSkill and priority from authoritative
 * learning state; the client only renders it. `reasonCode` is machine-readable so
 * the UI never has to infer WHY a recommendation exists, and internal hierarchy
 * ids (microSkillId/processComponentId/learningOutcomeId/themeId/sessionId) are
 * present only because acting on the recommendation requires them.
 */
export type RecommendationActionType =
  | 'CONTINUE_SESSION'
  | 'REMEDIATE_ERROR'
  | 'REVIEW_SKILL'
  | 'PRACTICE_SKILL'
  | 'PROGRESS_CURRICULUM'
  | 'MAINTAIN_SKILL'
  | 'ONBOARDING';

export type RecommendationReasonCode =
  | 'ACTIVE_SESSION'
  | 'LOW_MASTERY'
  | 'REPEATED_ERROR'
  | 'RECENT_REGRESSION'
  | 'DEVELOPING_SKILL'
  | 'CURRICULUM_PROGRESS'
  | 'MAINTENANCE'
  | 'INSUFFICIENT_EVIDENCE';

export interface RecommendationEvidence {
  mastery?: number;
  evidenceCount?: number;
  recentIncorrectCount?: number;
  repeatedErrorPattern?: boolean;
  trend?: 'IMPROVING' | 'STABLE' | 'DECLINING';
}

export interface NextRecommendation {
  actionType: RecommendationActionType;
  reasonCode: RecommendationReasonCode;
  microSkillId?: string;
  processComponentId?: string;
  learningOutcomeId?: string;
  themeId?: string;
  sessionId?: string;
  reason: string;
  priority: number;
  evidence: RecommendationEvidence;
  estimatedTimeMinutes: number;
}

export interface ErrorAnalysisView {
  errorType: string | null;
  hypothesis: string | null;
  validated: boolean;
}

/**
 * Phase 6.4 — the safe guidance modes. There is deliberately no solution mode.
 * The backend restricts this set as well; the two must stay in sync.
 */
export const GUIDANCE_MODES = [
  'HINT',
  'SOCRATIC',
  'FORMULA_REMINDER',
  'MISTAKE_GUIDANCE',
  'NEXT_STEP',
] as const;

export type GuidanceMode = (typeof GUIDANCE_MODES)[number];

/**
 * Phase 6.4 — attempt-scoped guidance returned by the backend.
 *
 * The client sends ONLY `{ attemptId, mode }`: every piece of pedagogical context
 * (question, submitted answer, MicroSkill, ErrorAnalysis, correctness) is derived
 * server-side from the authenticated attempt. Nothing internal (model name,
 * provider, confidence, MicroSkill/ErrorPattern ids) is exposed to the student.
 */
export interface GuidanceResult {
  explanation: string;
  stepByStep: string[];
  examples: string[];
  keyPoints: string[];
  practiceSuggestion: string;
  mode: GuidanceMode;
  /**
   * True when the backend served a deterministic, answer-free fallback instead of
   * a provider response. The UI must word this honestly (never "AI generated").
   */
  isFallback: boolean;
}

export function createIngestion(
  input: { rawText: string; sourceId?: string }
): Promise<QuestionIngestion> {
  return apiRequest<QuestionIngestion>('/question-ingestions', {
    method: 'POST',
    idempotencyKey: `p5f7-ingest-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    body: {
      ingestMethod: 'TEXT_PASTE',
      rawText: input.rawText,
      ...(input.sourceId ? { sourceId: input.sourceId } : {}),
    },
  });
}

export function analyzeIngestion(
  ingestionId: string,
  normalizedText: string
): Promise<unknown> {
  return apiRequest(`/question-ingestions/${ingestionId}/analyze`, {
    method: 'POST',
    body: { skipOcr: true, normalizedText },
  });
}

export function getIngestion(ingestionId: string): Promise<QuestionIngestion> {
  return apiRequest<QuestionIngestion>(`/question-ingestions/${ingestionId}`);
}

export function transitionIngestion(
  ingestionId: string,
  toState: IngestionState
): Promise<QuestionIngestion> {
  return apiRequest<QuestionIngestion>(`/question-ingestions/${ingestionId}/transition`, {
    method: 'POST',
    body: { toState },
  });
}

export function createCanonicalQuestion(
  ingestionId: string
): Promise<CanonicalQuestionResult> {
  return apiRequest<CanonicalQuestionResult>(
    `/question-ingestions/${ingestionId}/create-canonical`,
    { method: 'POST' }
  );
}

export function submitAnswer(
  questionId: string,
  answer: string,
  timeSpentSeconds: number,
  instanceId?: string
): Promise<AttemptResult> {
  return apiRequest<AttemptResult>('/question-attempts', {
    method: 'POST',
    idempotencyKey: `p63-attempt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    body: {
      questionId,
      answer,
      timeSpentSeconds,
      sessionId: 'standalone',
      // The instance the student is actually answering. The backend verifies
      // ownership; this is not an authoritative identity field.
      ...(instanceId ? { instanceId } : {}),
    },
  });
}

export function getAttempt(attemptId: string): Promise<any> {
  return apiRequest(`/question-attempts/${attemptId}`);
}

interface RawGuidanceResult {
  explanation: string;
  stepByStep?: string[];
  examples?: string[];
  keyPoints?: string[];
  practiceSuggestion?: string;
  mode: GuidanceMode;
  metadata?: { source?: 'provider' | 'fallback' };
}

/**
 * Phase 6.4 — request attempt-scoped guidance.
 *
 * Only `attemptId` and `mode` cross the wire. No studentId, questionId, skillId,
 * microSkillId, errorType, correctAnswer or question text is ever sent as
 * authoritative context; the backend resolves all of it from the authenticated
 * attempt. Response metadata is deliberately narrowed to a single `isFallback`
 * boolean so provider/model/internal details never reach the UI.
 *
 * `authToken`, when supplied, is used for the request only and is never derived
 * from or persisted to client-authoritative state.
 */
export async function requestGuidance(
  attemptId: string,
  mode: GuidanceMode,
  authToken?: string
): Promise<GuidanceResult> {
  const raw = await apiRequest<RawGuidanceResult>('/ai/explanation', {
    method: 'POST',
    body: { attemptId, mode },
    ...(authToken ? { token: authToken } : {}),
  });

  return {
    explanation: raw.explanation ?? '',
    stepByStep: raw.stepByStep ?? [],
    examples: raw.examples ?? [],
    keyPoints: raw.keyPoints ?? [],
    practiceSuggestion: raw.practiceSuggestion ?? '',
    mode: raw.mode,
    isFallback: raw.metadata?.source === 'fallback',
  };
}

export function getMySkillProgress(): Promise<SkillProgress[]> {
  return apiRequest<SkillProgress[]>('/analytics/me/skills');
}

export function getNextRecommendation(): Promise<NextRecommendation> {
  return apiRequest<NextRecommendation>('/recommendations/next');
}
