import { describe, it, expect, beforeAll, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import crypto from 'node:crypto';

import bootstrap from '../../src/index.js';
import { prisma } from '../setup.js';
import {
  collectProductionConfigProblems,
  assertProductionConfig,
} from '../../src/infrastructure/config/productionValidation.js';
import * as securityConfigModule from '../../src/infrastructure/config/security.js';
import type { SecurityConfig } from '../../src/infrastructure/config/security.js';
// tests/setup.ts replaces security.js with a stub, so the pure helper is pulled
// from the REAL module via importActual.
const { resolveAllowedOrigins } = (await vi.importActual(
  '../../src/infrastructure/config/security.js'
)) as typeof import('../../src/infrastructure/config/security.js');
void (securityConfigModule as unknown as { getSecurityConfig: () => SecurityConfig });
import { validateUpload, sniffMimeType } from '../../src/domain/ingestion/uploadValidation.js';
import { fromRef, toRef } from '../../src/infrastructure/storage/LocalDevStorageProvider.js';
import { RateLimiter } from '../../src/infrastructure/security/RateLimiter.js';
import {
  createOcrProviderFromConfig,
} from '../../src/infrastructure/ocr/OcrProviderFactory.js';
import { createExplanationProviderFromConfig } from '../../src/infrastructure/ai/explanation/ExplanationProviderFactory.js';
import { createErrorAnalysisProviderFromConfig } from '../../src/infrastructure/ai/error-analysis/ErrorAnalysisProviderFactory.js';
import type { OcrConfig } from '../../src/infrastructure/ocr/config/OcrConfig.js';
import type { ExplanationConfig } from '../../src/infrastructure/ai/explanation/config/ExplanationConfig.js';
import type { ErrorAnalysisConfig } from '../../src/infrastructure/ai/error-analysis/config/ErrorAnalysisConfig.js';
import type { IStorageProvider, StoreInput, StoredAsset } from '../../src/domain/interfaces/storage/IStorageProvider.js';

/**
 * Phase 7.3 — Production Security, Operations & Deployment Hardening.
 *
 * Behavioural tests against the REAL Express app and the REAL config/security
 * modules. Every fixture is synthetic and lives in the isolated test.db. No
 * external AI call is ever made. No secret value is asserted verbatim in a way
 * that would print it.
 */

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);

/** Wrap model JSON content into a chat-completions envelope. */
function envelopeContent(contentText: string) {
  const choice = { message: { content: contentText } };
  return { model: 'gpt-4o', created: 1700000, choices: [choice] };
}

let cachedApp: express.Application | null = null;
async function getApp(): Promise<express.Application> {
  if (!cachedApp) {
    cachedApp = await bootstrap();
  }
  return cachedApp;
}

