import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

import bootstrap from '../../src/index.js';
import { prisma } from '../setup.js';

/**
 * Phase 6.2 — Real Authentication & Canonical Student App Shell Integration Tests
 *
 * These tests verify:
 * 1. Student data isolation - Student A cannot access Student B's resources
 * 2. Authentication flow - signup, login, session, logout
 * 3. Protected route behavior
 * 4. API client integration with token management
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
  const refreshToken = login.body.data.tokens.refreshToken as string;
  const userId = login.body.data.user.id as string;

  const profile = await prisma.studentProfile.findUnique({ where: { userId } });
  if (!profile) {
    throw new Error('Expected a StudentProfile to exist for a registered student');
  }

  return { accessToken, refreshToken, userId, studentProfileId: profile.id };
}

describe('Phase 6.2 — Authentication Integration', () => {
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
    await prisma.errorAnalysis.deleteMany({});
    await prisma.recommendation.deleteMany({});
    await prisma.studentProfile.deleteMany({});
    await prisma.user.deleteMany({});
  });

  describe('Authentication Flow', () => {
    it('signup success - creates user and student profile', async () => {
      const email = `signup-${Date.now()}@example.com`;
      const password = 'Test123!@#';

      const res = await request(app)
        .post('/api/v1/auth/register')
        .send({
          email,
          password,
          firstName: 'Test',
          lastName: 'User',
          grade: 11,
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.user.email).toBe(email);
      expect(res.body.data.user.firstName).toBe('Test');
      expect(res.body.data.user.studentProfile).toBeDefined();
      expect(res.body.data.tokens.accessToken).toBeDefined();
      expect(res.body.data.tokens.refreshToken).toBeDefined();
    });

    it('signup validation - rejects weak password', async () => {
      const email = `weak-${Date.now()}@example.com`;

      const res = await request(app)
        .post('/api/v1/auth/register')
        .send({
          email,
          password: 'weak',
          firstName: 'Test',
          lastName: 'User',
          grade: 11,
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('signup validation - rejects duplicate email', async () => {
      const email = `duplicate-${Date.now()}@example.com`;
      const password = 'Test123!@#';

      await request(app)
        .post('/api/v1/auth/register')
        .send({
          email,
          password,
          firstName: 'Test',
          lastName: 'User',
          grade: 11,
        });

      const res = await request(app)
        .post('/api/v1/auth/register')
        .send({
          email,
          password,
          firstName: 'Test2',
          lastName: 'User2',
          grade: 11,
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('login success - returns tokens and user data', async () => {
      const email = `login-${Date.now()}@example.com`;
      const password = 'Test123!@#';

      await request(app)
        .post('/api/v1/auth/register')
        .send({
          email,
          password,
          firstName: 'Test',
          lastName: 'User',
          grade: 11,
        });

      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({ email, password });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.user.email).toBe(email);
      expect(res.body.data.tokens.accessToken).toBeDefined();
      expect(res.body.data.tokens.refreshToken).toBeDefined();
    });

    it('login validation - rejects invalid credentials', async () => {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: 'nonexistent@example.com', password: 'wrong' });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it('logout success - revokes tokens', async () => {
      const user = await registerAndLogin(app, 'logout');

      const res = await request(app)
        .post('/api/v1/auth/logout')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ refreshToken: user.refreshToken });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('refresh token success - rotates tokens', async () => {
      const user = await registerAndLogin(app, 'refresh');

      const res = await request(app)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: user.refreshToken });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.accessToken).toBeDefined();
      expect(res.body.data.refreshToken).toBeDefined();
      // Token rotation: new refresh token should be different
      expect(res.body.data.refreshToken).not.toBe(user.refreshToken);
    });

    it('refresh token failure - rejects invalid token', async () => {
      const res = await request(app)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: 'invalid-token' });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });
  });

  describe('Student Data Isolation', () => {
    it('Student A cannot access Student B QuestionAttempts', async () => {
      const userA = await registerAndLogin(app, 'isoA');
      const userB = await registerAndLogin(app, 'isoB');

      const question = await prisma.question.create({
        data: {
          content: 'Test question',
          type: 'OPEN_ENDED',
          difficulty: 1,
          skillId: 'test-skill',
          correctAnswer: '42',
        },
      });

      // Create attempt for student B
      await prisma.questionAttempt.create({
        data: {
          studentId: userB.studentProfileId,
          questionId: question.id,
          answer: '42',
          isCorrect: true,
          timeSpentSeconds: 10,
          status: 'COMPLETED',
          validatedAt: new Date(),
        },
      });

      // Student A tries to access student B's attempt
      const attemptsRes = await request(app)
        .get('/api/v1/question-attempts')
        .set('Authorization', `Bearer ${userA.accessToken}`);

      expect(attemptsRes.status).toBe(200);
      // Student A should see only their own attempts (empty)
      expect(Array.isArray(attemptsRes.body.data)).toBe(true);
      expect(attemptsRes.body.data).toHaveLength(0);
    });

    it('Student A cannot access Student B SkillMastery', async () => {
      const userA = await registerAndLogin(app, 'masteryA');
      const userB = await registerAndLogin(app, 'masteryB');

      // Give student B mastery
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

    it('Student A cannot access Student B ErrorAnalysis', async () => {
      const userA = await registerAndLogin(app, 'errorA');
      const userB = await registerAndLogin(app, 'errorB');

      const question = await prisma.question.create({
        data: {
          content: 'Test question',
          type: 'OPEN_ENDED',
          difficulty: 1,
          skillId: 'test-skill',
          correctAnswer: '42',
        },
      });

      const attemptB = await prisma.questionAttempt.create({
        data: {
          studentId: userB.studentProfileId,
          questionId: question.id,
          answer: 'wrong',
          isCorrect: false,
          timeSpentSeconds: 10,
          status: 'COMPLETED',
          validatedAt: new Date(),
        },
      });

      // Create error analysis for student B
      await prisma.errorAnalysis.create({
        data: {
          attemptId: attemptB.id,
          studentId: userB.studentProfileId,
          errorType: 'CALCULATION',
          confidence: 0.8,
          hypothesis: 'Test hypothesis',
          validated: false,
        },
      });

      // Student A tries to access error analysis
      const resA = await request(app)
        .get(`/api/v1/question-attempts/${attemptB.id}`)
        .set('Authorization', `Bearer ${userA.accessToken}`);

      // Should be forbidden or not found (backend protects by studentId)
      expect(resA.status).toBeGreaterThanOrEqual(400);
    });

    it('Student A cannot access Student B Recommendations', async () => {
      const userA = await registerAndLogin(app, 'recA');
      const userB = await registerAndLogin(app, 'recB');

      // Create recommendation for student B
      await prisma.recommendation.create({
        data: {
          studentId: userB.studentProfileId,
          focusSkillId: 'b-skill',
          focusSkillName: 'B Skill',
          reason: 'Test recommendation for B',
          estimatedTimeMinutes: 30,
          priority: 1,
          actionType: 'PRACTICE',
        },
      });

      const resA = await request(app)
        .get('/api/v1/recommendations/next')
        .set('Authorization', `Bearer ${userA.accessToken}`);

      expect(resA.status).toBe(200);
      // Student A must get their OWN deterministic recommendation — never student
      // B's persisted row. (Phase 6.5 returns a clean DTO, so the identity check is
      // on the reason text and the absence of B's skill.)
      expect(resA.body.data.reason).not.toBe('Test recommendation for B');
      expect(resA.body.data.microSkillId).not.toBe('b-skill');
      expect(['ONBOARDING', 'PROGRESS_CURRICULUM', 'PRACTICE_SKILL']).toContain(
        resA.body.data.actionType
      );
    });
  });

  describe('Protected Route Behavior', () => {
    it('rejects unauthenticated request to protected endpoint', async () => {
      const res = await request(app)
        .get('/api/v1/analytics/me/progress');

      expect(res.status).toBe(401);
    });

    it('rejects request with invalid token', async () => {
      const res = await request(app)
        .get('/api/v1/analytics/me/progress')
        .set('Authorization', 'Bearer invalid-token');

      expect(res.status).toBe(401);
    });

    it('accepts authenticated request to protected endpoint', async () => {
      const user = await registerAndLogin(app, 'protected');

      const res = await request(app)
        .get('/api/v1/analytics/me/progress')
        .set('Authorization', `Bearer ${user.accessToken}`);

      expect(res.status).toBe(200);
    });
  });
});
