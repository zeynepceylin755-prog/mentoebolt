import { apiRequest, ApiError } from './apiClient';

/**
 * Thin, typed wrappers over the existing backend endpoints used by the real
 * student journey. No business logic is duplicated here: the backend remains
 * authoritative for correctness, mastery and error analysis.
 */

/**
 * Generate a stable idempotency key for a logical submission.
 *
 * Phase 7.4: Keys are now content-based rather than time/random-based, preventing
 * accidental double submissions while allowing legitimate new answers. For question
 * attempts, the key is based on questionId + answer hash. For ingestions, it's based
 * on text content hash. This ensures the same logical submission intent always produces
 * the same key.
 */
function generateStableIdempotencyKey(type: 'attempt' | 'ingestion', content: string): string {
  // Simple hash function for content-based key generation
  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    const char = content.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  const hashStr = Math.abs(hash).toString(16);
  return `p5f7-${type}-${hashStr}`;
}

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

export interface UploadedAssetResult {
  ingestion: QuestionIngestion;
  asset: { mimeType: string; sizeBytes: number; contentHash: string };
}

export interface ReviewQueueItem {
  ingestionId: string;
  state: IngestionState;
  requiresReview: boolean;
  ingestMethod: string;
  normalizedText: string | null;
  ocrConfidence: number | null;
  parsingConfidence: number | null;
  extractionFailed: boolean;
  sourceId: string | null;
  origin: string | null;
  trustCeiling: string | null;
  resultingQuestionId: string | null;
  question: {
    id: string;
    content: string;
    origin: string | null;
    trust: string;
    isActive: boolean;
  } | null;
  curriculumCandidates: Array<{
    id: string;
    level: string;
    targetId: string;
    decision: string;
    confidence: number;
    reviewed: boolean;
  }>;
  microSkillMappings: Array<{
    id: string;
    microSkillId: string;
    isPrimary: boolean;
    relevance: number;
    reviewed: boolean;
    mappingSource: string;
  }>;
  createdAt: string;
}

export interface CanonicalQuestionResult {
  question: { id: string; content: string; type: string };
  instance: { id: string } | null;
}

export interface AttemptResult {
  attemptId: string;
  evaluationState: 'EVALUATED' | 'NOT_EVALUABLE';
  isCorrect: boolean;
  correctAnswer: string | null;
  errorType: string | null;
  question?: {
    id: string;
    content: string;
  };
  /**
   * Phase 7.4: the display name of the question's authoritative PRIMARY
   * MicroSkill, resolved server-side. `null` means the curriculum mapping for
   * this question is not established yet — the UI must say so instead of
   * inventing a topic name.
   */
  skillName?: string | null;
  /**
   * The student's own submitted answer. Returned by the list endpoint only; it is
   * evidence the student produced, never an answer key.
   */
  answer?: string | null;
  errorAnalysis?: {
    errorType: string | null;
    hypothesis: string | null;
    validated: boolean;
  } | null;
  createdAt: string;
}

/**
 * Phase 5F.9-E — non-authoritative pedagogical guidance modes.
 *
 * There is deliberately no FULL_SOLUTION mode: the backend contract rejects it.
 */
export const GUIDANCE_MODES = [
  'HINT',
  'SOCRATIC',
  'FORMULA_REMINDER',
  'MISTAKE_GUIDANCE',
  'NEXT_STEP',
] as const;

export type GuidanceMode = (typeof GUIDANCE_MODES)[number];

/** Safe, answer-suppressing guidance as returned by the backend. */
export interface GuidanceResult {
  explanation: string;
  stepByStep: string[];
  examples: string[];
  keyPoints: string[];
  practiceSuggestion: string;
  mode: GuidanceMode;
  metadata: {
    model: string;
    version: string;
    timestamp: string;
    tokensUsed: number;
    latencyMs: number;
    /** `fallback` means the deterministic safe hint was served, not the model. */
    source: 'provider' | 'fallback';
    safety: 'clear' | 'regenerated' | 'fallback';
  };
}

export interface SkillProgress {
  skillId: string;
  /**
   * Human-readable curriculum label resolved by the backend. It currently mirrors
   * `skillId`; the UI prefers `skillName` when present and never fabricates one.
   */
  skillName?: string;
  masteryLevel: number;
  confidence: number;
  attempts: number;
  correctAttempts: number;
  accuracy: number;
  /**
   * Persisted mastery trend: `'UP' | 'DOWN' | 'STABLE'`. Informational only — the
   * UI never derives a trend of its own.
   */
  trend?: 'UP' | 'DOWN' | 'STABLE' | string | null;
  lastAttemptAt?: string | null;
}

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
  /**
   * Phase 7.4: Human-readable topic name resolved server-side.
   * The frontend should use this for display instead of microSkillId.
   * Null when the topic cannot be resolved.
   */
  topicName?: string | null;
}

