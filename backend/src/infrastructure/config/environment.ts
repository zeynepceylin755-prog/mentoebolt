import dotenv from 'dotenv';
import { z } from 'zod';
import { assertProductionConfig } from './productionValidation.js';

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.string().default('3000'),
  JWT_SECRET: z.string().min(32).default('default-secret-key-change-this-in-production'),
  JWT_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_SECRET: z.string().min(32).default('default-refresh-secret-change-this-in-production'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),
  // Phase 7.3: support BOTH the production plural form (CORS_ORIGINS, used by
  // .env.example / docker-compose) and the historical singular CORS_ORIGIN.
  // Previously only CORS_ORIGIN was read, so a deployment that set CORS_ORIGINS
  // silently fell back to the localhost default — a real production CORS gap.
  CORS_ORIGINS: z.string().optional(),
  CORS_ORIGIN: z.string().optional().default('http://localhost:5173'),
  RATE_LIMIT_WINDOW_MS: z.string().default('900000'),
  RATE_LIMIT_MAX_REQUESTS: z.string().default('100'),
  DATABASE_URL: z.string().default('file:./dev.db'),
  // Phase 5F.9-C: the generic AI provider surface is restricted to the provider
  // families that actually have an implementation ('mock' | 'openai'). Declaring
  // anthropic/google/deepseek here would advertise support that does not exist.
  AI_PROVIDER: z.enum(['mock', 'openai']).default('mock'),
  OPENAI_API_KEY: z.string().optional(),
  // A currently supported OpenAI model suitable for structured text
  // classification. The obsolete 'gpt-4-turbo-preview' default was removed in
  // Phase 5F.9-C. Overridable through the environment.
  OPENAI_MODEL: z.string().default('gpt-4o'),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  EMAIL_PROVIDER: z.string().default('mock'),
  EMAIL_FROM: z.string().email().default('noreply@mentora.ai'),
  FRONTEND_URL: z.string().optional(),
  // Phase 5F.8 (C): upload storage. The directory is configurable and used only
  // by the local development storage provider. Files are never stored in Prisma.
  // Phase 7.3 - Production safety: Default to /tmp/uploads in production for better permission handling
  UPLOAD_DIR: z.string().default(process.env.NODE_ENV === 'production' ? '/tmp/uploads' : 'uploads'),
  // Kept below the JSON body limit (10mb) to leave room for base64 overhead
  // (~4/3), so a valid file is never rejected by the transport before this
  // limit is applied. Enforced independently in AssetUploadService.
  MAX_UPLOAD_BYTES: z.string().default(String(7 * 1024 * 1024)),

  // Phase 5F.9-A: OCR provider selection. `mock` is the SAFE DEFAULT so no
  // student image ever leaves the server unless a real provider is explicitly
  // selected AND external egress is explicitly allowed.
  OCR_PROVIDER: z.enum(['mock', 'openai']).default('mock'),
  OCR_MODEL: z.string().default('gpt-4o'),
  OCR_TIMEOUT_MS: z.string().default('30000'),
  OCR_MAX_RETRIES: z.string().default('2'),
  // Phase 7.1 (cost control): bounded output tokens for the real provider, so a
  // single OCR call cannot request an unbounded completion.
  OCR_MAX_TOKENS: z.string().default('1024'),
  // Phase 7.1 (cost control): maximum accepted image size (bytes) before any
  // external vision request is made.
  OCR_MAX_IMAGE_BYTES: z.string().default(String(7 * 1024 * 1024)),
  // Phase 7.1: overridable API base URL (default: OpenAI). Declaring it in config
  // keeps the endpoint truthful and lets an opt-in smoke test point at a proxy or
  // a fake endpoint without touching production code.
  OCR_BASE_URL: z.string().default('https://api.openai.com/v1'),
  // Guards against accidental data egress: required to be 'true' for the real
  // provider to be usable. Defaults to 'false'.
  OCR_ALLOW_EXTERNAL_PROVIDER: z.string().default('false'),

  // Phase 5F.9-B: Question Understanding provider selection. `mock` is the SAFE
  // DEFAULT so no question text leaves the server unless a real provider is
  // explicitly selected AND external egress is explicitly allowed.
  // Phase 7.4: Added Gemini as an option for question understanding.
  QUESTION_UNDERSTANDING_PROVIDER: z.enum(['mock', 'openai', 'gemini']).default('mock'),
  QUESTION_UNDERSTANDING_MODEL: z.string().default('gpt-4o'),
  QUESTION_UNDERSTANDING_TIMEOUT_MS: z.string().default('30000'),
  QUESTION_UNDERSTANDING_MAX_RETRIES: z.string().default('2'),
  // Phase 7.1 (cost control): bounded output tokens and a bounded normalized-text
  // input size, so neither the prompt nor the completion is unbounded.
  //
  // Phase 7.5/7.6: this value is deliberately OPTIONAL rather than defaulted here.
  // The earlier `.default('1024')` always supplied a string, which silently
  // OVERRODE the question-understanding config layer's own DEFAULT_MAX_TOKENS
  // (raised to 8192 to cover the model's internal thinking tokens). Production
  // therefore kept truncating Gemini JSON mid-string with "Unterminated string in
  // JSON". Leaving it unset lets the config layer own the default; an explicit
  // env value still wins.
  QUESTION_UNDERSTANDING_MAX_TOKENS: z.string().optional(),
  QUESTION_UNDERSTANDING_MAX_INPUT_CHARS: z.string().optional(),
  QUESTION_UNDERSTANDING_BASE_URL: z.string().default('https://api.openai.com/v1'),
  QUESTION_UNDERSTANDING_ALLOW_EXTERNAL_PROVIDER: z.string().default('false'),
  // Phase 7.4: Gemini API key for question understanding
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().default('gemini-3.6-flash'),

  // Phase 5F.9-C: Error Analysis provider selection. `mock` is the SAFE DEFAULT so
  // no student question text or answer leaves the server unless a real provider is
  // explicitly selected AND external egress is explicitly allowed.
  ERROR_ANALYSIS_PROVIDER: z.enum(['mock', 'openai']).default('mock'),
  ERROR_ANALYSIS_MODEL: z.string().default('gpt-4o'),
  ERROR_ANALYSIS_TIMEOUT_MS: z.string().default('30000'),
  ERROR_ANALYSIS_MAX_RETRIES: z.string().default('2'),
  ERROR_ANALYSIS_MAX_TOKENS: z.string().default('1024'),
  ERROR_ANALYSIS_BASE_URL: z.string().default('https://api.openai.com/v1'),
  ERROR_ANALYSIS_ALLOW_EXTERNAL_PROVIDER: z.string().default('false'),

  // Phase 5F.9-D: Explanation / Hint provider selection. `mock` is the SAFE
  // DEFAULT so no question text or student answer leaves the server unless a real
  // provider is explicitly selected AND external egress is explicitly allowed.
  EXPLANATION_PROVIDER: z.enum(['mock', 'openai']).default('mock'),
  EXPLANATION_MODEL: z.string().default('gpt-4o'),
  EXPLANATION_TIMEOUT_MS: z.string().default('30000'),
  EXPLANATION_MAX_RETRIES: z.string().default('2'),
  EXPLANATION_MAX_TOKENS: z.string().default('1024'),
  EXPLANATION_BASE_URL: z.string().default('https://api.openai.com/v1'),
  EXPLANATION_ALLOW_EXTERNAL_PROVIDER: z.string().default('false'),

  // Phase 7.1: opt-in real-provider smoke tests. Defaults to false, so the normal
  // test suite NEVER makes an external AI request. A real smoke test is never
  // required for CI correctness.
  RUN_REAL_AI_SMOKE_TESTS: z.string().default('false'),
});

