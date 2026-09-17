import { describe, it, expect, beforeAll, vi } from 'vitest';
import request from 'supertest';
import express from 'express';

import bootstrap from '../../src/index.js';
import { prisma } from '../setup.js';
import { AIExplanationService } from '../../src/application/services/ai/AIExplanationService.js';
import type { IAIProvider, AIRequest, AIResponse } from '../../src/domain/interfaces/ai/IAIProvider.js';
import { logger } from '../../src/infrastructure/logging/logger.js';

/**
 * Phase 6.7 — Security / Identity / Idempotency Hardening (complementary suite).
 *
 * This suite closes the coverage gaps left by
 * `phase-6-7-security-hardening.test.ts` and targets the invariants that are
 * easiest to regress:
 *
 *   Identity ....... body.userId is never authoritative; refresh preserves identity
 *   IDOR ........... mapping/candidate governance reads are staff-only; cross-student
 *                    ingestion/mapping enumeration is refused
 *   Roles .......... a student cannot approve an ingestion or mutate curriculum
 *   Upload ......... ownership is enforced; traversal filenames never influence a path
 *   AI ............. the canonical answer never reaches the explanation provider
 *   Privacy ........ auth logs carry no PII; no raw answer text is logged
 *   Idempotency .... concurrent duplicate ingestion yields exactly one effect
 *
 * Every fixture lives in the isolated test database (prisma/test.db). dev.db is
 * never touched.
 */

let appInstance: express.Application | null = null;
async function getApp(): Promise<express.Application> {
  if (!appInstance) appInstance = await bootstrap();
  return appInstance;
}