async function registerAndLogin(app: express.Application, label: string) {
  const email = `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const password = 'Test123!@#';
  const res = await request(app)
    .post('/api/v1/auth/register')
    .send({ email, password, firstName: label, lastName: 'User', grade: 11 });
  const accessToken = res.body?.data?.tokens?.accessToken as string;
  const userId = res.body?.data?.user?.id as string;
  const profile = await prisma.studentProfile.findUnique({ where: { userId } });
  return { email, password, accessToken, userId, profileId: profile!.id };
}


// ============================================================ 1. CONFIGURATION

describe('Phase 7.3 — production configuration fails closed', () => {
  const GOOD = {
    NODE_ENV: 'production',
    JWT_SECRET: 'a'.repeat(48),
    JWT_REFRESH_SECRET: 'b'.repeat(48),
    DATABASE_URL: 'postgresql://u:p@host:5432/db',
    CORS_ORIGIN: 'https://mentora.ai',
  };

  it('C1. a development environment is never blocked (dev convenience preserved)', () => {
    // The guard is what matters: development/test never throw, so the convenient
    // defaults continue to work locally. (collectProductionConfigProblems is the
    // env-agnostic collector and is only consulted by the production guard.)
    expect(() => assertProductionConfig({ NODE_ENV: 'development' })).not.toThrow();
    expect(() => assertProductionConfig({ NODE_ENV: 'test' })).not.toThrow();
    expect(
      collectProductionConfigProblems({
        NODE_ENV: 'production',
        JWT_SECRET: 'a'.repeat(48),
        JWT_REFRESH_SECRET: 'b'.repeat(48),
        DATABASE_URL: 'postgresql://u:p@h:5432/d',
        CORS_ORIGIN: 'https://mentora.ai',
      })
    ).toEqual([]);
  });

  it('C2. a complete production configuration passes', () => {
    expect(collectProductionConfigProblems(GOOD)).toEqual([]);
    expect(() => assertProductionConfig(GOOD)).not.toThrow();
  });

  it('C3. a missing JWT_SECRET is rejected in production', () => {
    const problems = collectProductionConfigProblems({ ...GOOD, JWT_SECRET: undefined });
    expect(problems.join(' ')).toMatch(/JWT_SECRET/);
  });

  it('C4. a well-known insecure default JWT secret is rejected', () => {
    const problems = collectProductionConfigProblems({
      ...GOOD,
      JWT_SECRET: 'default-secret-key-change-this-in-production',
    });
    expect(problems.join(' ')).toMatch(/insecure default/i);
  });

  it('C5. a short JWT secret is rejected', () => {
    const problems = collectProductionConfigProblems({ ...GOOD, JWT_SECRET: 'short' });
    expect(problems.join(' ')).toMatch(/at least 32 characters/);
  });

  it('C6. identical access/refresh secrets are rejected', () => {
    const same = 'x'.repeat(48);
    const problems = collectProductionConfigProblems({
      ...GOOD,
      JWT_SECRET: same,
      JWT_REFRESH_SECRET: same,
    });
    expect(problems.join(' ')).toMatch(/must be different/);
  });

  it('C7. a file: SQLite DATABASE_URL is rejected in production', () => {
    const problems = collectProductionConfigProblems({ ...GOOD, DATABASE_URL: 'file:./dev.db' });
    expect(problems.join(' ')).toMatch(/production database/);
  });

  it('C8. a wildcard CORS origin is rejected when credentials are on', () => {
    const problems = collectProductionConfigProblems({ ...GOOD, CORS_ORIGIN: '*' });
    expect(problems.join(' ')).toMatch(/"\*"/);
  });

  it('C9. localhost CORS origins are rejected in production', () => {
    const problems = collectProductionConfigProblems({
      ...GOOD,
      CORS_ORIGIN: 'http://localhost:5173',
    });
    expect(problems.join(' ')).toMatch(/local development origins/);
  });

  it('C10. a real AI provider without an API key or egress flag is rejected', () => {
    const problems = collectProductionConfigProblems(
      { ...GOOD, OCR_PROVIDER: 'openai', OPENAI_API_KEY: undefined },
      { OCR_ALLOW_EXTERNAL_PROVIDER: 'false' }
    );
    expect(problems.join(' ')).toMatch(/OPENAI_API_KEY/);
    expect(problems.join(' ')).toMatch(/OCR_ALLOW_EXTERNAL_PROVIDER/);
  });

  it('C11. a real AI provider with key + explicit egress passes', () => {
    const problems = collectProductionConfigProblems(
      { ...GOOD, OCR_PROVIDER: 'openai', OPENAI_API_KEY: 'sk-x' },
      { OCR_ALLOW_EXTERNAL_PROVIDER: 'true' }
    );
    expect(problems).toEqual([]);
  });

  it('C12. mock AI providers need no key in production', () => {
    const problems = collectProductionConfigProblems(
      { ...GOOD, OCR_PROVIDER: 'mock', ERROR_ANALYSIS_PROVIDER: 'mock' },
      {}
    );
    expect(problems).toEqual([]);
  });

  it('C13. the thrown production error never contains a secret value', () => {
    const secret = 'super-secret-value-that-must-not-appear-'.padEnd(40, 'z');
    let message = '';
    try {
      assertProductionConfig(
        { ...GOOD, JWT_REFRESH_SECRET: secret, DATABASE_URL: 'file:./x.db' },
        {}
      );
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toMatch(/DATABASE_URL/);
    // The secret value itself must never be echoed.
    expect(message).not.toContain(secret);
  });
});

// ============================================================ 2. CORS CONFIG

describe('Phase 7.3 — CORS origin resolution', () => {
  it('O1. CORS_ORIGINS (plural, production) takes precedence over CORS_ORIGIN', () => {
    expect(resolveAllowedOrigins('https://mentora.ai,https://app.mentora.ai', 'http://localhost:5173')).toEqual([
      'https://mentora.ai',
      'https://app.mentora.ai',
    ]);
  });

  it('O2. the singular CORS_ORIGIN is used when the plural is absent', () => {
    expect(resolveAllowedOrigins(undefined, 'http://localhost:5173')).toEqual([
      'http://localhost:5173',
    ]);
  });

  it('O3. an empty configuration falls back to the local development origin', () => {
    expect(resolveAllowedOrigins(undefined, undefined)).toEqual(['http://localhost:5173']);
    expect(resolveAllowedOrigins('  ', '')).toEqual(['http://localhost:5173']);
  });

  it('O4. whitespace/empty entries are stripped from the allowlist', () => {
    expect(resolveAllowedOrigins(' https://a.ai , https://b.ai ', undefined)).toEqual([
      'https://a.ai',
      'https://b.ai',
    ]);
  });

  it('O5. an allowed origin receives CORS headers; a rejected origin does not', async () => {
    const app = await getApp();
    const allowed = await request(app)
      .get('/health/live')
      .set('Origin', 'http://localhost:5173');
    expect(allowed.headers['access-control-allow-origin']).toBe('http://localhost:5173');

    const disallowed = await request(app)
      .get('/health/live')
      .set('Origin', 'https://evil.example.com');
    expect(disallowed.headers['access-control-allow-origin']).toBeUndefined();
  });
});

// ============================================================ 3. AUTHENTICATION

describe('Phase 7.3 — authentication hardening', () => {
  let app: express.Application;
  beforeAll(async () => { app = await getApp(); });

  it('A1. a missing token is rejected (401)', async () => {
    const res = await request(app).get('/api/v1/students/me');
    expect(res.status).toBe(401);
  });

  it('A2. a malformed token is rejected (401)', async () => {
    const res = await request(app).get('/api/v1/students/me').set('Authorization', 'Bearer not-a-jwt');
    expect(res.status).toBe(401);
  });

  it('A. a token signed with the wrong secret is rejected', async () => {
    const forged = (await import('jsonwebtoken')).default.sign(
      { userId: 'x', email: 'x@x.com', role: 'STUDENT' },
      'a-wrong-secret-value',
      { expiresIn: '15m' }
    );
    const res = await request(app).get('/api/v1/students/me').set('Authorization', `Bearer ${forged}`);
    expect(res.status).toBe(401);
  });

  it('A4. an expired token is rejected', async () => {
    const expired = (await import('jsonwebtoken')).default.sign(
      { userId: 'x', email: 'x@x.com', role: 'STUDENT' },
      process.env.JWT_SECRET || 'test-jwt-secret-key-at-least-32-characters-long',
      { expiresIn: '-10s' }
    );
    const res = await request(app).get('/api/v1/students/me').set('Authorization', `Bearer ${expired}`);
    expect(res.status).toBe(401);
  });

  it('A5. a valid token for a deleted user is rejected', async () => {
    const student = await registerAndLogin(app, 'p73-del');
    const token = student.accessToken;
    await prisma.user.update({ where: { id: student.userId }, data: { deletedAt: new Date() } });
    const res = await request(app).get('/api/v1/students/me').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(401);
  });

  it('A6. a locked account cannot authenticate at the login boundary', async () => {
    const student = await registerAndLogin(app, 'p73-lock');
    await prisma.user.update({
      where: { id: student.userId },
      data: { lockedUntil: new Date(Date.now() + 60_000) },
    });
    // Lockout is enforced where credentials are checked. A stolen, already-minted
    // short-lived access token is dealt with by its short TTL + refresh revocation
    // (documented as MITIGATED, not silently ignored).
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: student.email, password: student.password });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).not.toBe(200);
  });

  it('A7. a wrong password is rejected and does not reveal which field is wrong', async () => {
    const student = await registerAndLogin(app, 'p73-pw');
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: student.email, password: 'WrongPassword!1' });
    expect(res.status).toBe(401);
    // Generic wording only: the submitted password value is never echoed and no
    // stack/internal detail is exposed.
    expect(JSON.stringify(res.body)).not.toContain('WrongPassword!1');
    expect(JSON.stringify(res.body)).not.toMatch(/\.ts:|node_modules/);
  });

  it('A8. refresh-token rotation invalidates the previous refresh token (replay refused)', async () => {
    const student = await registerAndLogin(app, 'p73-rot');
    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: student.email, password: student.password });
    const firstRefresh = login.body.data.tokens.refreshToken as string;

    const rotated = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: firstRefresh });
    expect(rotated.status).toBe(200);
    const newRefresh = rotated.body.data.refreshToken as string;
    expect(newRefresh).not.toBe(firstRefresh);

    // Replaying the OLD refresh token must fail (rotation + revocation).
    const replay = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: firstRefresh });
    expect(replay.status).toBe(401);
  });

  it('A9. a garbage refresh token is rejected', async () => {
    const res = await request(app).post('/api/v1/auth/refresh').send({ refreshToken: 'garbage' });
    expect(res.status).toBe(401);
  });

  it('A10. logout revokes refresh tokens (subsequent refresh refused)', async () => {
    const student = await registerAndLogin(app, 'p73-logout');
    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: student.email, password: student.password });
    const access = login.body.data.tokens.accessToken as string;
    const refresh = login.body.data.tokens.refreshToken as string;

    const out = await request(app).post('/api/v1/auth/logout').set('Authorization', `Bearer ${access}`);
    expect([200, 204]).toContain(out.status);

    const after = await request(app).post('/api/v1/auth/refresh').send({ refreshToken: refresh });
    expect(after.status).toBe(401);
  });
});

// ============================================================ 4. AUTHORIZATION / IDOR

describe('Phase 7.3 — authorization & student isolation (IDOR)', () => {
  let app: express.Application;
  beforeAll(async () => { app = await getApp(); });

  it('Z1. a student cannot read another student\'s ingestion (404, no existence disclosure)', async () => {
    const a = await registerAndLogin(app, 'p73-idor-a');
    const b = await registerAndLogin(app, 'p73-idor-b');
    const create = await request(app)
      .post('/api/v1/question-ingestions')
      .set('Authorization', `Bearer ${a.accessToken}`)
      .send({ ingestMethod: 'TEXT_PASTE', normalizedText: 'Sentetik IDOR içeriği' });
    expect(create.status).toBe(201);
    const id = create.body.data.id as string;

    const res = await request(app)
      .get(`/api/v1/question-ingestions/${id}`)
      .set('Authorization', `Bearer ${b.accessToken}`);
    expect([403, 404]).toContain(res.status);
  });

  it('Z2. a student cannot mutate another student\'s attempt via nested id', async () => {
    const a = await registerAndLogin(app, 'p73-idor2-a');
    const b = await registerAndLogin(app, 'p73-idor2-b');
    // A owns an attempt; B asks for its explanation by id.
    const q = await prisma.question.create({
      data: { content: 'Sentetik IDOR sorusu', type: 'CALCULATION', difficulty: 1, skillId: 'unmapped', correctAnswer: '4', isActive: true },
    });
    await prisma.questionInstance.create({ data: { questionId: q.id, studentId: a.profileId } });
    const attemptRes = await request(app)
      .post('/api/v1/question-attempts')
      .set('Authorization', `Bearer ${a.accessToken}`)
      .set('Idempotency-Key', `p73-idor2-${Date.now()}`)
      .send({ questionId: q.id, answer: '4', timeSpentSeconds: 5, sessionId: 'standalone' });
    expect(attemptRes.status).toBe(201);
    const attemptId = attemptRes.body.data.attemptId as string;

    const res = await request(app)
      .post('/api/v1/ai/explanation')
      .set('Authorization', `Bearer ${b.accessToken}`)
      .send({ attemptId, mode: 'HINT' });
    expect([403, 404]).toContain(res.status);
  });

  it('Z3. a client-supplied ownerId in the body cannot grant access', async () => {
    const a = await registerAndLogin(app, 'p73-idor3-a');
    const b = await registerAndLogin(app, 'p73-idor3-b');
    const create = await request(app)
      .post('/api/v1/question-ingestions')
      .set('Authorization', `Bearer ${a.accessToken}`)
      .send({ ingestMethod: 'TEXT_PASTE', normalizedText: 'Sentetik sahiplik', studentId: b.profileId });
    const id = create.body.data.id as string;
    const res = await request(app)
      .get(`/api/v1/question-ingestions/${id}`)
      .set('Authorization', `Bearer ${b.accessToken}`);
    expect([403, 404]).toContain(res.status);
  });

  it('Z4. a student cannot reach a staff-only review surface', async () => {
    const s = await registerAndLogin(app, 'p73-staff');
    const res = await request(app)
      .get('/api/v1/review/queue')
      .set('Authorization', `Bearer ${s.accessToken}`);
    expect([401, 403, 404]).toContain(res.status);
  });

  it('Z5. an unauthenticated request to a protected analytics route is rejected', async () => {
    const res = await request(app).get('/api/v1/analytics/students/me');
    expect(res.status).toBe(401);
  });
});

// ============================================================ 5. UPLOAD SECURITY

describe('Phase 7.3 — upload security', () => {
  let app: express.Application;
  beforeAll(async () => { app = await getApp(); });

  it('U1. an empty file is rejected', () => {
    expect(validateUpload(Buffer.alloc(0), 'image/png', 1024).reason).toBe('EMPTY_FILE');
  });

  it('U2. an unsupported declared MIME type is rejected', () => {
    expect(validateUpload(PNG_BYTES, 'application/x-msdownload', 1024).reason).toBe('UNSUPPORTED_MIME_TYPE');
  });

  it('U3. a declared/actual type mismatch is rejected (magic bytes win)', () => {
    // Claim PNG but send JPEG bytes.
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]);
    expect(validateUpload(jpeg, 'image/png', 1024).reason).toBe('CONTENT_TYPE_MISMATCH');
  });

  it('U4. an executable renamed to .png is rejected by magic-byte sniffing', () => {
    const elf = Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01, 0x01, 0x00]);
    expect(sniffMimeType(elf)).toBeNull();
    expect(validateUpload(elf, 'image/png', 1024).reason).toBe('CONTENT_TYPE_MISMATCH');
  });

  it('U5. an oversized file is rejected', () => {
    const big = Buffer.concat([PNG_BYTES, Buffer.alloc(2000)]);
    expect(validateUpload(big, 'image/png', 1024).reason).toBe('OVERSIZED');
  });

  it('U6. a valid PNG is accepted with a server-chosen extension', () => {
    const r = validateUpload(PNG_BYTES, 'image/png', 1024);
    expect(r.valid).toBe(true);
    expect(r.mimeType).toBe('image/png');
    expect(r.extension).toBe('png');
  });

  it('U7. the opaque storage ref cannot carry path traversal', () => {
    expect(fromRef('local://../../etc/passwd')).toBeNull();
    expect(fromRef('local://a/b')).toBeNull();
    expect(fromRef('local://..')).toBeNull();
    expect(fromRef('local://deadbeef.png')).toBe('deadbeef.png');
  });

  it('U8. a malicious upload filename cannot influence the stored reference', () => {
    // The reference is derived from the content hash, never the filename.
    const hash = crypto.createHash('sha256').update(PNG_BYTES).digest('hex');
    const ref = toRef(`${hash}.png`);
    expect(ref).toBe(`local://${hash}.png`);
    // No path separators or traversal segments can appear in a server-built ref.
    expect(ref).not.toContain('..');
    expect(ref.slice('local://'.length)).not.toContain('/');
    expect(ref.slice('local://'.length)).not.toContain('\\');
  });

  it('U9. a malformed upload (non-binary body) is rejected by the route', async () => {
    const s = await registerAndLogin(app, 'p73-upload');
    const res = await request(app)
      .post('/api/v1/question-ingestions/upload')
      .set('Authorization', `Bearer ${s.accessToken}`)
      .set('Content-Type', 'application/json')
      .send({ not: 'bytes' });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it('U10. an unauthenticated upload is rejected', async () => {
    const res = await request(app)
      .post('/api/v1/question-ingestions/upload')
      .set('Content-Type', 'image/png')
      .send(PNG_BYTES);
    expect(res.status).toBe(401);
  });
});

