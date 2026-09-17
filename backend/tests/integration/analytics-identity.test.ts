import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

import bootstrap from '../../src/index.js';
import { prisma } from '../setup.js';

/**
 * Phase 5F.7 (A) — Analytics identity regression.
 *
 * The analytics/mastery tables key on StudentProfile.id, NOT User.id. These
 * tests prove the `/analytics/me/*` endpoints resolve the authenticated user's
 * StudentProfile rather than passing User.id straight through.
 */

async function registerAndLogin(app: express.Application, label: string) {
  const email = `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const password = 'Test123!@#';

  await request(app)
    .post('/api/v1/auth/register')
    .send({ email, password, firstName: label, lastName: 'User', grade: 11 });

  const login = await request(app)
    .post('/api/v1/auth/login')
    .send({ email, password });

  const accessToken = login.body.data.tokens.accessToken as string;
  const userId = login.body.data.user.id as string;

  const profile = await prisma.studentProfile.findUnique({ where: { userId } });
  if (!profile) {
    throw new Error('Expected a StudentProfile to exist for a registered student');
  }

  return { accessToken, userId, studentProfileId: profile.id };
}

describe('Phase 5F.7 (A) — Analytics identity resolution', () => {
  let app: express.Application;

  beforeAll(async () => {
    app = await bootstrap();
  });

  afterAll(async () => {
    // Global setup handles disconnect.
  });

  beforeEach(async () => {
    await prisma.skillMastery.deleteMany({});
    await prisma.questionAttempt.deleteMany({});
    await prisma.studentProfile.deleteMany({});
    await prisma.user.deleteMany({});
  });

  it('resolves the authenticated user to their own StudentProfile (not User.id)', async () => {
    const userA = await registerAndLogin(app, 'idA');

    // The identity contract that caused the original bug: User.id !== StudentProfile.id.
    expect(userA.studentProfileId).not.toBe(userA.userId);

    const res = await request(app)
      .get('/api/v1/analytics/me/progress')
      .set('Authorization', `Bearer ${userA.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    // A freshly registered student has an empty profile — proving the query ran
    // against a real, existing StudentProfile rather than erroring on a missing one.
    expect(res.body.data.totalQuestions).toBe(0);
  });

  it('returns the correct StudentProfile after a real attempt creates mastery', async () => {
    const userA = await registerAndLogin(app, 'masteryA');

    // Create a canonical question + skill mastery for user A's StudentProfile.
    const question = await prisma.question.create({
      data: {
        content: 'Synthetic: f(x) = 2x + 3, f(2) = ?',
        type: 'OPEN_ENDED',
        difficulty: 1,
        skillId: 'unmapped',
        correctAnswer: '7',
      },
    });

    await prisma.questionAttempt.create({
      data: {
        studentId: userA.studentProfileId,
        questionId: question.id,
        answer: '7',
        isCorrect: true,
        timeSpentSeconds: 10,
        status: 'COMPLETED',
        validatedAt: new Date(),
      },
    });

    await prisma.skillMastery.create({
      data: {
        studentId: userA.studentProfileId,
        skillId: 'p5f7-test-skill',
        masteryLevel: 42,
        confidence: 0.6,
        attempts: 1,
        correctAttempts: 1,
      },
    });

    const progressRes = await request(app)
      .get('/api/v1/analytics/me/progress')
      .set('Authorization', `Bearer ${userA.accessToken}`);

    expect(progressRes.status).toBe(200);
    expect(progressRes.body.data.totalQuestions).toBe(1);
    expect(progressRes.body.data.correctQuestions).toBe(1);

    const skillsRes = await request(app)
      .get('/api/v1/analytics/me/skills')
      .set('Authorization', `Bearer ${userA.accessToken}`);

    expect(skillsRes.status).toBe(200);
    expect(Array.isArray(skillsRes.body.data)).toBe(true);
    expect(skillsRes.body.data).toHaveLength(1);
    expect(skillsRes.body.data[0].skillId).toBe('p5f7-test-skill');
    expect(skillsRes.body.data[0].masteryLevel).toBe(42);
  });

  it('does not leak another student mastery/progress (cross-student isolation)', async () => {
    const userA = await registerAndLogin(app, 'isoA');
    const userB = await registerAndLogin(app, 'isoB');

    // Give student B mastery; student A must never see it.
    await prisma.skillMastery.create({
      data: {
        studentId: userB.studentProfileId,
        skillId: 'b-only-skill',
        masteryLevel: 90,
        confidence: 0.9,
        attempts: 3,
        correctAttempts: 3,
      },
    });

    const resA = await request(app)
      .get('/api/v1/analytics/me/skills')
      .set('Authorization', `Bearer ${userA.accessToken}`);

    expect(resA.status).toBe(200);
    expect(resA.body.data).toHaveLength(0);

    const resB = await request(app)
      .get('/api/v1/analytics/me/skills')
      .set('Authorization', `Bearer ${userB.accessToken}`);

    expect(resB.status).toBe(200);
    expect(resB.body.data).toHaveLength(1);
    expect(resB.body.data[0].skillId).toBe('b-only-skill');
  });

  it('handles a user with no StudentProfile safely (no crash, no wrong-identity read)', async () => {
    // Register + login through the real auth flow, then delete the StudentProfile
    // so the authenticated identity has a valid token but no matching profile.
    const email = `orphan-${Date.now()}@example.com`;
    const password = 'Test123!@#';
    await request(app)
      .post('/api/v1/auth/register')
      .send({ email, password, firstName: 'Orphan', lastName: 'Login', grade: 11 });
    const login = await request(app).post('/api/v1/auth/login').send({ email, password });
    const token = login.body.data.tokens.accessToken as string;
    const loginUserId = login.body.data.user.id as string;
    await prisma.studentProfile.deleteMany({ where: { userId: loginUserId } });

    const res = await request(app)
      .get('/api/v1/analytics/me/progress')
      .set('Authorization', `Bearer ${token}`);

    // Refused safely (no 500 crash, no fallback to User.id).
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });
});
