import { beforeAll, afterAll, beforeEach, vi } from 'vitest';
import dotenv from 'dotenv';

// Load test environment
dotenv.config({ path: '.env.test' });

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
  try {
    await prisma.questionAttempt.deleteMany({});
    await prisma.learningSessionQuestion.deleteMany({});
    await prisma.learningSession.deleteMany({});
    await prisma.studentProfile.deleteMany({});
    await prisma.user.deleteMany({});
    await prisma.question.deleteMany({});
    await prisma.assessment.deleteMany({});
    await prisma.refreshToken.deleteMany({});
    await prisma.session.deleteMany({});
  } catch (error) {
    // Ignore errors if tables don't exist
  }
});

export { prisma };