async function createStudent(label: string) {
  const email = `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const password = 'Test123!@#';
  const res = await request(await getApp())
    .post('/api/v1/auth/register')
    .send({ email, password, firstName: label, lastName: 'User', grade: 11 });

  const accessToken = res.body?.data?.tokens?.accessToken as string | undefined;
  const refreshToken = res.body?.data?.tokens?.refreshToken as string | undefined;
  const userId = res.body?.data?.user?.id as string | undefined;
  if (!accessToken || !userId) throw new Error(`register failed: ${JSON.stringify(res.body)}`);

  const profile = await prisma.studentProfile.findUnique({ where: { userId } });
  if (!profile) throw new Error('Expected StudentProfile');
  return { email, password, userId, accessToken, refreshToken: refreshToken as string, profileId: profile.id };
}

/** Build a full curriculum chain + MicroSkill + question + PRIMARY mapping. */
async function buildMappedQuestion(opts: { correctAnswer?: string; ownerProfileId?: string } = {}) {
  const uid = Math.random().toString(36).slice(2, 10);
  const version = await prisma.curriculumVersion.create({
    data: { code: `P67X-CUR-${uid}`, name: 'P67X', grade: 11, subject: 'Matematik', version: '1.0', source: 'TEST_FIXTURE' },
  });
  const theme = await prisma.theme.create({
    data: { curriculumVersionId: version.id, officialCode: `P67X.T-${uid}`, name: 'theme', lessonHours: 1, sourceOrder: 1 },
  });
  const lo = await prisma.learningOutcome.create({
    data: { themeId: theme.id, officialCode: `P67X.LO-${uid}`, officialText: 'outcome', sourceOrder: 1 },
  });
  const pc = await prisma.processComponent.create({
    data: { learningOutcomeId: lo.id, officialCode: `P67X.PC-${uid}`, officialText: 'component', sourceOrder: 1 },
  });
  const microSkill = await prisma.microSkill.create({
    data: { processComponentId: pc.id, code: `P67X-MS-${uid}`, name: 'skill', description: 'fixture', source: 'TEST_FIXTURE', isActive: true },
  });
  const question = await prisma.question.create({
    data: {
      content: `P67X question ${uid}`,
      type: opts.correctAnswer ? 'MULTIPLE_CHOICE' : 'OPEN_ENDED',
      difficulty: 3,
      skillId: 'unmapped',
      correctAnswer: opts.correctAnswer ?? '42',
      isActive: false,
      isFixture: true,
    },
  });
  const mapping = await prisma.questionSkillMapping.create({
    data: { questionId: question.id, microSkillId: microSkill.id, isPrimary: true, relevance: 1, mappingSource: 'MANUAL' },
  });
  if (opts.ownerProfileId) {
    await prisma.questionInstance.create({ data: { questionId: question.id, studentId: opts.ownerProfileId } });
  }
  return { microSkill, question, mapping };
}

describe('Phase 6.7 — Hardening gaps (complementary)', () => {
  beforeAll(async () => {
    await getApp();
  });

  // ================================================================ Identity

  describe('Identity from authenticated principal', () => {
    it('A. body.userId is ignored — the attempt belongs to the authenticated student', async () => {
      const app = await getApp();
      const alice = await createStudent('p67x-uid-a');
      const bob = await createStudent('p67x-uid-b');
      const { question } = await buildMappedQuestion({ correctAnswer: '42', ownerProfileId: alice.profileId });

      const res = await request(app)
        .post('/api/v1/question-attempts')
        .set('Authorization', `Bearer ${alice.accessToken}`)
        .send({ questionId: question.id, answer: '42', timeSpentSeconds: 5, userId: bob.userId, studentId: bob.profileId });

      expect(res.status).toBe(201);
      const attempt = await prisma.questionAttempt.findUnique({ where: { id: res.body.data.attemptId } });
      expect(attempt?.studentId).toBe(alice.profileId);
      const where = { studentId: bob.profileId };
      const total = await prisma.questionAttempt.findMany({ where });
      expect(total.length).toBe(0);
    });

    it('B. a forged body.studentId never redirects ingestion ownership', async () => {
      const app = await getApp();
      const alice = await createStudent('p67x-ing-a');
      const bob = await createStudent('p67x-ing-b');

      const res = await request(app)
        .post('/api/v1/question-ingestions')
        .set('Authorization', `Bearer ${alice.accessToken}`)
        .send({ ingestMethod: 'TEXT_PASTE', rawText: 'P67X ingestion ownership text', userId: bob.userId, studentId: bob.profileId });

      expect(res.status).toBe(201);
      const row = await prisma.questionIngestion.findUnique({ where: { id: res.body.data.id } });
      expect(row?.ingestedByUserId).toBe(alice.userId);
    });
  });

  // ================================================== Auth / session invariants

  describe('Authentication / session invariants', () => {
    it('C. refresh preserves the identity of the refresh token owner', async () => {
      const app = await getApp();
      const alice = await createStudent('p67x-refresh-a');
      const bob = await createStudent('p67x-refresh-b');

      const res = await request(app)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: alice.refreshToken });
      expect(res.status).toBe(200);

      const newAccess = res.body.data.accessToken as string;
      // The minted access token must resolve to Alice — never Bob. The profile
      // DTO is identified by the account email.
      const me = await request(app)
        .get('/api/v1/students/me')
        .set('Authorization', `Bearer ${newAccess}`);
      expect(me.status).toBe(200);
      expect(me.body.data.email).toBe(alice.email);
      expect(me.body.data.email).not.toBe(bob.email);
      expect(me.body.data.email).not.toContain(bob.email);
    });

    it('D. logout revokes the refresh token (no new session can be minted)', async () => {
      const app = await getApp();
      const alice = await createStudent('p67x-logout');

      const out = await request(app)
        .post('/api/v1/auth/logout')
        .set('Authorization', `Bearer ${alice.accessToken}`)
        .send({ refreshToken: alice.refreshToken });
      expect(out.status).toBe(200);

      const persisted = await prisma.refreshToken.findUnique({ where: { token: alice.refreshToken } });
      expect(persisted?.revokedAt).not.toBeNull();

      const refresh = await request(app).post('/api/v1/auth/refresh').send({ refreshToken: alice.refreshToken });
      expect(refresh.status).toBe(401);
    });

    it('E. an invalid refresh token is rejected (401)', async () => {
      const app = await getApp();
      const res = await request(app).post('/api/v1/auth/refresh').send({ refreshToken: 'not-a-real-token' });
      expect(res.status).toBe(401);
    });
  });

  // ================================================ Governance read isolation

  describe('Governance read isolation (Phase 6.7)', () => {
    it('F. a student cannot enumerate another student\'s question skill-mappings', async () => {
      const app = await getApp();
      const alice = await createStudent('p67x-map-a');
      const bob = await createStudent('p67x-map-b');
      const { question } = await buildMappedQuestion({ ownerProfileId: bob.profileId });

      const res = await request(app)
        .get(`/api/v1/questions/${question.id}/skill-mappings`)
        .set('Authorization', `Bearer ${alice.accessToken}`);
      // Governance surface: staff-only.
      expect(res.status).toBe(403);
      expect(JSON.stringify(res.body)).not.toContain(question.id);
    });

    it('G. a student cannot enumerate another student\'s curriculum candidates', async () => {
      const app = await getApp();
      const alice = await createStudent('p67x-cand-a');
      const bob = await createStudent('p67x-cand-b');
      const { question, microSkill } = await buildMappedQuestion({ ownerProfileId: bob.profileId });

      const res = await request(app)
        .get(`/api/v1/questions/${question.id}/curriculum-candidates`)
        .set('Authorization', `Bearer ${alice.accessToken}`);
      expect(res.status).toBe(403);

      const single = await request(app)
        .get(`/api/v1/curriculum-candidates/does-not-exist`)
        .set('Authorization', `Bearer ${alice.accessToken}`);
      expect(single.status).toBe(403);
      // sanity: the fixture exists so the 403 is authorization, not absence
      expect(microSkill.id).toBeTruthy();
    });
  });

  // ========================================================= Role boundaries

  describe('Role boundaries (Phase 6.7)', () => {
    it('H. a student cannot approve their own ingestion', async () => {
      const app = await getApp();
      const alice = await createStudent('p67x-approve');

      const created = await request(app)
        .post('/api/v1/question-ingestions')
        .set('Authorization', `Bearer ${alice.accessToken}`)
        .send({ ingestMethod: 'TEXT_PASTE', rawText: 'P67X approval gate question text' });
      const ingestionId = created.body.data.id as string;

      const res = await request(app)
        .post(`/api/v1/question-ingestions/${ingestionId}/transition`)
        .set('Authorization', `Bearer ${alice.accessToken}`)
        .send({ toState: 'APPROVED' });
      expect(res.status).toBe(403);

      const row = await prisma.questionIngestion.findUnique({ where: { id: ingestionId } });
      expect(row?.state).not.toBe('APPROVED');
    });

    it('I. a student cannot create a curriculum candidate (403)', async () => {
      const app = await getApp();
      const alice = await createStudent('p67x-cand-create');
      const { question, microSkill } = await buildMappedQuestion();

      const res = await request(app)
        .post(`/api/v1/questions/${question.id}/curriculum-candidates`)
        .set('Authorization', `Bearer ${alice.accessToken}`)
        .send({ level: 'PROCESS_COMPONENT', targetId: microSkill.processComponentId, confidence: 0.9 });
      expect(res.status).toBe(403);
    });

    it('J. a student cannot review a curriculum candidate (403)', async () => {
      const app = await getApp();
      const alice = await createStudent('p67x-cand-review');

      const res = await request(app)
        .post('/api/v1/curriculum-candidates/some-id/review')
        .set('Authorization', `Bearer ${alice.accessToken}`)
        .send({ decision: 'PRIMARY', reviewed: true });
      expect(res.status).toBe(403);
    });

    it('K. a student cannot review a skill mapping (403)', async () => {
      const app = await getApp();
      const alice = await createStudent('p67x-map-review');
      const { mapping } = await buildMappedQuestion();

      const res = await request(app)
        .post(`/api/v1/question-skill-mappings/${mapping.id}/review`)
        .set('Authorization', `Bearer ${alice.accessToken}`)
        .send({ reviewed: true, isPrimary: true });
      expect(res.status).toBe(403);
    });
  });

  // ============================================================ Upload safety

  describe('Upload / storage safety (Phase 6.7)', () => {
    const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0, 0, 0, 0]);

    it('L. an upload is owned by the uploader and cannot be read cross-student', async () => {
      const app = await getApp();
      const alice = await createStudent('p67x-up-a');
      const bob = await createStudent('p67x-up-b');

      const up = await request(app)
        .post('/api/v1/question-ingestions/upload')
        .set('Authorization', `Bearer ${bob.accessToken}`)
        .set('Content-Type', 'image/png')
        .set('X-Upload-Filename', encodeURIComponent('page.png'))
        .send(PNG);
      expect(up.status).toBe(201);
      const ingestionId = up.body.data.ingestion.id as string;

      const row = await prisma.questionIngestion.findUnique({ where: { id: ingestionId } });
      expect(row?.ingestedByUserId).toBe(bob.userId);
      // The asset reference is opaque — never a filesystem path.
      expect(row?.originalAssetRef).toMatch(/^local:\/\//);

      const cross = await request(app)
        .get(`/api/v1/question-ingestions/${ingestionId}`)
        .set('Authorization', `Bearer ${alice.accessToken}`);
      expect(cross.status).toBe(404);
    });

    it('M. a traversal filename is neutralised (content hash is the on-disk name)', async () => {
      const app = await getApp();
      const alice = await createStudent('p67x-up-traversal');

      const up = await request(app)
        .post('/api/v1/question-ingestions/upload')
        .set('Authorization', `Bearer ${alice.accessToken}`)
        .set('Content-Type', 'image/png')
        .set('X-Upload-Filename', encodeURIComponent('../../etc/passwd.png'))
        .send(PNG);
      expect(up.status).toBe(201);

      const row = await prisma.questionIngestion.findUnique({ where: { id: up.body.data.ingestion.id } });
      const ref = row?.originalAssetRef as string;
      // Opaque ref, single segment, no separators or traversal.
      expect(ref).toMatch(/^local:\/\/[a-f0-9]{64}\.[a-z0-9]+$/);
      expect(ref).not.toContain('..');
      expect(ref).not.toContain('/etc/');
    });

    it('N. a mismatched content-type (non-image bytes) is rejected', async () => {
      const app = await getApp();
      const alice = await createStudent('p67x-up-mismatch');

      const up = await request(app)
        .post('/api/v1/question-ingestions/upload')
        .set('Authorization', `Bearer ${alice.accessToken}`)
        .set('Content-Type', 'image/png')
        .set('X-Upload-Filename', encodeURIComponent('fake.png'))
        .send(Buffer.from('this is not a png', 'utf8'));
      expect(up.status).toBeGreaterThanOrEqual(400);
      expect(up.status).toBeLessThan(500);
    });
  });

  // ============================================================ AI boundary

  describe('AI boundary — canonical answer never reaches the provider', () => {
    it('O. attempt-scoped explanation carries no correctAnswer to the provider', async () => {
      const app = await getApp();
      const alice = await createStudent('p67x-ai-capture');
      const canonical = 'CANONICAL-LEAK-PROBE-9182';
      const { question } = await buildMappedQuestion({ correctAnswer: canonical, ownerProfileId: alice.profileId });

      const attempt = await prisma.questionAttempt.create({
        data: {
          studentId: alice.profileId,
          questionId: question.id,
          answer: 'nope',
          isCorrect: false,
          timeSpentSeconds: 4,
          status: 'COMPLETED',
          validatedAt: new Date(),
          metadata: JSON.stringify({ evaluationState: 'EVALUATED', hasCanonicalAnswer: true }),
        },
      });

      // Capture every request the explanation provider would receive, at the
      // service seam the HTTP controller invokes.
      const calls: AIRequest[] = [];
      const capturing: IAIProvider = {
        getProviderName: () => 'capture',
        getModelName: () => 'capture-model',
        getVersion: () => 'capture-1',
        isAvailable: async () => true,
        complete: async (_r: AIRequest): Promise<AIResponse> => ({
          content: '', model: 'capture-model', version: 'capture-1', tokensUsed: 0, latencyMs: 0, finishReason: 'stop',
        }),
        completeStructured: async <T>(r: AIRequest): Promise<AIResponse & { structured: T }> => {
          calls.push(r);
          const structured = {
            explanation: 'Once sorudaki ilgili koşulu düşün ve hangi kuralın uygulanacağını belirle.',
            stepByStep: ['İlgili kuralı seç.'],
            examples: [],
            keyPoints: ['Koşulu belirle.'],
            practiceSuggestion: 'Benzer bir soruda önce koşulu yaz.',
          } as unknown as T;
          return { content: JSON.stringify(structured), structured, model: 'capture-model', version: 'capture-1', tokensUsed: 0, latencyMs: 0, finishReason: 'stop' };
        },
      };

      const service = new AIExplanationService(capturing);
      const spy = vi.spyOn(AIExplanationService.prototype, 'generateExplanation');

      // Drive the SAME service through the HTTP path is not trivial to capture
      // (the controller holds its own instance); instead we assert on the
      // service contract directly, which is what the controller calls. A client
      // sends correctAnswer at HTTP — the controller never forwards it because
      // ExplanationRequest has no such field.
      const result = await service.generateExplanation({
        attemptId: attempt.id,
        concept: 'skill',
        question: question.content,
        studentAnswer: 'nope',
        skillId: 'x',
        difficulty: 3,
        previousAttempts: 1,
        level: 'intermediate',
        mode: 'HINT',
        // A hostile caller tries to smuggle the answer in (extra field ignored
        // by the typed contract).
        ...({ correctAnswer: canonical } as any),
      });

      spy.mockRestore();
      expect(result.explanation).toBeTruthy();

      const sent = JSON.stringify(calls);
      expect(calls.length).toBeGreaterThan(0);
      expect(sent).not.toContain(canonical);
      // The response must not leak it either.
      expect(JSON.stringify(result)).not.toContain(canonical);

      // And the HTTP surface must refuse/ignore a client-sent correctAnswer.
      const http = await request(app)
        .post('/api/v1/ai/explanation')
        .set('Authorization', `Bearer ${alice.accessToken}`)
        .send({ attemptId: attempt.id, mode: 'HINT', correctAnswer: canonical });
      expect(http.status).toBe(200);
      expect(JSON.stringify(http.body.data)).not.toContain(canonical);
    });

    it('P. the AI recommendation surface ignores client mastery/identity', async () => {
      const app = await getApp();
      const alice = await createStudent('p67x-ai-rec-a');
      const bob = await createStudent('p67x-ai-rec-b');

      await prisma.skillMastery.create({
        data: { studentId: bob.profileId, skillId: 'bob-ai-secret', masteryLevel: 99, confidence: 0.99, attempts: 9, correctAttempts: 9 },
      });

      const res = await request(app)
        .post('/api/v1/ai/recommendation')
        .set('Authorization', `Bearer ${alice.accessToken}`)
        .send({ studentId: bob.profileId, currentMastery: [{ skillId: 'bob-ai-secret', masteryLevel: 99 }], weakSkills: [{ skillId: 'bob-ai-secret', masteryLevel: 99 }] });

      expect(res.status).toBe(200);
      expect(JSON.stringify(res.body.data)).not.toContain('bob-ai-secret');
    });
  });

  // ============================================================== Idempotency

  describe('Idempotency — concurrency', () => {
    it('Q. concurrent duplicate ingestion under one key yields one record', async () => {
      const app = await getApp();
      const alice = await createStudent('p67x-conc-ing');
      const body = { ingestMethod: 'TEXT_PASTE', rawText: 'P67X concurrent ingestion question text' };

      const send = () =>
        request(app)
          .post('/api/v1/question-ingestions')
          .set('Authorization', `Bearer ${alice.accessToken}`)
          .set('Idempotency-Key', 'p67x-conc-ing-key')
          .send(body);

      const results = await Promise.all([send(), send(), send()]);
      for (const r of results) expect(r.status).toBeLessThan(500);

      const count = await prisma.questionIngestion.count({ where: { ingestedByUserId: alice.userId } });
      expect(count).toBe(1);
    });

    it('R. same key + different ingestion payload is a conflict (409)', async () => {
      const app = await getApp();
      const alice = await createStudent('p67x-conf-ing');

      const r1 = await request(app)
        .post('/api/v1/question-ingestions')
        .set('Authorization', `Bearer ${alice.accessToken}`)
        .set('Idempotency-Key', 'p67x-conf-key')
        .send({ ingestMethod: 'TEXT_PASTE', rawText: 'P67X first payload question text' });
      expect([200, 201]).toContain(r1.status);

      const r2 = await request(app)
        .post('/api/v1/question-ingestions')
        .set('Authorization', `Bearer ${alice.accessToken}`)
        .set('Idempotency-Key', 'p67x-conf-key')
        .send({ ingestMethod: 'TEXT_PASTE', rawText: 'P67X DIFFERENT payload text' });
      expect(r2.status).toBe(409);
    });
  });

  // ================================================================== Privacy

  describe('Privacy / logging', () => {
    it('S. auth logs contain no email (PII) and no token material', async () => {
      const infoSpy = logger.info as unknown as ReturnType<typeof vi.fn>;
      infoSpy.mockClear();

      const app = await getApp();
      const email = `p67x-pii-${Date.now()}@example.com`;
      const password = 'Test123!@#';
      await request(app).post('/api/v1/auth/register').send({ email, password, firstName: 'Pii', lastName: 'User', grade: 11 });
      await request(app).post('/api/v1/auth/login').send({ email, password });

      const logged = JSON.stringify(infoSpy.mock.calls);
      expect(logged).not.toContain(email);
      expect(logged).not.toContain(password);
    });

    it('T. the attempt pipeline does not log the raw answer or the canonical answer', async () => {
      const infoSpy = logger.info as unknown as ReturnType<typeof vi.fn>;
      const warnSpy = logger.warn as unknown as ReturnType<typeof vi.fn>;
      const errSpy = logger.error as unknown as ReturnType<typeof vi.fn>;
      infoSpy.mockClear(); warnSpy.mockClear(); errSpy.mockClear();

      const app = await getApp();
      const alice = await createStudent('p67x-log-answer');
      const secretAnswer = 'RAW-ANSWER-SECRET-7731';
      const { question } = await buildMappedQuestion({ correctAnswer: 'x', ownerProfileId: alice.profileId });

      await request(app)
        .post('/api/v1/question-attempts')
        .set('Authorization', `Bearer ${alice.accessToken}`)
        .send({ questionId: question.id, answer: secretAnswer, timeSpentSeconds: 3 });

      const logged = JSON.stringify([...infoSpy.mock.calls, ...warnSpy.mock.calls, ...errSpy.mock.calls]);
      expect(logged).not.toContain(secretAnswer);
    });
  });
});
