import { beforeAll, afterAll, beforeEach, vi } from 'vitest';
import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Load test environment
dotenv.config({ path: '.env.test' });

// Force an isolated test database regardless of what .env / .env.test contain.
// Without this, tests fall back to `file:./dev.db` and mutate the development
// database, causing cross-file interference and non-deterministic failures.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const testDbPath = path.resolve(__dirname, '../prisma/test.db');
process.env.DATABASE_URL = `file:${testDbPath}`;
process.env.NODE_ENV = 'test';

// Mock pino-http correctly
vi.mock('pino-http', async (importOriginal) => {
  const actual = await importOriginal() as any;
  return {
    ...actual,
    default: vi.fn(() => (req: any, res: any, next: any) => next()),
    pinoHttp: vi.fn(() => (req: any, res: any, next: any) => next()),
  };
});

// Mock logger
vi.mock('../src/infrastructure/logging/logger.js', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    child: vi.fn(() => ({
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    })),
  },
}));

// Mock environment config - use actual env
vi.mock('../src/infrastructure/config/environment.js', async () => {
  const actual = await import('../src/infrastructure/config/environment.js');
  return {
    ...actual,
    getEnv: vi.fn(() => ({
      NODE_ENV: 'test',
      PORT: '3001',
      JWT_SECRET: 'test-jwt-secret-key-at-least-32-characters-long',
      JWT_EXPIRES_IN: '15m',
      JWT_REFRESH_SECRET: 'test-refresh-secret-key-at-least-32-characters',
      JWT_REFRESH_EXPIRES_IN: '7d',
      CORS_ORIGIN: 'http://localhost:5173',
      RATE_LIMIT_WINDOW_MS: '900000',
      RATE_LIMIT_MAX_REQUESTS: '100',
      DATABASE_URL: 'file:./test.db',
      AI_PROVIDER: 'mock',
      // Phase 5F.9-A: OCR defaults to the safe mock provider in tests.
      OCR_PROVIDER: 'mock',
      OCR_MODEL: 'gpt-4o',
      OCR_TIMEOUT_MS: '30000',
      OCR_MAX_RETRIES: '2',
      OCR_MAX_TOKENS: '1024',
      OCR_MAX_IMAGE_BYTES: String(7 * 1024 * 1024),
      OCR_ALLOW_EXTERNAL_PROVIDER: 'false',
      // Phase 5F.9-B: Question Understanding defaults to mock in tests.
      QUESTION_UNDERSTANDING_PROVIDER: 'mock',
      QUESTION_UNDERSTANDING_MODEL: 'gpt-4o',
      QUESTION_UNDERSTANDING_TIMEOUT_MS: '30000',
      QUESTION_UNDERSTANDING_MAX_RETRIES: '2',
      QUESTION_UNDERSTANDING_ALLOW_EXTERNAL_PROVIDER: 'false',
    })),
  };
});

// Mock security config
vi.mock('../src/infrastructure/config/security.js', () => ({
  getSecurityConfig: vi.fn(() => ({
    jwt: {
      secret: 'test-jwt-secret-key-at-least-32-characters-long',
      expiresIn: '15m',
      refreshSecret: 'test-refresh-secret-key-at-least-32-characters',
      refreshExpiresIn: '7d',
    },
    cors: {
      allowedOrigins: ['http://localhost:5173'],
      allowedMethods: ['GET', 'POST', 'PUT', 'DELETE'],
      allowedHeaders: ['Content-Type', 'Authorization'],
      exposedHeaders: ['X-RateLimit-*'],
      maxAge: 86400,
      credentials: true,
    },
    rateLimit: {
      windowMs: 900000,
      max: 100,
    },
    securityHeaders: {
      contentSecurityPolicy: false,
      hsts: false,
      noSniff: true,
      xssProtection: true,
      frameOptions: true,
      referrerPolicy: true,
    },
    input: {
      maxBodySize: '10mb',
      maxUrlLength: 2048,
      maxParameterCount: 100,
    },
  })),
}));

// Mock AI provider
vi.mock('../src/infrastructure/ai/AIServiceFactory.js', () => ({
  AIServiceFactory: {
    getInstance: vi.fn(() => ({
      getProvider: vi.fn(() => ({
        getProviderName: vi.fn(() => 'mock'),
        getModelName: vi.fn(() => 'mock-model'),
        getVersion: vi.fn(() => '1.0.0'),
        complete: vi.fn(async () => ({
          content: JSON.stringify({ errorType: 'CONCEPT', confidence: 0.7 }),
          model: 'mock-model',
          version: '1.0.0',
          tokensUsed: 100,
          latencyMs: 100,
          finishReason: 'stop',
        })),
        completeStructured: vi.fn(async () => ({
          content: JSON.stringify({ errorType: 'CONCEPT', confidence: 0.7 }),
          structured: { errorType: 'CONCEPT', confidence: 0.7 },
          model: 'mock-model',
          version: '1.0.0',
          tokensUsed: 100,
          latencyMs: 100,
          finishReason: 'stop',
        })),
        isAvailable: vi.fn(() => true),
      })),
    })),
  },
}));

// Global test database
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

beforeAll(async () => {
  await prisma.$connect();
});

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  // Phase 7.3: reset in-memory rate-limit counters. The limiters store state
  // per-process; because all test files share one fork, counters accumulated
  // across files and a later file could be spuriously rate-limited (the known
  // full-suite flake). Resetting before each test makes each file independent.
  try {
    const { RateLimiter } = await import('../src/infrastructure/security/RateLimiter.js');
    RateLimiter.resetAll();
  } catch {
    // A partially initialised module must never abort the whole suite.
  }

  // Delete in child -> parent order to respect foreign keys, enabling FKs
  // first (SQLite does not enforce them by default). Guard each deletion so a
  // missing table (e.g. a partially migrated DB) does not abort the run.
  await prisma.$executeRawUnsafe('PRAGMA foreign_keys = ON').catch(() => {});
  const tables = [
    'questionSkillMapping',
    'errorPatternMicroSkill',
    // Phase 5A: question ingestion layer must be cleared before Question and before
    // QuestionSource (questionAttempt references questionInstance, so it is already
    // deleted earlier in this list).
    'curriculumCandidate',
    'questionIngestion',
    'questionInstance',
    'microSkill',
    'errorPattern',
    'masteryAudit',
    'idempotencyRecord',
    'outboxEvent',
    'errorAnalysis',
    'diagnosticResult',
    'assessmentResult',
    'questionAttempt',
    'assessmentAttempt',
    'learningSessionQuestion',
    'learningSession',
    'recommendation',
    'learningProgress',
    'skillMastery',
    'topicMastery',
    'assessmentQuestion',
    'assessment',
    'questionOption',
    'question',
    'questionSource',
    'refreshToken',
    'session',
    'auditLog',
    'studentProfile',
    'user',
  ];
  for (const table of tables) {
    try {
      await (prisma as any)[table].deleteMany({});
    } catch (error) {
      // Ignore errors if the table does not exist yet
    }
  }
});

export { prisma };
