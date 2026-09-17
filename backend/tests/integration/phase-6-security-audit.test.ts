import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

import bootstrap from '../../src/index.js';
import { prisma } from '../setup.js';
import { TokenService } from '../../src/domain/services/TokenService.js';

/**
 * Phase 6.7 — Security + Identity + Idempotency Audit
 *
 * Comprehensive security audit for the Phase 6 student journey:
 *   - Cross-student isolation for all new endpoints
 *   - Identity derivation verification
 *   - IDOR (Insecure Direct Object Reference) prevention
 *   - Idempotency for Phase 6 workflows
 *   - AI authority boundaries
 */

const tokenService = new TokenService();

async function createStudent(label: string) {
  const email = `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const user = await prisma.user.create({
    data: {
      email,
      firstName: label,
      lastName: 'User',
      role: 'STUDENT',
      passwordHash: 'hash',
    },
  });
  const token = tokenService.generateAccessToken({ userId: user.id, email, role: 'STUDENT' });
  const profile = await prisma.studentProfile.create({
    data: { userId: user.id, grade: 11, school: 'Test School' },
  });
  return { user, token, profile };
}

describe('Phase 6.7 — Security Audit', () => {
  let app: express.Application;

  beforeAll(async () => {
    app = await bootstrap();
  });

  afterAll(async () => {
    // Global setup handles disconnect.
  });

  beforeEach(async () => {
    await prisma.masteryAudit.deleteMany({});
    await prisma.skillMastery.deleteMany({});
    await prisma.learningProgress.deleteMany({});
    await prisma.errorAnalysis.deleteMany({});
    await prisma.questionAttempt.deleteMany({});
    await prisma.questionInstance.deleteMany({});
    await prisma.questionIngestion.deleteMany({});
    await prisma.question.deleteMany({});
    await prisma.recommendation.deleteMany({});
    await prisma.studentProfile.deleteMany({});
    await prisma.user.deleteMany({});
  });

  describe('Identity Derivation', () => {
    it('recommendation endpoint derives studentId from authenticated principal', async () => {
      const studentA = await createStudent('rec-a');
      const studentB = await createStudent('rec-b');

      // Give student B some mastery data
      await prisma.skillMastery.create({
        data: {
          studentId: studentB.profile.id,
          skillId: 'b-skill',
          masteryLevel: 85,
          confidence: 0.8,
          attempts: 5,
          correctAttempts: 4,
        },
      });

      // Student A gets recommendation based on THEIR own data (empty)
      const resA = await request(app)
        .get('/api/v1/recommendations/next')
        .set('Authorization', `Bearer ${studentA.token}`);

      expect(resA.status).toBe(200);
      // Phase 6.5: no learning evidence → deterministic ONBOARDING (never a
      // fabricated personalisation, and never student B's data).
      expect(resA.body.data.actionType).toBe('ONBOARDING');

      // Student B gets recommendation based on THEIR data (strong skill)
      const resB = await request(app)
        .get('/api/v1/recommendations/next')
        .set('Authorization', `Bearer ${studentB.token}`);

      expect(resB.status).toBe(200);
      // Phase 6.5: an evidenced strong skill yields deterministic maintenance.
      expect(resB.body.data.actionType).toBe('MAINTAIN_SKILL');
    });

    it('cannot forge studentId in recommendation request', async () => {
      const studentA = await createStudent('forge-a');
      const studentB = await createStudent('forge-b');

      // Student B tries to use student A's identity
      const res = await request(app)
        .get('/api/v1/recommendations/next')
        .set('Authorization', `Bearer ${studentB.token}`)
        .query({ studentId: studentA.profile.id }); // Ignored by backend

      expect(res.status).toBe(200);
      // Response is based on student B's data, not student A's
      expect(res.body.data).not.toHaveProperty('studentId');
    });
  });

  describe('Cross-Student Isolation', () => {
    it('QuestionAttempt isolation: student cannot access another student attempts', async () => {
      const studentA = await createStudent('iso-attempt-a');
      const studentB = await createStudent('iso-attempt-b');

      const question = await prisma.question.create({
        data: {
          content: 'Test question',
          type: 'OPEN_ENDED',
          difficulty: 1,
          skillId: 'test-skill',
          correctAnswer: '42',
        },
      });

      const instanceA = await prisma.questionInstance.create({
        data: {
          questionId: question.id,
          studentId: studentA.profile.id,
        },
      });

      const attemptA = await prisma.questionAttempt.create({
        data: {
          studentId: studentA.profile.id,
          questionId: question.id,
          instanceId: instanceA.id,
          answer: '42',
          isCorrect: true,
          timeSpentSeconds: 10,
          status: 'COMPLETED',
          validatedAt: new Date(),
        },
      });

      // Student B cannot access student A's attempt
      const res = await request(app)
        .get(`/api/v1/question-attempts/${attemptA.id}`)
        .set('Authorization', `Bearer ${studentB.token}`);

      expect(res.status).toBe(403);
    });

    it('ErrorAnalysis isolation: student cannot access another student error analysis', async () => {
      const studentA = await createStudent('iso-error-a');
      const studentB = await createStudent('iso-error-b');

      const errorPattern = await prisma.errorPattern.create({
        data: {
          code: 'TEST-ERROR',
          name: 'Test Error',
          description: 'Test',
          category: 'CONCEPTUAL_MISUNDERSTANDING',
          severity: 'HIGH',
          source: 'TEST',
          isActive: true,
        },
      });

      const question = await prisma.question.create({
        data: {
          content: 'Test question',
          type: 'OPEN_ENDED',
          difficulty: 1,
          skillId: 'test-skill',
          correctAnswer: '42',
        },
      });

      const instanceA = await prisma.questionInstance.create({
        data: {
          questionId: question.id,
          studentId: studentA.profile.id,
        },
      });

      const attemptA = await prisma.questionAttempt.create({
        data: {
          studentId: studentA.profile.id,
          questionId: question.id,
          instanceId: instanceA.id,
          answer: 'wrong',
          isCorrect: false,
          timeSpentSeconds: 10,
          status: 'COMPLETED',
          validatedAt: new Date(),
        },
      });

      const errorAnalysisA = await prisma.errorAnalysis.create({
        data: {
          attemptId: attemptA.id,
          studentId: studentA.profile.id,
          errorPatternId: errorPattern.id,
          errorType: 'CONCEPT',
          confidence: 0.8,
          hypothesis: 'Test hypothesis',
          validated: true,
        },
      });

      // Student B cannot access student A's error analysis through attempt endpoint
      const res = await request(app)
        .get(`/api/v1/question-attempts/${attemptA.id}`)
        .set('Authorization', `Bearer ${studentB.token}`);

      expect(res.status).toBe(403);
    });

    it('Recommendation isolation: each student gets their own recommendation', async () => {
      const studentA = await createStudent('iso-rec-a');
      const studentB = await createStudent('iso-rec-b');

      // Create different mastery for each student
      await prisma.skillMastery.create({
        data: {
          studentId: studentA.profile.id,
          skillId: 'weak-skill',
          masteryLevel: 25,
          confidence: 0.5,
          attempts: 3,
          correctAttempts: 1,
        },
      });

      await prisma.skillMastery.create({
        data: {
          studentId: studentB.profile.id,
          skillId: 'strong-skill',
          masteryLevel: 85,
          confidence: 0.9,
          attempts: 5,
          correctAttempts: 4,
        },
      });

      const resA = await request(app)
        .get('/api/v1/recommendations/next')
        .set('Authorization', `Bearer ${studentA.token}`);

      const resB = await request(app)
        .get('/api/v1/recommendations/next')
        .set('Authorization', `Bearer ${studentB.token}`);

      expect(resA.status).toBe(200);
      expect(resB.status).toBe(200);

      // Different recommendations based on different mastery (Phase 6.5 vocabulary).
      expect(resA.body.data.actionType).toBe('PRACTICE_SKILL'); // Weak skill
      expect(resB.body.data.actionType).toBe('MAINTAIN_SKILL'); // Strong skill
    });
  });

  describe('Idempotency', () => {
    it('duplicate attempt submission prevents duplicate records', async () => {
      const student = await createStudent('idem-attempt');

      const question = await prisma.question.create({
        data: {
          content: 'Test question',
          type: 'OPEN_ENDED',
          difficulty: 1,
          skillId: 'test-skill',
          correctAnswer: '42',
        },
      });

      const instance = await prisma.questionInstance.create({
        data: {
          questionId: question.id,
          studentId: student.profile.id,
        },
      });

      const idempotencyKey = 'test-attempt-key';
      const attemptData = {
        questionId: question.id,
        answer: '42',
        timeSpentSeconds: 10,
        sessionId: 'standalone',
      };

      const res1 = await request(app)
        .post('/api/v1/question-attempts')
        .set('Authorization', `Bearer ${student.token}`)
        .set('Idempotency-Key', idempotencyKey)
        .send(attemptData);

      expect(res1.status).toBe(201);

      const res2 = await request(app)
        .post('/api/v1/question-attempts')
        .set('Authorization', `Bearer ${student.token}`)
        .set('Idempotency-Key', idempotencyKey)
        .send(attemptData);

      // The duplicate should be handled - check that no duplicate attempts were created
      const attemptCount = await prisma.questionAttempt.count({
        where: { studentId: student.profile.id },
      });
      expect(attemptCount).toBe(1);
    });

    it('duplicate recommendation generation is idempotent', async () => {
      const student = await createStudent('idem-rec');

      const idempotencyKey = 'test-rec-key';

      // First call
      const res1 = await request(app)
        .get('/api/v1/recommendations/next')
        .set('Authorization', `Bearer ${student.token}`)
        .set('Idempotency-Key', idempotencyKey);

      expect(res1.status).toBe(200);

      // Second call with same key should be idempotent
      const res2 = await request(app)
        .get('/api/v1/recommendations/next')
        .set('Authorization', `Bearer ${student.token}`)
        .set('Idempotency-Key', idempotencyKey);

      expect(res2.status).toBe(200);

      // Should have same or similar data
      expect(res1.body.data.actionType).toBe(res2.body.data.actionType);
    });
  });

  describe('AI Authority Boundaries', () => {
    it('AI explanation cannot access correctAnswer from request', async () => {
      const student = await createStudent('ai-bound-a');

      const question = await prisma.question.create({
        data: {
          content: 'Test question',
          type: 'OPEN_ENDED',
          difficulty: 1,
          skillId: 'test-skill',
          correctAnswer: '42',
        },
      });

      const instance = await prisma.questionInstance.create({
        data: {
          questionId: question.id,
          studentId: student.profile.id,
        },
      });

      const attempt = await prisma.questionAttempt.create({
        data: {
          studentId: student.profile.id,
          questionId: question.id,
          instanceId: instance.id,
          answer: 'wrong',
          isCorrect: false,
          timeSpentSeconds: 10,
          status: 'COMPLETED',
          validatedAt: new Date(),
        },
      });

      // Try to inject correctAnswer in explanation request
      const res = await request(app)
        .post('/api/v1/ai/ai/explanation')
        .set('Authorization', `Bearer ${student.token}`)
        .send({
          attemptId: attempt.id,
          mode: 'HINT',
          correctAnswer: '42', // Should be ignored
          maliciousData: 'should be ignored',
        });

      expect(res.status).toBe(200);
      // The response should not contain the correct answer
      expect(JSON.stringify(res.body.data)).not.toContain('42');
    });

    it('AI cannot create new MicroSkills through explanation', async () => {
      const student = await createStudent('ai-bound-b');

      const question = await prisma.question.create({
        data: {
          content: 'Test question',
          type: 'OPEN_ENDED',
          difficulty: 1,
          skillId: 'test-skill',
          correctAnswer: '42',
        },
      });

      const instance = await prisma.questionInstance.create({
        data: {
          questionId: question.id,
          studentId: student.profile.id,
        },
      });

      const attempt = await prisma.questionAttempt.create({
        data: {
          studentId: student.profile.id,
          questionId: question.id,
          instanceId: instance.id,
          answer: 'wrong',
          isCorrect: false,
          timeSpentSeconds: 10,
          status: 'COMPLETED',
          validatedAt: new Date(),
        },
      });

      const microSkillCountBefore = await prisma.microSkill.count();

      const res = await request(app)
        .post('/api/v1/ai/ai/explanation')
        .set('Authorization', `Bearer ${student.token}`)
        .send({
          attemptId: attempt.id,
          mode: 'HINT',
          createNewSkill: 'true', // Should be ignored
        });

      expect(res.status).toBe(200);

      const microSkillCountAfter = await prisma.microSkill.count();
      expect(microSkillCountAfter).toBe(microSkillCountBefore);
    });
  });

  describe('Unauthorized Access Prevention', () => {
    it('unauthenticated access to recommendation endpoint is rejected', async () => {
      const res = await request(app)
        .get('/api/v1/recommendations/next');

      expect(res.status).toBe(401);
    });

    it('unauthenticated access to question attempts is rejected', async () => {
      const res = await request(app)
        .get('/api/v1/question-attempts');

      expect(res.status).toBe(401);
    });

    it('invalid token is rejected', async () => {
      const res = await request(app)
        .get('/api/v1/recommendations/next')
        .set('Authorization', 'Bearer invalid-token');

      expect(res.status).toBe(401);
    });
  });
});