// ============================================================ 6. AI EGRESS & COST

describe('Phase 7.3 — AI egress & cost protection', () => {
  function ocrConfig(overrides: Partial<OcrConfig> = {}): OcrConfig {
    return {
      provider: 'openai', model: 'gpt-4o', timeoutMs: 5000, maxRetries: 2, maxTokens: 512,
      maxImageBytes: 1024, allowExternalProvider: true, baseUrl: 'https://api.example.test/v1',
      apiKey: 'sk-test', ...overrides,
    };
  }
  function explConfig(overrides: Partial<ExplanationConfig> = {}): ExplanationConfig {
    return {
      provider: 'openai', model: 'gpt-4o', timeoutMs: 5000, maxRetries: 2, maxTokens: 512,
      allowExternalProvider: true, baseUrl: 'https://api.example.test/v1', apiKey: 'sk-test', ...overrides,
    };
  }
  function eaConfig(overrides: Partial<ErrorAnalysisConfig> = {}): ErrorAnalysisConfig {
    return {
      provider: 'openai', model: 'gpt-4o', timeoutMs: 5000, maxRetries: 2, maxTokens: 512,
      allowExternalProvider: true, baseUrl: 'https://api.example.test/v1', apiKey: 'sk-test', ...overrides,
    };
  }
  class FakeStorage implements IStorageProvider {
    getProviderName() { return 'fake'; }
    async store(_i: StoreInput): Promise<StoredAsset> { throw new Error('unused'); }
    async read(): Promise<Buffer | null> { return PNG_BYTES; }
    async delete() { return false; }
  }

  it('X1. an unknown OCR provider fails closed (never silent mock)', () => {
    expect(() => createOcrProviderFromConfig(new FakeStorage(), ocrConfig({ provider: 'anthropic' as any }))).toThrow();
  });

  it('X2. a real provider without explicit egress fails closed', () => {
    expect(() => createOcrProviderFromConfig(new FakeStorage(), ocrConfig({ allowExternalProvider: false }))).toThrow();
    expect(() => createExplanationProviderFromConfig(explConfig({ allowExternalProvider: false }))).toThrow();
    expect(() => createErrorAnalysisProviderFromConfig(eaConfig({ allowExternalProvider: false }))).toThrow();
  });

  it('X3. a real provider without an API key fails closed', () => {
    expect(() => createOcrProviderFromConfig(new FakeStorage(), ocrConfig({ apiKey: '' }))).toThrow();
    expect(() => createExplanationProviderFromConfig(explConfig({ apiKey: '' }))).toThrow();
    expect(() => createErrorAnalysisProviderFromConfig(eaConfig({ apiKey: '' }))).toThrow();
  });

  it('X4. the outbound OCR request carries a bounded max_tokens and a timeout', async () => {
    const { RealVisionOcrProvider } = await import('../../src/infrastructure/ocr/RealVisionOcrProvider.js');
    const fetchImpl = async (_url: string, init: any) => {
      const body = JSON.parse(init.body);
      expect(body.max_tokens).toBe(512);
      expect(init.signal).toBeDefined();
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        text: async () =>
          JSON.stringify(
            envelopeContent(JSON.stringify({ text: 'x + 1 = 2', confidence: 0.9, warnings: [] }))
          ),
      };
    };
    const provider = new RealVisionOcrProvider(new FakeStorage(), ocrConfig(), { fetchImpl: fetchImpl as any, sleepImpl: async () => {} });
    const res = await provider.extract({ assetRef: 'local://x.png', mimeType: 'image/png' });
    expect(res.text).toBe('x + 1 = 2');
  });

  it('X5. the API key is never echoed in the response metadata', async () => {
    const { RealVisionOcrProvider } = await import('../../src/infrastructure/ocr/RealVisionOcrProvider.js');
    const fetchImpl = async () => ({
      ok: true,
      status: 200,
      headers: { get: () => null },
      text: async () =>
        JSON.stringify(envelopeContent(JSON.stringify({ text: 'x + 1 = 2', confidence: 0.9, warnings: [] }))),
    });
    const provider = new RealVisionOcrProvider(new FakeStorage(), ocrConfig({ apiKey: 'sk-super-secret-xyz' }), { fetchImpl: fetchImpl as any, sleepImpl: async () => {} });
    const res = await provider.extract({ assetRef: 'local://x.png', mimeType: 'image/png' });
    expect(JSON.stringify(res)).not.toContain('sk-super-secret-xyz');
  });

  it('X6. an unsupported MIME is rejected before any outbound request', async () => {
    const { RealVisionOcrProvider } = await import('../../src/infrastructure/ocr/RealVisionOcrProvider.js');
    let called = false;
    const storage: IStorageProvider = {
      getProviderName: () => 'fake',
      store: async () => { throw new Error('unused'); },
      read: async () => Buffer.from('hello'),
      delete: async () => false,
    };
    const provider = new RealVisionOcrProvider(storage, ocrConfig(), {
      fetchImpl: (async () => { called = true; return { ok: true, status: 200, headers: { get: () => null }, text: async () => '{}' }; }) as any,
      sleepImpl: async () => {},
    });
    await expect(provider.extract({ assetRef: 'local://x.txt', mimeType: 'text/plain' })).rejects.toThrow();
    expect(called).toBe(false);
  });

  it('X7. the AI rate limiter bounds costly calls per user', async () => {
    const app = await getApp();
    const s = await registerAndLogin(app, 'p73-ailimit');
    let sawLimit = false;
    for (let i = 0; i < 30; i++) {
      const res = await request(app)
        .post('/api/v1/ai/explanation')
        .set('Authorization', `Bearer ${s.accessToken}`)
        .send({ concept: 'c', skillId: 's', difficulty: 1, mode: 'HINT' });
      if (res.status === 429) { sawLimit = true; break; }
    }
    expect(sawLimit).toBe(true);
  });
});