export interface ErrorAnalysisView {
  errorType: string | null;
  hypothesis: string | null;
  validated: boolean;
}

const ALLOWED_UPLOAD_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'application/pdf'];

/**
 * Upload an image/PDF. The file is base64-encoded and sent as JSON so the
 * existing backend body stack is reused; validation and storage happen on the
 * backend (the browser is never the authority on file safety).
 */
export function uploadAsset(
  file: File,
  sourceId?: string
): Promise<UploadedAssetResult> {
  if (!ALLOWED_UPLOAD_TYPES.includes(file.type)) {
    return Promise.reject(
      new ApiError(
        'Desteklenmeyen dosya türü. PNG, JPEG, WEBP veya PDF yükleyin.',
        400,
        'UNSUPPORTED_MIME_TYPE'
      )
    );
  }

  // Send the RAW bytes: the backend stores bytes and validates content by
  // signature. A JSON/base64 body would be escaped by the backend's global input
  // sanitizer, so it is deliberately avoided here.
  const query = sourceId ? `?sourceId=${encodeURIComponent(sourceId)}` : '';
  return file.arrayBuffer().then((buffer) =>
    apiRequest<UploadedAssetResult>(`/question-ingestions/upload${query}`, {
      method: 'POST',
      rawBody: new Uint8Array(buffer),
      headers: {
        'Content-Type': file.type,
        'X-Upload-Filename': encodeURIComponent(file.name),
      },
    })
  );
}

export function createIngestion(
  input: { rawText: string; sourceId?: string }
): Promise<QuestionIngestion> {
  return apiRequest<QuestionIngestion>('/question-ingestions', {
    method: 'POST',
    idempotencyKey: generateStableIdempotencyKey('ingestion', input.rawText),
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
  timeSpentSeconds: number
): Promise<AttemptResult> {
  return apiRequest<AttemptResult>('/question-attempts', {
    method: 'POST',
    idempotencyKey: generateStableIdempotencyKey('attempt', `${questionId}:${answer}`),
    body: { questionId, answer, timeSpentSeconds, sessionId: 'standalone' },
  });
}

export function getAttempt(attemptId: string): Promise<AttemptResult> {
  return apiRequest<AttemptResult>(`/question-attempts/${attemptId}`);
}

export function getAttemptsForStudent(limit: number = 20): Promise<AttemptResult[]> {
  return apiRequest<AttemptResult[]>(`/question-attempts?limit=${limit}`);
}

/**
 * Request SAFE pedagogical guidance for an attempt the student already made.
 *
 * Only `attemptId` and `mode` are sent. The backend derives the question, the
 * student's answer, the authoritative MicroSkill and any persisted error
 * classification server-side from the authenticated student's own persisted
 * attempt — the browser never supplies them, and never supplies a correct answer.
 */
export function requestGuidance(
  attemptId: string,
  mode: GuidanceMode
): Promise<GuidanceResult> {
  return apiRequest<GuidanceResult>('/ai/explanation', {
    method: 'POST',
    body: { attemptId, mode },
  });
}

export function getMySkillProgress(): Promise<SkillProgress[]> {
  return apiRequest<SkillProgress[]>('/analytics/me/skills');
}

export function getNextRecommendation(): Promise<NextRecommendation> {
  return apiRequest<NextRecommendation>('/recommendations/next');
}

// ---------------------------------------------------------- reviewer (staff)

export function getReviewQueue(token: string): Promise<ReviewQueueItem[]> {
  return apiRequest<ReviewQueueItem[]>('/review-queue', { token });
}

export function reviewCurriculumCandidate(
  token: string,
  candidateId: string,
  decision: 'PRIMARY' | 'SECONDARY' | 'REJECTED',
  rationale?: string
): Promise<unknown> {
  return apiRequest(`/curriculum-candidates/${candidateId}/review`, {
    method: 'POST',
    token,
    body: { decision, reviewed: true, ...(rationale ? { rationale } : {}) },
  });
}

export function reviewSkillMapping(
  token: string,
  mappingId: string,
  body: { reviewed: boolean; isPrimary?: boolean }
): Promise<unknown> {
  return apiRequest(`/question-skill-mappings/${mappingId}/review`, {
    method: 'POST',
    token,
    body,
  });
}

// ---------------------------------------------------------- student profile

export interface StudentProfile {
  id: string;
  userId: string;
  grade: number;
  school?: string;
  learningStage?: string;
  createdAt: string;
  updatedAt: string;
}

export function getMyProfile(): Promise<StudentProfile> {
  return apiRequest<StudentProfile>('/students/me');
}

export function updateStudentGrade(studentId: string, grade: number): Promise<StudentProfile> {
  return apiRequest<StudentProfile>(`/students/${studentId}/grade`, {
    method: 'PUT',
    body: { grade },
  });
}
