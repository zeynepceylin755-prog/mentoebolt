import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

import bootstrap from '../../src/index.js';
import { prisma } from '../setup.js';

/**
 * Phase 5F.7 (B) — Next recommendation endpoint.
 *
 * Wires the existing NextLearningActionService behind
 * GET /api/v1/recommendations/next. These tests prove the endpoint resolves the
 * caller's StudentProfile and preserves the service's existing semantics.
 */

async function registerAndLogin(app: express.Application, label: string) {
  const email = `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const password = 'Test123!@#';

  await request(app)
    .post('/api/v1/auth/register')
    .send({ email, password, firstName: label, lastName: 'User', grade: 11 });

  const login = await request(app).post('/api/v1/auth/login').send({ email, password });
  const accessToken = login.body.data.tokens.accessToken as string;
  const userId = login.body.data.user.id as string;

  const profile = await prisma.studentProfile.findUnique({ where: { userId } });
  if (!profile) {
    throw new Error('Expected a StudentProfile to exist for a registered student');
  }

  return { accessToken, userId, studentProfileId: profile.id };
}

describe('Phase 5F.7 (B) — GET /api/v1/recommendations/next', () => {
  let app: express.Application;

  beforeAll(async () => {
    app = await bootstrap();
  });

  afterAll(async () => {
    // Global setup handles disconnect.
  });

  beforeEach(async () => {
    await prisma.recommendation.deleteMany({});
    await prisma.skillMastery.deleteMany({});
    await prisma.questionAttempt.deleteMany({});
    await prisma.studentProfile.deleteMany({});
    await prisma.user.deleteMany({});
  });

  it('returns the service-defined initial action for a new student (ASSESS)', async () => {
    const student = await registerAndLogin(app, 'newrec');

    const res = await request(app)
      .get('/api/v1/recommendations/next')
      .set('Authorization', `Bearer ${student.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    // Phase 6.5: no learning evidence at all → deterministic ONBOARDING (P8),
    // never a fabricated personalised weakness.
    expect(res.body.data.actionType).toBe('ONBOARDING');
    expect(res.body.data.reasonCode).toBe('INSUFFICIENT_EVIDENCE');
  });

  it('returns a low-mastery remediation for a student with weak, evidenced mastery', async () => {
    const student = await registerAndLogin(app, 'weakrec');

    await prisma.skillMastery.create({
      data: {
        studentId: student.studentProfileId,
        skillId: 'weak-skill',
        masteryLevel: 20,
        confidence: 0.5,
        attempts: 5,
        correctAttempts: 1,
        // Phase 6.5: a weak score is only actionable with sufficient evidence.
        evidenceCount: 5,
      },
    });

    const res = await request(app)
      .get('/api/v1/recommendations/next')
      .set('Authorization', `Bearer ${student.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.actionType).toBe('PRACTICE_SKILL');
    expect(res.body.data.reasonCode).toBe('LOW_MASTERY');
    expect(res.body.data.evidence.mastery).toBe(20);
    expect(res.body.data.evidence.evidenceCount).toBe(5);
  });

  it('resolves the correct student identity for the recommendation', async () => {
    const studentA = await registerAndLogin(app, 'idrecA');
    const studentB = await registerAndLogin(app, 'idrecB');

    await prisma.skillMastery.create({
      data: {
        studentId: studentB.studentProfileId,
        skillId: 'b-weak-skill',
        masteryLevel: 10,
        confidence: 0.4,
        attempts: 5,
        correctAttempts: 0,
        evidenceCount: 5,
      },
    });

    const resA = await request(app)
      .get('/api/v1/recommendations/next')
      .set('Authorization', `Bearer ${studentA.accessToken}`);

    // Student A has no mastery of their own -> ONBOARDING, not student B's PRACTICE.
    expect(resA.status).toBe(200);
    expect(resA.body.data.actionType).toBe('ONBOARDING');
    expect(resA.body.data.reasonCode).toBe('INSUFFICIENT_EVIDENCE');

    const resB = await request(app)
      .get('/api/v1/recommendations/next')
      .set('Authorization', `Bearer ${studentB.accessToken}`);

    expect(resB.status).toBe(200);
    expect(resB.body.data.actionType).toBe('PRACTICE_SKILL');
    expect(resB.body.data.reasonCode).toBe('LOW_MASTERY');
  });

  it('rejects an unauthenticated request', async () => {
    const res = await request(app).get('/api/v1/recommendations/next');
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it('handles a user with no StudentProfile safely', async () => {
    const email = `recorphan-${Date.now()}@example.com`;
    const password = 'Test123!@#';
    await request(app)
      .post('/api/v1/auth/register')
      .send({ email, password, firstName: 'Rec', lastName: 'Orphan', grade: 11 });
    const login = await request(app).post('/api/v1/auth/login').send({ email, password });
    const token = login.body.data.tokens.accessToken as string;
    const userId = login.body.data.user.id as string;
    await prisma.studentProfile.deleteMany({ where: { userId } });

    const res = await request(app)
      .get('/api/v1/recommendations/next')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });
});
