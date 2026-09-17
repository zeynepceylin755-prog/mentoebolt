import { getEnv } from '../../../config/environment.js';

/**
 * Error Analysis configuration — Phase 5F.9-C
 *
 * Follows the repository's existing config convention (see getOcrConfig /
 * getQuestionUnderstandingConfig / getAIConfig): a plain function over `getEnv()`
 * returning a typed, validated object. No second configuration system is
 * introduced.
 *
 * SAFE DEFAULTS
 * - `provider` defaults to `mock`: no student question text or answer is sent to
 *   an external AI.
 * - `allowExternalProvider` defaults to false, so even selecting a real provider
 *   does not silently enable data egress for student answers.
 */
export type ErrorAnalysisProviderKind = 'mock' | 'openai';

export interface ErrorAnalysisConfig {
  provider: ErrorAnalysisProviderKind;
  /** Text model used by the real provider for structured classification. */
  model: string;
  /** Bounded per-request timeout in milliseconds. */
  timeoutMs: number;
  /** Bounded retry count for TRANSIENT failures only. */
  maxRetries: number;
  /** Phase 7.1 (cost control): bounded output tokens for the real provider. */
  maxTokens: number;
  /** Explicit gate for sending student answers to an external provider. */
  allowExternalProvider: boolean;
  /** API base URL for the real provider (reuses the existing OpenAI convention). */
  baseUrl: string;
  /** API key for the real provider. Never logged. */
  apiKey: string;
}

const DEFAULT_TIMEOUT_MS = 30000;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_MAX_TOKENS = 1024;

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

export function getErrorAnalysisConfig(): ErrorAnalysisConfig {
  const env = getEnv();

  return {
    provider: (env.ERROR_ANALYSIS_PROVIDER as ErrorAnalysisProviderKind) ?? 'mock',
    model: env.ERROR_ANALYSIS_MODEL,
    timeoutMs: parsePositiveInt(env.ERROR_ANALYSIS_TIMEOUT_MS, DEFAULT_TIMEOUT_MS),
    maxRetries: parsePositiveInt(env.ERROR_ANALYSIS_MAX_RETRIES, DEFAULT_MAX_RETRIES),
    maxTokens: parsePositiveInt(env.ERROR_ANALYSIS_MAX_TOKENS, DEFAULT_MAX_TOKENS),
    allowExternalProvider:
      String(env.ERROR_ANALYSIS_ALLOW_EXTERNAL_PROVIDER).toLowerCase() === 'true',
    // Phase 7.1: env-overridable, defaulting to the OpenAI convention.
    baseUrl: env.ERROR_ANALYSIS_BASE_URL || 'https://api.openai.com/v1',
    apiKey: env.OPENAI_API_KEY || '',
  };
}