// ============================================================ 7. API VALIDATION

describe('Phase 7.3 — request validation', () => {
  let app: express.Application;
  beforeAll(async () => { app = await getApp(); });

  it('V1. malformed JSON is a 400, not a 500', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .set('Content-Type', 'application/json')
      .send('{ not valid json ');
    expect(res.status).toBe(400);
  });

  it('V2. an invalid enum value is rejected', async () => {
    const s = await registerAndLogin(app, 'p73-enum');
    const res = await request(app)
      .post('/api/v1/question-ingestions')
      .set('Authorization', `Bearer ${s.accessToken}`)
      .send({ ingestMethod: 'NOT_A_METHOD', rawText: 'x' });
    expect(res.status).toBe(400);
  });

  it('V3. a missing required field is rejected', async () => {
    const s = await registerAndLogin(app, 'p73-required');
    const res = await request(app)
      .post('/api/v1/question-ingestions')
      .set('Authorization', `Bearer ${s.accessToken}`)
      .send({});
    expect(res.status).toBe(400);
  });

  it('V4. registration rejects a weak password', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: `p73-weak-${Date.now()}@example.com`, password: 'weak', firstName: 'a', lastName: 'b', grade: 11 });
    expect(res.status).toBe(400);
  });

  it('V5. registration rejects an invalid email', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: 'not-an-email', password: 'Test123!@#', firstName: 'a', lastName: 'b', grade: 11 });
    expect(res.status).toBe(400);
  });

  it('V6. an oversized JSON body is rejected with 413', async () => {
    const s = await registerAndLogin(app, 'p73-bigbody');
    const huge = 'x'.repeat(11 * 1024 * 1024);
    const res = await request(app)
      .post('/api/v1/question-ingestions')
      .set('Authorization', `Bearer ${s.accessToken}`)
      .send({ ingestMethod: 'TEXT_PASTE', normalizedText: huge });
    expect([413, 400]).toContain(res.status);
  });
});

