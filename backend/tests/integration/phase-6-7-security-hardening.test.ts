import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import express from 'express';

import jwt from 'jsonwebtoken';

import bootstrap from '../../src/index.js';
import { prisma } from '../setup.js';
import { TokenService } from '../../src/domain/services/TokenService.js';
import { getEnv } from '../../src/infrastructure/config/environment.js';

/**
 * Phase 6.7 — Security / Identity / Authorization / Idempotency Hardening
 *
 * This suite is the acceptance gate for the Phase 6.7 hardening pass. It proves,
 * against the REAL Express app (not the services in isolation), that:
 *
 *   Authentication ..... unauthenticated / invalid / expired / revoked / deleted
 *   Identity ........... JWT → User → StudentProfile is authoritative
 *   IDOR ............... cross-student access is refused (401/403/404)
 *   Attempt ............ forged isCorrect / skill / instance ownership refused
 *   Mastery ............ client cannot set mastery; duplicates do not double-apply
 *   ErrorAnalysis ...... client cannot select ErrorPattern / MicroSkill taxonomy
 *   Recommendation ..... identity cannot be overridden; cross-student isolated
 *   Analytics .......... /me is strictly the authenticated student
 *   AI ................. correctAnswer never reaches providers; auth required
 *   Idempotency ........ same key/same payload replay; same key/diff payload 409
 *   Roles .............. student blocked from staff-only surfaces
 *
 * All fixtures are created in the isolated `test.db` (see tests/setup.ts); the
 * development database is never touched.
 */

const tokenService = new TokenService();

