import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.string().default('3000'),
  JWT_SECRET: z.string().min(32).default('default-secret-key-change-this-in-production'),
  JWT_EXPIRES_IN: z.string().default('7d'),
  JWT_REFRESH_SECRET: z.string().min(32).default('default-refresh-secret-change-this-in-production'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('30d'),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  RATE_LIMIT_WINDOW_MS: z.string().default('900000'),
  RATE_LIMIT_MAX_REQUESTS: z.string().default('100'),
  DATABASE_URL: z.string().default('file:./dev.db'),
  AI_PROVIDER: z.string().default('mock'),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().default('gpt-4-turbo-preview'),
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().default('claude-3-opus-20240229'),
  GOOGLE_API_KEY: z.string().optional(),
  GOOGLE_MODEL: z.string().default('gemini-pro'),
  DEEPSEEK_API_KEY: z.string().optional(),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  EMAIL_PROVIDER: z.string().default('mock'),
  EMAIL_FROM: z.string().email().default('noreply@mentora.ai'),
});

export type Environment = z.infer<typeof envSchema>;

let cachedEnv: Environment | null = null;

export function getEnv(): Environment {
  if (cachedEnv) return cachedEnv;

  try {
    cachedEnv = envSchema.parse(process.env);
    return cachedEnv;
  } catch (error) {
    if (error instanceof z.ZodError) {
      const errors = error.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join('\n');
      throw new Error(`Environment validation failed:\n${errors}`);
    }
    throw error;
  }
}