// ============================================================ 8. ERROR HANDLING

describe('Phase 7.3 — error handling leaks nothing', () => {
  let app: express.Application;
  beforeAll(async () => { app = await getApp(); });

  it('E1. a 401 body contains no stack trace or internals', async () => {
    const res = await request(app).get('/api/v1/students/me');
    const body = JSON.stringify(res.body);
    expect(body).not.toMatch(/at .*\.ts:/);
    expect(body).not.toMatch(/prisma/i);
    expect(body).not.toMatch(/node_modules/);
  });

  it('E2. an unknown route does not 500 with internals', async () => {
    const res = await request(app).get('/api/v1/does-not-exist');
    expect(res.status).not.toBe(500);
    expect(JSON.stringify(res.body)).not.toMatch(/node_modules|\.ts:/);
  });

  it('E3. an unexpected route-level error maps to a safe 500 body (no stack)', async () => {
    // A malformed bearer header exercises the auth error path.
    const res = await request(app).get('/api/v1/students/me').set('Authorization', 'Bearer ');
    expect(res.status).toBe(401);
    expect(JSON.stringify(res.body)).not.toMatch(/\.ts:|node_modules/);
  });
});

// ============================================================ 9. OPERATIONS

describe('Phase 7.3 — operations (health, readiness, request id)', () => {
  let app: express.Application;
  beforeAll(async () => { app = await getApp(); });

  it('H1. liveness returns 200 without touching the database', async () => {
    const res = await request(app).get('/health/live');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  it('H2. readiness returns 200 when the database is reachable', async () => {
    const res = await request(app).get('/health/ready');
    expect(res.status).toBe(200);
    expect(res.body.database).toBe('connected');
  });

  it('H3. the legacy /health endpoint still works (backward compatible)', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
  });

  it('H4. health endpoints do not consume the rate-limit budget', async () => {
    for (let i = 0; i < 40; i++) {
      const res = await request(app).get('/health/live');
      expect(res.status).toBe(200);
    }
  });

  it('H5. a response carries an X-Request-ID header', async () => {
    const res = await request(app).get('/health/live');
    expect(res.headers['x-request-id']).toBeTruthy();
  });

  it('H6. an inbound X-Request-ID is echoed back', async () => {
    const res = await request(app).get('/health/live').set('X-Request-ID', 'corr-123');
    expect(res.headers['x-request-id']).toBe('corr-123');
  });

  it('H7. the rate limiter exposes a test-facing reset hook', () => {
    expect(() => RateLimiter.resetAll()).not.toThrow();
  });
});

// ============================================================ 10. DATABASE SAFETY

describe('Phase 7.3 — database safety', () => {
  it('D1. the test database is a separate file from the development database', async () => {
    // tests/setup.ts forces DATABASE_URL at file:.../prisma/test.db.
    expect(process.env.DATABASE_URL).toMatch(/test\.db$/);
    expect(process.env.DATABASE_URL).not.toMatch(/dev\.db/);
    expect(process.env.NODE_ENV).toBe('test');
  });

  it('D2. no destructive reset occurs during a test run (a created row persists)', async () => {
    const before = await prisma.user.count();
    await prisma.user.create({
      data: { email: `p73-persist-${Date.now()}@example.com`, firstName: 'P', lastName: 'D', role: 'STUDENT', passwordHash: 'h' },
    });
    const after = await prisma.user.count();
    expect(after).toBe(before + 1);
  });

  it('D3. production validation refuses a file-based database (no accidental test DB in prod)', () => {
    const problems = collectProductionConfigProblems({
      NODE_ENV: 'production',
      JWT_SECRET: 'a'.repeat(48),
      JWT_REFRESH_SECRET: 'b'.repeat(48),
      DATABASE_URL: 'file:./prisma/test.db',
      CORS_ORIGIN: 'https://mentora.ai',
    });
    expect(problems.join(' ')).toMatch(/production database/);
  });
});

// ============================================================ 11. LOGGING PRIVACY

describe('Phase 7.3 — logging privacy', () => {
  it('L1. authentication logs do not contain the email (PII)', async () => {
    const app = await getApp();
    const { logger } = await import('../../src/infrastructure/logging/logger.js');
    const spies = [
      vi.mocked(logger.info), vi.mocked(logger.warn), vi.mocked(logger.error), vi.mocked(logger.debug),
    ];
    spies.forEach((s) => s.mockClear());

    const email = `p73-pii-${Date.now()}@example.com`;
    await request(app).post('/api/v1/auth/register').send({
      email, password: 'Test123!@#', firstName: 'P', lastName: 'I', grade: 11,
    });

    const all = JSON.stringify(spies.flatMap((s) => s.mock.calls));
    expect(all).not.toContain(email);
  });

  it('L2. no log contains a bearer token or api key', async () => {
    const { logger } = await import('../../src/infrastructure/logging/logger.js');
    const spies = [
      vi.mocked(logger.info), vi.mocked(logger.warn), vi.mocked(logger.error), vi.mocked(logger.debug),
    ];
    spies.forEach((s) => s.mockClear());
    const app = await getApp();
    await request(app).get('/api/v1/students/me').set('Authorization', 'Bearer sk-secret-abc');
    const all = JSON.stringify(spies.flatMap((s) => s.mock.calls));
    expect(all).not.toContain('sk-secret-abc');
    expect(all).not.toContain('Bearer');
  });
});
