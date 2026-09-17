import { getEnv } from '../../config/environment.js';

/**
 * OCR configuration — Phase 5F.9-A
 *
 * Follows the repository's existing config convention (see getAIConfig /
 * getSecurityConfig): a plain function over `getEnv()` that returns a typed,
 * validated config object. No second configuration system is introduced.
 *
 * SAFE DEFAULTS
 * - `provider` defaults to `mock`: nothing is sent to an external service.
 * - `allowExternalProvider` defaults to false, so even selecting a real provider
 *   does not silently enable data egress.
 */
export type OcrProviderKind = 'mock' | 'openai';

export interface OcrConfig {
  provider: OcrProviderKind;
  /** Vision model name for the real provider. */
  model: string;
  /** Bounded per-request timeout in milliseconds. */
  timeoutMs: number;
  /** Bounded retry count for TRANSIENT failures only. */
  maxRetries: number;
  /** Phase 7.1 (cost control): bounded output tokens for the real provider. */
  maxTokens: number;
  /**
   * Phase 7.1 (cost control): maximum accepted asset size in bytes. A caller that
   * hands the provider an oversized image is rejected BEFORE any external request,
   * so a single upload can never drive an unbounded (and unbilled) model call.
   */
  maxImageBytes: number;
  /** Explicit gate for sending student assets to an external provider. */
  allowExternalProvider: boolean;
  /** API base URL for the real provider (from the existing AI config). */
  baseUrl: string;
  /** API key for the real provider. Never logged. */
  apiKey: string;
}

const DEFAULT_TIMEOUT_MS = 30000;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_MAX_TOKENS = 1024;
// Phase 7.1: aligned with the upload layer's default MAX_UPLOAD_BYTES (7 MiB).
const DEFAULT_MAX_IMAGE_BYTES = 7 * 1024 * 1024;

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

export function getOcrConfig(): OcrConfig {
  const env = getEnv();

  return {
    provider: (env.OCR_PROVIDER as OcrProviderKind) ?? 'mock',
    model: env.OCR_MODEL,
    timeoutMs: parsePositiveInt(env.OCR_TIMEOUT_MS, DEFAULT_TIMEOUT_MS),
    maxRetries: parsePositiveInt(env.OCR_MAX_RETRIES, DEFAULT_MAX_RETRIES),
    maxTokens: parsePositiveInt(env.OCR_MAX_TOKENS, DEFAULT_MAX_TOKENS),
    maxImageBytes: parsePositiveInt(env.OCR_MAX_IMAGE_BYTES, DEFAULT_MAX_IMAGE_BYTES),
    allowExternalProvider: String(env.OCR_ALLOW_EXTERNAL_PROVIDER).toLowerCase() === 'true',
    // Phase 7.1: env-overridable, defaulting to the OpenAI convention.
    baseUrl: env.OCR_BASE_URL || 'https://api.openai.com/v1',
    apiKey: env.OPENAI_API_KEY || '',
  };
}
