import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { AssessmentService } from '../../src/application/services/assessment/AssessmentService.js';

describe('Assessment Transaction Tests', () => {
  let prisma: PrismaClient;
  let assessmentService: AssessmentService;

  beforeAll(async () => {
    prisma = new PrismaClient({
      datasources: {
        db: {
          url: process.env.DATABASE_URL || 'file:./dev.db',
        },
      },
    });

    // Enable foreign keys for SQLite
    await prisma.$connect();
    await prisma.$executeRawUnsafe('PRAGMA foreign_keys = ON');

    assessmentService = new AssessmentService(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    // Only clean up idempotency records - let other data persist to avoid FK issues
    await prisma.idempotencyRecord.deleteMany();
  });

  describe('Answer Submission Transaction', () => {
    it('should atomically create QuestionAttempt and update AssessmentAttempt', async () => {
      // Setup test data
      const user = await prisma.user.create({
        data: {
          email: 'test@example.com',
          passwordHash: 'hash',
          firstName: 'Test',
          lastName: 'User',
        },
      });

      const student = await prisma.studentProfile.create({
        data: {
          userId: user.id,
          grade: 11,
        },
      });

      const question = await prisma.question.create({
        data: {
          content: 'What is 2 + 2?',
          type: 'MULTIPLE_CHOICE',
          difficulty: 1,
          skillId: 'skill1',
          correctAnswer: '4',
        },
      });

      const assessment = await prisma.assessment.create({
        data: {
          title: 'Test Assessment',
          type: 'PRACTICE',
          status: 'PUBLISHED',
          skillIds: JSON.stringify(['skill1']),
          totalQuestions: 1,
        },
      });

      await prisma.assessmentQuestion.create({
        data: {
          assessmentId: assessment.id,
          questionId: question.id,
          order: 1,
          points: 1,
        },
      });

      const attempt = await prisma.assessmentAttempt.create({
        data: {
          studentId: student.id,
          assessmentId: assessment.id,
          status: 'IN_PROGRESS',
        },
      });

      // Execute transaction
      const result = await assessmentService.submitAnswer(
        attempt.id,
        question.id,
        '4',
        5
      );

      // Verify atomicity - both operations should succeed
      expect(result.isCorrect).toBe(true);

      const questionAttempt = await prisma.questionAttempt.findFirst({
        where: {
          assessmentAttemptId: attempt.id,
          questionId: question.id,
        },
      });

      expect(questionAttempt).not.toBeNull();
      expect(questionAttempt?.isCorrect).toBe(true);

      const updatedAttempt = await prisma.assessmentAttempt.findUnique({
        where: { id: attempt.id },
      });

      expect(updatedAttempt?.answers).not.toBeNull();
      const answers = JSON.parse(updatedAttempt!.answers!);
      expect(answers).toHaveLength(1);
      expect(answers[0].questionId).toBe(question.id);
    });

    it('should rollback QuestionAttempt if AssessmentAttempt update fails', async () => {
      // Setup test data
      const user = await prisma.user.create({
        data: {
          email: 'test2@example.com',
          passwordHash: 'hash',
          firstName: 'Test',
          lastName: 'User',
        },
      });

      const student = await prisma.studentProfile.create({
        data: {
          userId: user.id,
          grade: 11,
        },
      });

      const question = await prisma.question.create({
        data: {
          content: 'What is 3 + 3?',
          type: 'MULTIPLE_CHOICE',
          difficulty: 1,
          skillId: 'skill2',
          correctAnswer: '6',
        },
      });

      const assessment = await prisma.assessment.create({
        data: {
          title: 'Test Assessment 2',
          type: 'PRACTICE',
          status: 'PUBLISHED',
          skillIds: JSON.stringify(['skill2']),
          totalQuestions: 1,
        },
      });

      await prisma.assessmentQuestion.create({
        data: {
          assessmentId: assessment.id,
          questionId: question.id,
          order: 1,
          points: 1,
        },
      });

      const attempt = await prisma.assessmentAttempt.create({
        data: {
          studentId: student.id,
          assessmentId: assessment.id,
          status: 'IN_PROGRESS',
        },
      });

      // Create a service whose transaction client fails when updating the
      // AssessmentAttempt. The transaction must still be a REAL Prisma
      // transaction so that QuestionAttempt.create is actually rolled back
      // when the update throws.
      const mockPrisma = {
        ...prisma,
        $transaction: async (callback: any) => {
          return prisma.$transaction(async (tx) => {
            const failingTx: any = Object.create(tx);
            failingTx.assessmentAttempt = {
              ...(tx as any).assessmentAttempt,
              update: async () => {
                throw new Error('Simulated update failure');
              },
            };
            return callback(failingTx);
          });
        },
      };

      const mockService = new AssessmentService(mockPrisma as any);

      // Execute transaction that should fail
      await expect(
        mockService.submitAnswer(attempt.id, question.id, '6', 5)
      ).rejects.toThrow('Simulated update failure');

      // Verify rollback - no QuestionAttempt should exist
      const questionAttempts = await prisma.questionAttempt.findMany({
        where: {
          assessmentAttemptId: attempt.id,
        },
      });

      expect(questionAttempts).toHaveLength(0);

      // Verify AssessmentAttempt was not updated
      const updatedAttempt = await prisma.assessmentAttempt.findUnique({
        where: { id: attempt.id },
      });

      expect(updatedAttempt?.answers).toBeNull();
    });

    it('should reject duplicate answer submissions', async () => {
      // Setup test data
      const user = await prisma.user.create({
        data: {
          email: 'test3@example.com',
          passwordHash: 'hash',
          firstName: 'Test',
          lastName: 'User',
        },
      });

      const student = await prisma.studentProfile.create({
        data: {
          userId: user.id,
          grade: 11,
        },
      });

      const question = await prisma.question.create({
        data: {
          content: 'What is 4 + 4?',
          type: 'MULTIPLE_CHOICE',
          difficulty: 1,
          skillId: 'skill3',
          correctAnswer: '8',
        },
      });

      const assessment = await prisma.assessment.create({
        data: {
          title: 'Test Assessment 3',
          type: 'PRACTICE',
          status: 'PUBLISHED',
          skillIds: JSON.stringify(['skill3']),
          totalQuestions: 1,
        },
      });

      await prisma.assessmentQuestion.create({
        data: {
          assessmentId: assessment.id,
          questionId: question.id,
          order: 1,
          points: 1,
        },
      });

      const attempt = await prisma.assessmentAttempt.create({
        data: {
          studentId: student.id,
          assessmentId: assessment.id,
          status: 'IN_PROGRESS',
        },
      });

      // First submission
      await assessmentService.submitAnswer(attempt.id, question.id, '8', 5);

      // Second submission should fail
      await expect(
        assessmentService.submitAnswer(attempt.id, question.id, '8', 5)
      ).rejects.toThrow('Question already answered');

      // Verify only one attempt exists
      const questionAttempts = await prisma.questionAttempt.findMany({
        where: {
          assessmentAttemptId: attempt.id,
          questionId: question.id,
        },
      });

      expect(questionAttempts).toHaveLength(1);
    });
  });

  describe('Assessment Completion Transaction', () => {
    it('should atomically update AssessmentAttempt status and score', async () => {
      // Setup test data
      const user = await prisma.user.create({
        data: {
          email: 'test4@example.com',
          passwordHash: 'hash',
          firstName: 'Test',
          lastName: 'User',
        },
      });

      const student = await prisma.studentProfile.create({
        data: {
          userId: user.id,
          grade: 11,
        },
      });

      const question1 = await prisma.question.create({
        data: {
          content: 'What is 5 + 5?',
          type: 'MULTIPLE_CHOICE',
          difficulty: 1,
          skillId: 'skill4',
          correctAnswer: '10',
        },
      });

      const question2 = await prisma.question.create({
        data: {
          content: 'What is 6 + 6?',
          type: 'MULTIPLE_CHOICE',
          difficulty: 1,
          skillId: 'skill4',
          correctAnswer: '12',
        },
      });

      const assessment = await prisma.assessment.create({
        data: {
          title: 'Test Assessment 4',
          type: 'PRACTICE',
          status: 'PUBLISHED',
          skillIds: JSON.stringify(['skill4']),
          totalQuestions: 2,
        },
      });

      await prisma.assessmentQuestion.create({
        data: {
          assessmentId: assessment.id,
          questionId: question1.id,
          order: 1,
          points: 1,
        },
      });

      await prisma.assessmentQuestion.create({
        data: {
          assessmentId: assessment.id,
          questionId: question2.id,
          order: 2,
          points: 1,
        },
      });

      const attempt = await prisma.assessmentAttempt.create({
        data: {
          studentId: student.id,
          assessmentId: assessment.id,
          status: 'IN_PROGRESS',
        },
      });

      // Submit answers
      await prisma.questionAttempt.create({
        data: {
          studentId: student.id,
          questionId: question1.id,
          assessmentAttemptId: attempt.id,
          answer: '10',
          isCorrect: true,
          timeSpentSeconds: 5,
          status: 'COMPLETED',
          validatedAt: new Date(),
        },
      });

      await prisma.questionAttempt.create({
        data: {
          studentId: student.id,
          questionId: question2.id,
          assessmentAttemptId: attempt.id,
          answer: '12',
          isCorrect: true,
          timeSpentSeconds: 5,
          status: 'COMPLETED',
          validatedAt: new Date(),
        },
      });

      // Complete assessment
      const result = await assessmentService.completeAssessment(attempt.id);

      // Verify atomicity
      expect(result.status).toBe('COMPLETED');
      expect(result.score).toBe(2);
      expect(result.maxScore).toBe(2);
      expect(result.percentageScore).toBe(100);
      expect(result.completedAt).not.toBeNull();
    });

    it('should rollback if scoring calculation fails', async () => {
      // Setup test data
      const user = await prisma.user.create({
        data: {
          email: 'test5@example.com',
          passwordHash: 'hash',
          firstName: 'Test',
          lastName: 'User',
        },
      });

      const student = await prisma.studentProfile.create({
        data: {
          userId: user.id,
          grade: 11,
        },
      });

      const question = await prisma.question.create({
        data: {
          content: 'What is 7 + 7?',
          type: 'MULTIPLE_CHOICE',
          difficulty: 1,
          skillId: 'skill5',
          correctAnswer: '14',
        },
      });

      const assessment = await prisma.assessment.create({
        data: {
          title: 'Test Assessment 5',
          type: 'PRACTICE',
          status: 'PUBLISHED',
          skillIds: JSON.stringify(['skill5']),
          totalQuestions: 1,
        },
      });

      await prisma.assessmentQuestion.create({
        data: {
          assessmentId: assessment.id,
          questionId: question.id,
          order: 1,
          points: 1,
        },
      });

      const attempt = await prisma.assessmentAttempt.create({
        data: {
          studentId: student.id,
          assessmentId: assessment.id,
          status: 'IN_PROGRESS',
        },
      });

      // Create a service with a mocked prisma that fails on update
      const mockPrisma = {
        ...prisma,
        $transaction: async (callback: any) => {
          const tx = {
            ...prisma,
            assessmentAttempt: {
              ...prisma.assessmentAttempt,
              update: async () => {
                throw new Error('Simulated scoring failure');
              },
            },
          };
          return callback(tx);
        },
      };

      const mockService = new AssessmentService(mockPrisma as any);

      // Submit an answer first
      await prisma.questionAttempt.create({
        data: {
          studentId: student.id,
          questionId: question.id,
          assessmentAttemptId: attempt.id,
          answer: '14',
          isCorrect: true,
          timeSpentSeconds: 5,
          status: 'COMPLETED',
          validatedAt: new Date(),
        },
      });

      // Attempt completion that should fail
      await expect(
        mockService.completeAssessment(attempt.id)
      ).rejects.toThrow('Simulated scoring failure');

      // Verify rollback - attempt should remain IN_PROGRESS
      const updatedAttempt = await prisma.assessmentAttempt.findUnique({
        where: { id: attempt.id },
      });

      expect(updatedAttempt?.status).toBe('IN_PROGRESS');
      expect(updatedAttempt?.score).toBeNull();
      expect(updatedAttempt?.completedAt).toBeNull();
    });

    it('should reject completion of already completed assessment', async () => {
      // Setup test data
      const user = await prisma.user.create({
        data: {
          email: 'test6@example.com',
          passwordHash: 'hash',
          firstName: 'Test',
          lastName: 'User',
        },
      });

      const student = await prisma.studentProfile.create({
        data: {
          userId: user.id,
          grade: 11,
        },
      });

      const question = await prisma.question.create({
        data: {
          content: 'What is 8 + 8?',
          type: 'MULTIPLE_CHOICE',
          difficulty: 1,
          skillId: 'skill6',
          correctAnswer: '16',
        },
      });

      const assessment = await prisma.assessment.create({
        data: {
          title: 'Test Assessment 6',
          type: 'PRACTICE',
          status: 'PUBLISHED',
          skillIds: JSON.stringify(['skill6']),
          totalQuestions: 1,
        },
      });

      await prisma.assessmentQuestion.create({
        data: {
          assessmentId: assessment.id,
          questionId: question.id,
          order: 1,
          points: 1,
        },
      });

      const attempt = await prisma.assessmentAttempt.create({
        data: {
          studentId: student.id,
          assessmentId: assessment.id,
          status: 'IN_PROGRESS',
        },
      });

      // Submit answer and complete
      await prisma.questionAttempt.create({
        data: {
          studentId: student.id,
          questionId: question.id,
          assessmentAttemptId: attempt.id,
          answer: '16',
          isCorrect: true,
          timeSpentSeconds: 5,
          status: 'COMPLETED',
          validatedAt: new Date(),
        },
      });

      await assessmentService.completeAssessment(attempt.id);

      // Try to complete again
      await expect(
        assessmentService.completeAssessment(attempt.id)
      ).rejects.toThrow('Assessment already completed');
    });
  });

  describe('Concurrency Tests', () => {
    it('should handle concurrent answer submissions for same question', async () => {
      // Setup test data
      const user = await prisma.user.create({
        data: {
          email: 'test7@example.com',
          passwordHash: 'hash',
          firstName: 'Test',
          lastName: 'User',
        },
      });

      const student = await prisma.studentProfile.create({
        data: {
          userId: user.id,
          grade: 11,
        },
      });

      const question = await prisma.question.create({
        data: {
          content: 'What is 9 + 9?',
          type: 'MULTIPLE_CHOICE',
          difficulty: 1,
          skillId: 'skill7',
          correctAnswer: '18',
        },
      });

      const assessment = await prisma.assessment.create({
        data: {
          title: 'Test Assessment 7',
          type: 'PRACTICE',
          status: 'PUBLISHED',
          skillIds: JSON.stringify(['skill7']),
          totalQuestions: 1,
        },
      });

      await prisma.assessmentQuestion.create({
        data: {
          assessmentId: assessment.id,
          questionId: question.id,
          order: 1,
          points: 1,
        },
      });

      const attempt = await prisma.assessmentAttempt.create({
        data: {
          studentId: student.id,
          assessmentId: assessment.id,
          status: 'IN_PROGRESS',
        },
      });

      // Attempt concurrent submissions
      const submissions = [
        assessmentService.submitAnswer(attempt.id, question.id, '18', 5),
        assessmentService.submitAnswer(attempt.id, question.id, '18', 5),
      ];

      const results = await Promise.allSettled(submissions);

      // One should succeed, one should fail
      const successCount = results.filter(r => r.status === 'fulfilled').length;
      const failureCount = results.filter(r => r.status === 'rejected').length;

      expect(successCount).toBe(1);
      expect(failureCount).toBe(1);

      // Verify only one attempt exists
      const questionAttempts = await prisma.questionAttempt.findMany({
        where: {
          assessmentAttemptId: attempt.id,
          questionId: question.id,
        },
      });

      expect(questionAttempts).toHaveLength(1);
    });

    it('should handle concurrent assessment completion attempts', async () => {
      // Setup test data
      const user = await prisma.user.create({
        data: {
          email: 'test8@example.com',
          passwordHash: 'hash',
          firstName: 'Test',
          lastName: 'User',
        },
      });

      const student = await prisma.studentProfile.create({
        data: {
          userId: user.id,
          grade: 11,
        },
      });

      const question = await prisma.question.create({
        data: {
          content: 'What is 10 + 10?',
          type: 'MULTIPLE_CHOICE',
          difficulty: 1,
          skillId: 'skill8',
          correctAnswer: '20',
        },
      });

      const assessment = await prisma.assessment.create({
        data: {
          title: 'Test Assessment 8',
          type: 'PRACTICE',
          status: 'PUBLISHED',
          skillIds: JSON.stringify(['skill8']),
          totalQuestions: 1,
        },
      });

      await prisma.assessmentQuestion.create({
        data: {
          assessmentId: assessment.id,
          questionId: question.id,
          order: 1,
          points: 1,
        },
      });

      const attempt = await prisma.assessmentAttempt.create({
        data: {
          studentId: student.id,
          assessmentId: assessment.id,
          status: 'IN_PROGRESS',
        },
      });

      // Submit answer
      await prisma.questionAttempt.create({
        data: {
          studentId: student.id,
          questionId: question.id,
          assessmentAttemptId: attempt.id,
          answer: '20',
          isCorrect: true,
          timeSpentSeconds: 5,
          status: 'COMPLETED',
          validatedAt: new Date(),
        },
      });

      // Attempt concurrent completions
      const completions = [
        assessmentService.completeAssessment(attempt.id),
        assessmentService.completeAssessment(attempt.id),
      ];

      const results = await Promise.allSettled(completions);

      // One should succeed, one should fail
      const successCount = results.filter(r => r.status === 'fulfilled').length;
      const failureCount = results.filter(r => r.status === 'rejected').length;

      expect(successCount).toBe(1);
      expect(failureCount).toBe(1);

      // Verify assessment is completed
      const updatedAttempt = await prisma.assessmentAttempt.findUnique({
        where: { id: attempt.id },
      });

      expect(updatedAttempt?.status).toBe('COMPLETED');
    });
  });
});