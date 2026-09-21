import { getEnv } from '../../../config/environment.js';

/**
 * Question Understanding configuration — Phase 5F.9-B
 *
 * Follows the repository's existing config convention (see getOcrConfig /
 * getAIConfig): a plain function over `getEnv()` returning a typed, validated
 * object. No second configuration system is introduced.
 *
 * SAFE DEFAULTS
 * - `provider` defaults to `mock`: no question text is sent to an external AI.
 * - `allowExternalProvider` defaults to false, so even selecting a real provider
 *   does not silently enable data egress.
 * Phase 7.4: Added Gemini support as an alternative to OpenAI.
 */
export type QuestionUnderstandingProviderKind = 'mock' | 'openai' | 'gemini';

export interface QuestionUnderstandingConfig {
  provider: QuestionUnderstandingProviderKind;
  /** Model name for the real provider. */
  model: string;
  /** Bounded per-request timeout in milliseconds. */
  timeoutMs: number;
  /** Bounded retry count for TRANSIENT failures only. */
  maxRetries: number;
  /** Phase 7.1 (cost control): bounded output tokens for the real provider. */
  maxTokens: number;
  /** Phase 7.1 (cost control): bounded normalized-text input size in characters. */
  maxInputChars: number;
  /** Explicit gate for sending student question text to an external provider. */
  allowExternalProvider: boolean;
  /** API base URL for the real provider (OpenAI only). */
  baseUrl: string;
  /** API key for the real provider. Never logged. */
  apiKey: string;
  /** Phase 7.4: Gemini-specific API key. Never logged. */
  geminiApiKey: string;
}

const DEFAULT_TIMEOUT_MS = 30000;
const DEFAULT_MAX_RETRIES = 2;
// Phase 7.5: an IMAGE_UPLOAD now also asks the model for a verbatim transcription
// of the question, so the response (transcription + analysis + warnings) is longer
// than the classify-only text response was. 1024 was enough to be truncated on
// some responses, which surfaced as "Unterminated string in JSON".
const DEFAULT_MAX_TOKENS = 4096;
const DEFAULT_MAX_INPUT_CHARS = 8000;

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

export function getQuestionUnderstandingConfig(): QuestionUnderstandingConfig {
  const env = getEnv();

  const provider = (env.QUESTION_UNDERSTANDING_PROVIDER as QuestionUnderstandingProviderKind) ?? 'mock';

  // Phase 7.4: Use Gemini-specific model when provider is Gemini.
  // The Interactions API + `gemini-3.6-flash` is the current supported default;
  // older models such as gemini-2.5-flash are no longer available to new users.
  const model = provider === 'gemini'
    ? (env.GEMINI_MODEL || 'gemini-3.6-flash')
    : (env.QUESTION_UNDERSTANDING_MODEL || 'gpt-4o');

  return {
    provider,
    model,
    timeoutMs: parsePositiveInt(env.QUESTION_UNDERSTANDING_TIMEOUT_MS, DEFAULT_TIMEOUT_MS),
    maxRetries: parsePositiveInt(env.QUESTION_UNDERSTANDING_MAX_RETRIES, DEFAULT_MAX_RETRIES),
    maxTokens: parsePositiveInt(env.QUESTION_UNDERSTANDING_MAX_TOKENS, DEFAULT_MAX_TOKENS),
    maxInputChars: parsePositiveInt(
      env.QUESTION_UNDERSTANDING_MAX_INPUT_CHARS,
      DEFAULT_MAX_INPUT_CHARS
    ),
    allowExternalProvider:
      String(env.QUESTION_UNDERSTANDING_ALLOW_EXTERNAL_PROVIDER).toLowerCase() === 'true',
    // Phase 7.1: env-overridable, defaulting to the OpenAI convention.
    baseUrl: env.QUESTION_UNDERSTANDING_BASE_URL || 'https://api.openai.com/v1',
    apiKey: env.OPENAI_API_KEY || '',
    // Phase 7.4: Gemini API key
    geminiApiKey: env.GEMINI_API_KEY || '',
  };
}