export type Environment = z.infer<typeof envSchema>;

export function getEnv(): Environment {
  try {
    const env = envSchema.parse(process.env);
    // Phase 7.3: fail CLOSED in production. The zod schema above applies
    // convenient DEVELOPMENT defaults (including well-known placeholder JWT
    // secrets); those must never survive into a real deployment. This throws
    // with a name-only, secret-free message when production config is unsafe.
    assertProductionConfig(
      {
        NODE_ENV: env.NODE_ENV,
        JWT_SECRET: env.JWT_SECRET,
        JWT_REFRESH_SECRET: env.JWT_REFRESH_SECRET,
        DATABASE_URL: env.DATABASE_URL,
        // Prefer the production plural variable; fall back to the singular one.
        CORS_ORIGIN:
          env.CORS_ORIGINS && env.CORS_ORIGINS.trim().length > 0
            ? env.CORS_ORIGINS
            : env.CORS_ORIGIN,
        OCR_PROVIDER: env.OCR_PROVIDER,
        QUESTION_UNDERSTANDING_PROVIDER: env.QUESTION_UNDERSTANDING_PROVIDER,
        ERROR_ANALYSIS_PROVIDER: env.ERROR_ANALYSIS_PROVIDER,
        EXPLANATION_PROVIDER: env.EXPLANATION_PROVIDER,
        OPENAI_API_KEY: env.OPENAI_API_KEY,
      },
      process.env
    );
    return env;
  } catch (error) {
    if (error instanceof z.ZodError) {
      const errors = error.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join('\n');
      throw new Error(`Environment validation failed:\n${errors}`);
    }
    throw error;
  }
}