async function createStudent(label: string) {
  const email = `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const password = 'Test123!@#';

  const res = await request(await getApp())
    .post('/api/v1/auth/register')
    .send({ email, password, firstName: label, lastName: 'User', grade: 11 });

  const accessToken = res.body?.data?.tokens?.accessToken as string | undefined;
  const refreshToken = res.body?.data?.tokens?.refreshToken as string | undefined;
  const userId = res.body?.data?.user?.id as string | undefined;

  if (!accessToken || !userId) {
    throw new Error(`Failed to register student ${label}: ${JSON.stringify(res.body)}`);
  }

  const profile = await prisma.studentProfile.findUnique({ where: { userId } });
  if (!profile) {
    throw new Error('Expected a StudentProfile to exist for a registered student');
  }

  return { email, password, userId, accessToken: accessToken as string, refreshToken: refreshToken as string, profileId: profile.id };
}

/** A STUDENT token minted directly (used to simulate deleted/expired users). */
function tokenFor(userId: string, email: string, role = 'STUDENT') {
  return tokenService.generateAccessToken({ userId, email, role });
}

let appInstance: express.Application | null = null;
async function getApp(): Promise<express.Application> {
  if (!appInstance) {
    appInstance = await bootstrap();
  }
  return appInstance;
}

/** Build the full curriculum ancestry + MicroSkill + question + PRIMARY mapping. */
async function buildMappedQuestion(opts: { correctAnswer?: string; type?: string } = {}) {
  const uid = Math.random().toString(36).slice(2, 10);
  const version = await prisma.curriculumVersion.create({
    data: { code: `P67-CUR-${uid}`, name: 'P67', grade: 11, subject: 'Matematik', version: '1.0', source: 'TEST_FIXTURE' },
  });
  const theme = await prisma.theme.create({
    data: { curriculumVersionId: version.id, officialCode: `P67.T-${uid}`, name: 'theme', lessonHours: 1, sourceOrder: 1 },
  });
  const lo = await prisma.learningOutcome.create({
    data: { themeId: theme.id, officialCode: `P67.LO-${uid}`, officialText: 'outcome', sourceOrder: 1 },
  });
  const pc = await prisma.processComponent.create({
    data: { learningOutcomeId: lo.id, officialCode: `P67.PC-${uid}`, officialText: 'component', sourceOrder: 1 },
  });
  const microSkill = await prisma.microSkill.create({
    data: { processComponentId: pc.id, code: `P67-MS-${uid}`, name: 'skill', description: 'fixture', source: 'TEST_FIXTURE', isActive: true },
  });
  const question = await prisma.question.create({
    data: {
      content: `P67 question ${uid}`,
      type: opts.type ?? 'OPEN_ENDED',
      difficulty: 3,
      skillId: 'unmapped',
      correctAnswer: opts.correctAnswer ?? '42',
      isActive: false,
      isFixture: true,
    },
  });
  await prisma.questionSkillMapping.create({
    data: { questionId: question.id, microSkillId: microSkill.id, isPrimary: true, relevance: 1, mappingSource: 'MANUAL' },
  });
  return { microSkill, question };
}

describe('Phase 6.7 — Security / Identity / Idempotency Hardening', () => {
  beforeAll(async () => {
    await getApp();
  });

  afterAll(async () => {
    // Global setup handles disconnect.
  });

  // ============================================================ Authentication

  describe('Authentication', () => {
    it('1. unauthenticated request to a student endpoint is rejected (401)', async () => {
      const app = await getApp();
      const res = await request(app).get('/api/v1/question-attempts');
      expect(res.status).toBe(401);
    });

    it('2. invalid token is rejected (401)', async () => {
      const app = await getApp();
      const res = await request(app)
        .get('/api/v1/analytics/me/skills')
        .set('Authorization', 'Bearer not-a-real-token');
      expect(res.status).toBe(401);
    });

    it('3. expired access token is rejected (401)', async () => {
      const app = await getApp();
      const { userId, email } = await createStudent('p67-expired');
      // Sign a token that expired an hour ago, using the same secret the service
      // verifies with, so the failure is specifically an expiry failure.
      const expired = jwt.sign(
        { userId, email, role: 'STUDENT' },
        getEnv().JWT_SECRET,
        { expiresIn: '-1h' }
      );
      const res = await request(app)
        .get('/api/v1/question-attempts')
        .set('Authorization', `Bearer ${expired}`);
      expect(res.status).toBe(401);
    });

    it('4. token for a non-existent user is rejected (401)', async () => {
      const app = await getApp();
      const ghost = tokenFor('no-such-user-id', 'ghost@example.com');
      const res = await request(app)
        .get('/api/v1/question-attempts')
        .set('Authorization', `Bearer ${ghost}`);
      expect(res.status).toBe(401);
    });

    it('5. soft-deleted user cannot authenticate (401)', async () => {
      const app = await getApp();
      const { userId, email, accessToken } = await createStudent('p67-deleted');

      await prisma.user.update({ where: { id: userId }, data: { deletedAt: new Date() } });

      const res = await request(app)
        .get('/api/v1/question-attempts')
        .set('Authorization', `Bearer ${accessToken}`);
      expect(res.status).toBe(401);

      // sanity: a freshly minted token is likewise refused because the user row
      // is soft-deleted (the check is on the persisted user, not the token).
      const fresh = tokenFor(userId, email);
      const res2 = await request(app)
        .get('/api/v1/question-attempts')
        .set('Authorization', `Bearer ${fresh}`);
      expect(res2.status).toBe(401);
    });

    it('6. logout invalidates refresh-token capability', async () => {
      const app = await getApp();
      const { accessToken, refreshToken } = await createStudent('p67-logout');

      const out = await request(app)
        .post('/api/v1/auth/logout')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ refreshToken });
      expect(out.status).toBe(200);

      const refresh = await request(app)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken });
      expect(refresh.status).toBe(401);
    });
  });

  // ==================================================================== Identity

  describe('Identity', () => {
    it('7. student sees their own data (analytics/me)', async () => {
      const app = await getApp();
      const alice = await createStudent('p67-id-a');
      const res = await request(app)
        .get('/api/v1/analytics/me/skills')
        .set('Authorization', `Bearer ${alice.accessToken}`);
      expect(res.status).toBe(200);
    });

    it('8. client-supplied studentId (query) cannot redirect analytics/me', async () => {
      const app = await getApp();
      const alice = await createStudent('p67-me-a');
      const bob = await createStudent('p67-me-b');

      await prisma.skillMastery.create({
        data: { studentId: bob.profileId, skillId: 'bob-skill', masteryLevel: 90, confidence: 0.9, attempts: 5, correctAttempts: 5 },
      });

      const res = await request(app)
        .get(`/api/v1/analytics/me/skills?studentId=${bob.profileId}`)
        .set('Authorization', `Bearer ${alice.accessToken}`);

      expect(res.status).toBe(200);
      // Alice has no mastery: any record would be Bob's data leaking in.
      const body = JSON.stringify(res.body.data);
      expect(body).not.toContain('bob-skill');
    });

    it('9. client studentId in the attempt body is ignored', async () => {
      const app = await getApp();
      const alice = await createStudent('p67-att-a');
      const bob = await createStudent('p67-att-b');
      const { question } = await buildMappedQuestion();

      await prisma.questionInstance.create({ data: { questionId: question.id, studentId: alice.profileId } });

      const res = await request(app)
        .post('/api/v1/question-attempts')
        .set('Authorization', `Bearer ${alice.accessToken}`)
        .send({ questionId: question.id, answer: '42', timeSpentSeconds: 5, studentId: bob.profileId });

      expect(res.status).toBe(201);

      // The attempt belongs to Alice (the authenticated principal), not Bob.
      const attempt = await prisma.questionAttempt.findUnique({ where: { id: res.body.data.attemptId } });
      expect(attempt?.studentId).toBe(alice.profileId);
      const bobAttempts = await prisma.questionAttempt.count({ where: { studentId: bob.profileId } });
      expect(bobAttempts).toBe(0);
    });

    it('10. cross-student attempt retrieval is refused (403)', async () => {
      const app = await getApp();
      const alice = await createStudent('p67-x-a');
      const bob = await createStudent('p67-x-b');
      const { question } = await buildMappedQuestion();
      const instance = await prisma.questionInstance.create({ data: { questionId: question.id, studentId: alice.profileId } });
      const attempt = await prisma.questionAttempt.create({
        data: { studentId: alice.profileId, questionId: question.id, instanceId: instance.id, answer: '42', isCorrect: true, timeSpentSeconds: 5, status: 'COMPLETED', validatedAt: new Date() },
      });

      const res = await request(app)
        .get(`/api/v1/question-attempts/${attempt.id}`)
        .set('Authorization', `Bearer ${bob.accessToken}`);
      expect([403, 404]).toContain(res.status);
    });
  });

  // ===================================================================== Attempt

  describe('Attempt security', () => {
    it('11. client-supplied isCorrect is ignored (backend derives correctness)', async () => {
      const app = await getApp();
      const alice = await createStudent('p67-corr-a');
      const { question } = await buildMappedQuestion({ correctAnswer: '42' });
      await prisma.questionInstance.create({ data: { questionId: question.id, studentId: alice.profileId } });

      const res = await request(app)
        .post('/api/v1/question-attempts')
        .set('Authorization', `Bearer ${alice.accessToken}`)
        .send({ questionId: question.id, answer: '41', timeSpentSeconds: 5, isCorrect: true });

      expect(res.status).toBe(201);
      // '41' !== '42' → backend-derived correctness is false despite the forgery.
      expect(res.body.data.isCorrect).toBe(false);
      const attempt = await prisma.questionAttempt.findUnique({ where: { id: res.body.data.attemptId } });
      expect(attempt?.isCorrect).toBe(false);
    });

    it('12. client-supplied microSkillId / mastery cannot influence the attempt', async () => {
      const app = await getApp();
      const alice = await createStudent('p67-ms-a');
      const { question } = await buildMappedQuestion();
      await prisma.questionInstance.create({ data: { questionId: question.id, studentId: alice.profileId } });

      const res = await request(app)
        .post('/api/v1/question-attempts')
        .set('Authorization', `Bearer ${alice.accessToken}`)
        .send({ questionId: question.id, answer: '42', timeSpentSeconds: 5, microSkillId: 'HACKED', mastery: 100 });

      // The forged fields are stripped by the validator and never persisted.
      expect(res.status).toBe(201);
      const attempt = await prisma.questionAttempt.findUnique({ where: { id: res.body.data.attemptId } });
      expect(JSON.stringify(attempt)).not.toContain('HACKED');
    });

    it('13. attaching an attempt to another student\'s QuestionInstance is blocked', async () => {
      const app = await getApp();
      const alice = await createStudent('p67-inst-a');
      const bob = await createStudent('p67-inst-b');
      const { question } = await buildMappedQuestion();

      // The instance belongs to Bob only.
      const bobInstance = await prisma.questionInstance.create({ data: { questionId: question.id, studentId: bob.profileId } });

      const res = await request(app)
        .post('/api/v1/question-attempts')
        .set('Authorization', `Bearer ${alice.accessToken}`)
        .send({ questionId: question.id, answer: '42', timeSpentSeconds: 5, instanceId: bobInstance.id });

      expect([403, 404]).toContain(res.status);
      const aliceAttempts = await prisma.questionAttempt.count({ where: { studentId: alice.profileId } });
      expect(aliceAttempts).toBe(0);
    });

    it('14. answering a question with no availability relation is refused', async () => {
      const app = await getApp();
      const alice = await createStudent('p67-unavail');
      const { question } = await buildMappedQuestion();
      // No QuestionInstance and no LearningSessionQuestion → not available.
      const res = await request(app)
        .post('/api/v1/question-attempts')
        .set('Authorization', `Bearer ${alice.accessToken}`)
        .send({ questionId: question.id, answer: '42', timeSpentSeconds: 5 });
      expect([403, 404]).toContain(res.status);
    });

    it('14a. a non-existent question is indistinguishable from an unavailable question', async () => {
      const app = await getApp();
      const alice = await createStudent('p67-missing-question');

      const res = await request(app)
        .post('/api/v1/question-attempts')
        .set('Authorization', `Bearer ${alice.accessToken}`)
        .send({ questionId: 'question-does-not-exist', answer: '42', timeSpentSeconds: 5 });

      expect(res.status).toBe(403);
      expect(res.body).toEqual({
        success: false,
        error: {
          code: 'AUTHORIZATION_ERROR',
          message: 'Question is not available to this student',
        },
      });
    });
  });

  // ===================================================================== Mastery

  describe('Mastery security', () => {
    it('15. client cannot set a mastery score (forged mastery is dropped)', async () => {
      const app = await getApp();
      const alice = await createStudent('p67-mastery-a');
      const { question } = await buildMappedQuestion({ correctAnswer: '42' });
      await prisma.questionInstance.create({ data: { questionId: question.id, studentId: alice.profileId } });

      const res = await request(app)
        .post('/api/v1/question-attempts')
        .set('Authorization', `Bearer ${alice.accessToken}`)
        .send({ questionId: question.id, answer: '42', timeSpentSeconds: 5, mastery: 100, masteryLevel: 100 });

      expect(res.status).toBe(201);
      const mastery = await prisma.skillMastery.findFirst({ where: { studentId: alice.profileId } });
      // Whatever value exists is backend-calculated, never the forged 100 unless
      // the deterministic formula genuinely produced a clamp of 100.
      if (mastery) {
        expect(mastery.masteryLevel).toBeLessThanOrEqual(100);
        expect(mastery.masteryLevel).not.toBe(100);
      }
    });

    it('16. duplicate attempt submission does not double-apply mastery', async () => {
      const app = await getApp();
      const alice = await createStudent('p67-dup-mastery');
      const { question } = await buildMappedQuestion({ correctAnswer: '42' });
      await prisma.questionInstance.create({ data: { questionId: question.id, studentId: alice.profileId } });

      const body = { questionId: question.id, answer: '42', timeSpentSeconds: 5 };

      const r1 = await request(app)
        .post('/api/v1/question-attempts')
        .set('Authorization', `Bearer ${alice.accessToken}`)
        .set('Idempotency-Key', 'p67-dup-key')
        .send(body);
      expect(r1.status).toBe(201);

      const r2 = await request(app)
        .post('/api/v1/question-attempts')
        .set('Authorization', `Bearer ${alice.accessToken}`)
        .set('Idempotency-Key', 'p67-dup-key')
        .send(body);
      expect([200, 201]).toContain(r2.status);

      const attempts = await prisma.questionAttempt.count({ where: { studentId: alice.profileId } });
      expect(attempts).toBe(1);

      const audits = await prisma.masteryAudit.count({ where: { studentId: alice.profileId, source: 'QUESTION_ATTEMPT' } });
      expect(audits).toBe(1);
    });

    it('17. concurrent identical submissions produce exactly one business effect', async () => {
      const app = await getApp();
      const alice = await createStudent('p67-conc-mastery');
      const { question } = await buildMappedQuestion({ correctAnswer: '42' });
      await prisma.questionInstance.create({ data: { questionId: question.id, studentId: alice.profileId } });

      const body = { questionId: question.id, answer: '42', timeSpentSeconds: 5 };
      const send = () =>
        request(app)
          .post('/api/v1/question-attempts')
          .set('Authorization', `Bearer ${alice.accessToken}`)
          .set('Idempotency-Key', 'p67-conc-key')
          .send(body);

      const results = await Promise.all([send(), send(), send()]);
      // None may 500; the first wins, the rest replay or conflict safely.
      for (const r of results) {
        expect(r.status).toBeLessThan(500);
      }

      const attempts = await prisma.questionAttempt.count({ where: { studentId: alice.profileId } });
      expect(attempts).toBe(1);
      const audits = await prisma.masteryAudit.count({ where: { studentId: alice.profileId } });
      expect(audits).toBe(1);
    });

    it('18. Student A cannot cause a mastery mutation for Student B', async () => {
      const app = await getApp();
      const alice = await createStudent('p67-cross-a');
      const bob = await createStudent('p67-cross-b');
      const { question } = await buildMappedQuestion({ correctAnswer: '42' });
      await prisma.questionInstance.create({ data: { questionId: question.id, studentId: alice.profileId } });

      await request(app)
        .post('/api/v1/question-attempts')
        .set('Authorization', `Bearer ${alice.accessToken}`)
        .send({ questionId: question.id, answer: '42', timeSpentSeconds: 5, studentId: bob.profileId });

      const bobMastery = await prisma.skillMastery.count({ where: { studentId: bob.profileId } });
      expect(bobMastery).toBe(0);
    });
  });

  // ============================================================= ErrorAnalysis

  describe('ErrorAnalysis security', () => {
    it('19. client cannot dictate ErrorPattern / error classification', async () => {
      const app = await getApp();
      const alice = await createStudent('p67-err-a');
      const { question } = await buildMappedQuestion({ correctAnswer: '42' });
      await prisma.questionInstance.create({ data: { questionId: question.id, studentId: alice.profileId } });

      const res = await request(app)
        .post('/api/v1/question-attempts')
        .set('Authorization', `Bearer ${alice.accessToken}`)
        .send({ questionId: question.id, answer: '41', timeSpentSeconds: 5, errorPatternId: 'forged-pattern', errorType: 'HACKED' });

      expect(res.status).toBe(201);
      const analysis = await prisma.errorAnalysis.findFirst({ where: { studentId: alice.profileId } });
      if (analysis) {
        expect(analysis.errorPatternId).not.toBe('forged-pattern');
        expect(analysis.errorType).not.toBe('HACKED');
      }
    });

    it('20. client cannot create taxonomy via a forged analysis request', async () => {
      const app = await getApp();
      const alice = await createStudent('p67-tax-a');
      const { question } = await buildMappedQuestion({ correctAnswer: '42' });
      await prisma.questionInstance.create({ data: { questionId: question.id, studentId: alice.profileId } });

      const before = await prisma.errorPattern.count();
      const microBefore = await prisma.microSkill.count();

      await request(app)
        .post('/api/v1/question-attempts')
        .set('Authorization', `Bearer ${alice.accessToken}`)
        .send({ questionId: question.id, answer: '41', timeSpentSeconds: 5, createErrorPattern: 'NEW', microSkillId: 'NEW-SKILL' });

      expect(await prisma.errorPattern.count()).toBe(before);
      expect(await prisma.microSkill.count()).toBe(microBefore);
    });

    it('21. /ai/analyze-error ignores client-supplied correctAnswer', async () => {
      const app = await getApp();
      const alice = await createStudent('p67-ai-err');
      const res = await request(app)
        .post('/api/v1/ai/analyze-error')
        .set('Authorization', `Bearer ${alice.accessToken}`)
        .send({ question: 'q', studentAnswer: 'a', correctAnswer: 'TOP-SECRET-42', skillId: 'forged-skill', difficulty: 1, timeSpentSeconds: 1 });

      expect(res.status).toBe(200);
      // The canonical answer a client injected must never be echoed back.
      expect(JSON.stringify(res.body.data)).not.toContain('TOP-SECRET-42');
    });
  });

  // ============================================================ Recommendation

  describe('Recommendation security', () => {
    it('22. recommendation is computed for the authenticated student only', async () => {
      const app = await getApp();
      const alice = await createStudent('p67-rec-a');
      const bob = await createStudent('p67-rec-b');

      await prisma.skillMastery.create({
        data: { studentId: bob.profileId, skillId: 'bob-strong', masteryLevel: 88, confidence: 0.9, attempts: 6, correctAttempts: 6 },
      });

      const res = await request(app)
        .get('/api/v1/recommendations/next')
        .set('Authorization', `Bearer ${alice.accessToken}`);

      expect(res.status).toBe(200);
      // Alice has no evidence → deterministic ONBOARDING, never Bob's maintenance.
      expect(res.body.data.actionType).toBe('ONBOARDING');
      expect(JSON.stringify(res.body.data)).not.toContain('bob-strong');
    });

    it('23. client cannot override recommendation identity via query/body', async () => {
      const app = await getApp();
      const alice = await createStudent('p67-rec-override');
      const res = await request(app)
        .get('/api/v1/recommendations/next')
        .query({ studentId: 'some-other-student' })
        .set('Authorization', `Bearer ${alice.accessToken}`);
      expect(res.status).toBe(200);
      expect(res.body.data).not.toHaveProperty('studentId');
    });

    it('24. AI recommendation endpoint derives context from auth, ignores client mastery', async () => {
      const app = await getApp();
      const alice = await createStudent('p67-ai-rec-a');
      const bob = await createStudent('p67-ai-rec-b');

      // Bob has strong mastery; Alice is empty. Alice must NOT receive Bob's data
      // even though she spoofs it in the body.
      await prisma.skillMastery.create({
        data: { studentId: bob.profileId, skillId: 'bob-secret-skill', masteryLevel: 95, confidence: 0.95, attempts: 8, correctAttempts: 8 },
      });

      const res = await request(app)
        .post('/api/v1/ai/recommendation')
        .set('Authorization', `Bearer ${alice.accessToken}`)
        .send({
          studentId: bob.profileId,
          currentMastery: [{ skillId: 'bob-secret-skill', masteryLevel: 95, confidence: 0.95, attempts: 8, correctAttempts: 8, lastAttemptAt: null, trend: null }],
          weakSkills: [{ skillId: 'bob-secret-skill', masteryLevel: 95, confidence: 0.95 }],
        });

      expect(res.status).toBe(200);
      // The spoofed identity/mastery must not surface in the response.
      expect(JSON.stringify(res.body.data)).not.toContain('bob-secret-skill');
    });

    it('25. staff-only system analytics is blocked for students', async () => {
      const app = await getApp();
      const alice = await createStudent('p67-role-a');
      const res = await request(app)
        .get('/api/v1/admin/analytics/system')
        .set('Authorization', `Bearer ${alice.accessToken}`);
      expect(res.status).toBe(403);
    });
  });

  // ================================================================= Analytics

  describe('Analytics', () => {
    it('26. /me returns only the authenticated student\'s data', async () => {
      const app = await getApp();
      const alice = await createStudent('p67-an-a');
      const bob = await createStudent('p67-an-b');

      await prisma.skillMastery.create({
        data: { studentId: bob.profileId, skillId: 'bob-only-skill', masteryLevel: 70, confidence: 0.7, attempts: 4, correctAttempts: 3 },
      });

      const res = await request(app)
        .get('/api/v1/analytics/me/skills')
        .set('Authorization', `Bearer ${alice.accessToken}`);

      expect(res.status).toBe(200);
      expect(JSON.stringify(res.body.data)).not.toContain('bob-only-skill');
    });

    it('27. direct /analytics/:studentId access for another student is refused', async () => {
      const app = await getApp();
      const alice = await createStudent('p67-an2-a');
      const bob = await createStudent('p67-an2-b');

      const res = await request(app)
        .get(`/api/v1/analytics/${bob.profileId}/skills`)
        .set('Authorization', `Bearer ${alice.accessToken}`);
      expect([403, 404]).toContain(res.status);
    });
  });

  // ======================================================================= AI

  describe('AI security', () => {
    it('28. AI explanation requires authentication (401)', async () => {
      const app = await getApp();
      const res = await request(app)
        .post('/api/v1/ai/explanation')
        .send({ attemptId: 'x', mode: 'HINT' });
      expect(res.status).toBe(401);
    });

    it('29. AI explanation cannot read another student\'s attempt', async () => {
      const app = await getApp();
      const alice = await createStudent('p67-ai-x-a');
      const bob = await createStudent('p67-ai-x-b');
      const { question } = await buildMappedQuestion({ correctAnswer: '42' });
      const instance = await prisma.questionInstance.create({ data: { questionId: question.id, studentId: alice.profileId } });
      const attempt = await prisma.questionAttempt.create({
        data: { studentId: alice.profileId, questionId: question.id, instanceId: instance.id, answer: '41', isCorrect: false, timeSpentSeconds: 5, status: 'COMPLETED', validatedAt: new Date() },
      });

      const res = await request(app)
        .post('/api/v1/ai/explanation')
        .set('Authorization', `Bearer ${bob.accessToken}`)
        .send({ attemptId: attempt.id, mode: 'HINT' });
      expect([403, 404]).toContain(res.status);
    });

    it('30. correctAnswer never appears in an explanation response', async () => {
      const app = await getApp();
      const alice = await createStudent('p67-ai-ans');
      const { question } = await buildMappedQuestion({ correctAnswer: 'SECRET-CANONICAL-77' });
      const instance = await prisma.questionInstance.create({ data: { questionId: question.id, studentId: alice.profileId } });
      const attempt = await prisma.questionAttempt.create({
        data: { studentId: alice.profileId, questionId: question.id, instanceId: instance.id, answer: 'nope', isCorrect: false, timeSpentSeconds: 5, status: 'COMPLETED', validatedAt: new Date() },
      });

      const res = await request(app)
        .post('/api/v1/ai/explanation')
        .set('Authorization', `Bearer ${alice.accessToken}`)
        .send({ attemptId: attempt.id, mode: 'HINT', correctAnswer: 'SECRET-CANONICAL-77' });

      expect(res.status).toBe(200);
      expect(JSON.stringify(res.body.data)).not.toContain('SECRET-CANONICAL-77');
    });
  });

  // =============================================================== Idempotency

  describe('Idempotency', () => {
    it('31. same key + same payload is a safe replay (one record)', async () => {
      const app = await getApp();
      const alice = await createStudent('p67-idem-same');
      const { question } = await buildMappedQuestion({ correctAnswer: '42' });
      await prisma.questionInstance.create({ data: { questionId: question.id, studentId: alice.profileId } });

      const body = { questionId: question.id, answer: '42', timeSpentSeconds: 5 };
      const r1 = await request(app).post('/api/v1/question-attempts').set('Authorization', `Bearer ${alice.accessToken}`).set('Idempotency-Key', 'k-same').send(body);
      const r2 = await request(app).post('/api/v1/question-attempts').set('Authorization', `Bearer ${alice.accessToken}`).set('Idempotency-Key', 'k-same').send(body);

      expect(r1.status).toBe(201);
      expect([200, 201]).toContain(r2.status);
      const attemptCount = await prisma.questionAttempt.count({ where: { studentId: alice.profileId } });
      expect(attemptCount).toBe(1);
    });

    it('32. same key + different payload is a conflict (409)', async () => {
      const app = await getApp();
      const alice = await createStudent('p67-idem-diff');
      const { question } = await buildMappedQuestion({ correctAnswer: '42' });
      await prisma.questionInstance.create({ data: { questionId: question.id, studentId: alice.profileId } });

      const r1 = await request(app).post('/api/v1/question-attempts').set('Authorization', `Bearer ${alice.accessToken}`).set('Idempotency-Key', 'k-diff').send({ questionId: question.id, answer: '42', timeSpentSeconds: 5 });
      expect(r1.status).toBe(201);

      const r2 = await request(app).post('/api/v1/question-attempts').set('Authorization', `Bearer ${alice.accessToken}`).set('Idempotency-Key', 'k-diff').send({ questionId: question.id, answer: 'DIFFERENT', timeSpentSeconds: 9 });
      expect(r2.status).toBe(409);
    });

    it('33. duplicate ingestion under the same key creates one record', async () => {
      const app = await getApp();
      const alice = await createStudent('p67-idem-ing');
      const body = { ingestMethod: 'TEXT_PASTE', rawText: 'P67 idempotent ingestion question text' };

      const r1 = await request(app).post('/api/v1/question-ingestions').set('Authorization', `Bearer ${alice.accessToken}`).set('Idempotency-Key', 'ing-1').send(body);
      const r2 = await request(app).post('/api/v1/question-ingestions').set('Authorization', `Bearer ${alice.accessToken}`).set('Idempotency-Key', 'ing-1').send(body);

      expect(r1.status).toBe(201);
      expect([200, 201]).toContain(r2.status);
      const count = await prisma.questionIngestion.count({ where: { ingestedByUserId: alice.userId } });
      expect(count).toBe(1);
    });
  });

  // ===================================================================== Roles

  describe('Role boundaries', () => {
    it('34. student is blocked from the review queue (403)', async () => {
      const app = await getApp();
      const alice = await createStudent('p67-role-rq');
      const res = await request(app)
        .get('/api/v1/review-queue')
        .set('Authorization', `Bearer ${alice.accessToken}`);
      expect(res.status).toBe(403);
    });

    it('35. student is blocked from creating skill mappings (403)', async () => {
      const app = await getApp();
      const alice = await createStudent('p67-role-map');
      const { question, microSkill } = await buildMappedQuestion();
      const res = await request(app)
        .post(`/api/v1/questions/${question.id}/skill-mappings`)
        .set('Authorization', `Bearer ${alice.accessToken}`)
        .send({ microSkillId: microSkill.id, relevance: 1, isPrimary: false });
      expect(res.status).toBe(403);
    });

    it('36. student is blocked from creating assessments (403)', async () => {
      const app = await getApp();
      const alice = await createStudent('p67-role-asmt');
      const res = await request(app)
        .post('/api/v1/assessments')
        .set('Authorization', `Bearer ${alice.accessToken}`)
        .send({ title: 'x', type: 'PRACTICE', skillIds: [] });
      expect(res.status).toBe(403);
    });
  });

  // ==================================================== Assessment IDOR (6.7)

  describe('Assessment identity (Phase 6.7)', () => {
    async function publishedAssessmentWithQuestion(correctAnswer = 'A') {
      const uid = Math.random().toString(36).slice(2, 8);
      const assessment = await prisma.assessment.create({
        data: { title: `P67 asmt ${uid}`, type: 'PRACTICE', status: 'PUBLISHED', skillIds: '[]', totalQuestions: 1, isActive: true },
      });
      const question = await prisma.question.create({
        data: { content: `P67 asmt q ${uid}`, type: 'MULTIPLE_CHOICE', difficulty: 1, skillId: 'unmapped', correctAnswer, isActive: true },
      });
      await prisma.assessmentQuestion.create({ data: { assessmentId: assessment.id, questionId: question.id, order: 1, points: 1 } });
      return { assessment, question };
    }

    it('37. client studentId in /assessments/start is ignored (identity from auth)', async () => {
      const app = await getApp();
      const alice = await createStudent('p67-as-a');
      const bob = await createStudent('p67-as-b');
      const { assessment } = await publishedAssessmentWithQuestion();

      const res = await request(app)
        .post('/api/v1/assessments/start')
        .set('Authorization', `Bearer ${alice.accessToken}`)
        .send({ studentId: bob.profileId, assessmentId: assessment.id });

      expect(res.status).toBe(200);
      const attempt = await prisma.assessmentAttempt.findUnique({ where: { id: res.body.data.id } });
      expect(attempt?.studentId).toBe(alice.profileId);
      const bobAttempts = await prisma.assessmentAttempt.count({ where: { studentId: bob.profileId } });
      expect(bobAttempts).toBe(0);
    });

    it('38. Student A cannot submit an answer to Student B\'s assessment attempt', async () => {
      const app = await getApp();
      const alice = await createStudent('p67-as2-a');
      const bob = await createStudent('p67-as2-b');
      const { assessment, question } = await publishedAssessmentWithQuestion('A');

      // Bob starts the attempt directly (bypassing HTTP to set up the scenario).
      const bobAttempt = await prisma.assessmentAttempt.create({
        data: { studentId: bob.profileId, assessmentId: assessment.id, status: 'IN_PROGRESS', startedAt: new Date() },
      });

      const res = await request(app)
        .post('/api/v1/assessments/submit-answer')
        .set('Authorization', `Bearer ${alice.accessToken}`)
        .set('Idempotency-Key', 'p67-cross-submit')
        .send({ attemptId: bobAttempt.id, questionId: question.id, answer: 'A', timeSpentSeconds: 3 });

      expect([403, 404]).toContain(res.status);
      const created = await prisma.questionAttempt.count({ where: { assessmentAttemptId: bobAttempt.id } });
      expect(created).toBe(0);
    });

    it('39. Student A cannot read Student B\'s assessment results', async () => {
      const app = await getApp();
      const alice = await createStudent('p67-as3-a');
      const bob = await createStudent('p67-as3-b');
      const { assessment } = await publishedAssessmentWithQuestion('A');

      const bobAttempt = await prisma.assessmentAttempt.create({
        data: { studentId: bob.profileId, assessmentId: assessment.id, status: 'COMPLETED', startedAt: new Date(), completedAt: new Date() },
      });

      const res = await request(app)
        .get(`/api/v1/assessments/results/${bobAttempt.id}`)
        .set('Authorization', `Bearer ${alice.accessToken}`);
      expect([403, 404]).toContain(res.status);
    });

    it('40. Student A cannot complete Student B\'s assessment attempt', async () => {
      const app = await getApp();
      const alice = await createStudent('p67-as4-a');
      const bob = await createStudent('p67-as4-b');
      const { assessment } = await publishedAssessmentWithQuestion('A');

      const bobAttempt = await prisma.assessmentAttempt.create({
        data: { studentId: bob.profileId, assessmentId: assessment.id, status: 'IN_PROGRESS', startedAt: new Date() },
      });

      const res = await request(app)
        .post('/api/v1/assessments/complete')
        .set('Authorization', `Bearer ${alice.accessToken}`)
        .set('Idempotency-Key', 'p67-cross-complete')
        .send({ attemptId: bobAttempt.id });

      expect([403, 404]).toContain(res.status);
      const after = await prisma.assessmentAttempt.findUnique({ where: { id: bobAttempt.id } });
      expect(after?.status).toBe('IN_PROGRESS');
    });
  });

  // ====================================================== Integration ingestion

  describe('Ingestion ownership', () => {
    it('41. ingestion owner is always the authenticated principal', async () => {
      const app = await getApp();
      const alice = await createStudent('p67-ing-owner');
      const bob = await createStudent('p67-ing-owner-b');

      const res = await request(app)
        .post('/api/v1/question-ingestions')
        .set('Authorization', `Bearer ${alice.accessToken}`)
        .send({ ingestMethod: 'TEXT_PASTE', rawText: 'P67 ownership question text here', studentId: bob.userId });

      expect(res.status).toBe(201);
      const row = await prisma.questionIngestion.findUnique({ where: { id: res.body.data.id } });
      expect(row?.ingestedByUserId).toBe(alice.userId);
    });

    it('42. a student cannot read another student\'s ingestion (404)', async () => {
      const app = await getApp();
      const alice = await createStudent('p67-ing-read-a');
      const bob = await createStudent('p67-ing-read-b');

      const created = await request(app)
        .post('/api/v1/question-ingestions')
        .set('Authorization', `Bearer ${bob.accessToken}`)
        .send({ ingestMethod: 'TEXT_PASTE', rawText: 'P67 private question text for bob' });
      const ingestionId = created.body.data.id as string;

      const res = await request(app)
        .get(`/api/v1/question-ingestions/${ingestionId}`)
        .set('Authorization', `Bearer ${alice.accessToken}`);
      expect(res.status).toBe(404);
    });
  });

  // ================================================== Read-path data exposure
  describe('Attempt read-path data exposure (Phase 6.7)', () => {
    async function attemptFor(student: { accessToken: string; profileId: string }, canonical: string) {
      const { question } = await buildMappedQuestion({ correctAnswer: canonical });
      const instance = await prisma.questionInstance.create({
        data: { questionId: question.id, studentId: student.profileId },
      });
      const attempt = await prisma.questionAttempt.create({
        data: {
          studentId: student.profileId,
          questionId: question.id,
          instanceId: instance.id,
          answer: 'wrong',
          isCorrect: false,
          timeSpentSeconds: 5,
          status: 'COMPLETED',
          validatedAt: new Date(),
          metadata: JSON.stringify({ evaluationState: 'EVALUATED', hasCanonicalAnswer: true }),
        },
      });
      return { question, attempt };
    }

    it('43. GET /question-attempts/:id never returns the canonical correctAnswer', async () => {
      const app = await getApp();
      const alice = await createStudent('p67-read-ans');
      const { attempt } = await attemptFor(alice, 'READ-SECRET-KEY-9');

      const res = await request(app)
        .get(`/api/v1/question-attempts/${attempt.id}`)
        .set('Authorization', `Bearer ${alice.accessToken}`);

      expect(res.status).toBe(200);
      expect(JSON.stringify(res.body.data)).not.toContain('READ-SECRET-KEY-9');
      expect(res.body.data.attemptId).toBe(attempt.id);
      expect(res.body.data.evaluationState).toBe('EVALUATED');
    });

    it('44. GET /question-attempts never bulk-exposes canonical answers', async () => {
      const app = await getApp();
      const alice = await createStudent('p67-read-bulk');
      await attemptFor(alice, 'BULK-SECRET-KEY-1');
      await attemptFor(alice, 'BULK-SECRET-KEY-2');

      const res = await request(app)
        .get('/api/v1/question-attempts')
        .set('Authorization', `Bearer ${alice.accessToken}`);

      expect(res.status).toBe(200);
      const body = JSON.stringify(res.body.data);
      expect(body).not.toContain('BULK-SECRET-KEY-1');
      expect(body).not.toContain('BULK-SECRET-KEY-2');
      // Rows are keyed by attemptId (the contract the student UI consumes).
      for (const row of res.body.data) {
        expect(row.attemptId).toBeTruthy();
      }
    });

    it('45. GET /question-attempts/:id for a non-existent attempt is refused (403)', async () => {
      const app = await getApp();
      const alice = await createStudent('p67-read-404');
      const res = await request(app)
        .get('/api/v1/question-attempts/does-not-exist-xyz')
        .set('Authorization', `Bearer ${alice.accessToken}`);
      expect([403, 404]).toContain(res.status);
    });
  });
});
