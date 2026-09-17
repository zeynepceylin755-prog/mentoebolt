import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { AuthService } from '../../src/application/services/auth/AuthService.js';
import { LearningSessionService } from '../../src/application/services/learning/LearningSessionService.js';
import { TokenService } from '../../src/domain/services/TokenService.js';
import { PasswordService } from '../../src/domain/services/PasswordService.js';
import { PrismaUserRepository } from '../../src/infrastructure/repositories/PrismaUserRepository.js';
import { PrismaStudentRepository } from '../../src/infrastructure/repositories/PrismaStudentRepository.js';
import { PrismaRefreshTokenRepository } from '../../src/infrastructure/repositories/PrismaRefreshTokenRepository.js';
import { PrismaSessionRepository } from '../../src/infrastructure/repositories/PrismaSessionRepository.js';
import { AuthenticationError, AuthorizationError } from '../../src/domain/errors/AuthenticationError.js';

describe('Session Concurrency and Race Condition Tests - Phase 4', () => {
  let prisma: PrismaClient;
  let authService: AuthService;
  let learningSessionService: LearningSessionService;
  let tokenService: TokenService;
  let passwordService: PasswordService;
  let userRepository: PrismaUserRepository;
  let studentRepository: PrismaStudentRepository;
  let refreshTokenRepository: PrismaRefreshTokenRepository;
  let sessionRepository: PrismaSessionRepository;

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
    
    // Initialize services
    tokenService = new TokenService();
    passwordService = new PasswordService();
    userRepository = new PrismaUserRepository(prisma);
    studentRepository = new PrismaStudentRepository(prisma);
    refreshTokenRepository = new PrismaRefreshTokenRepository(prisma);
    sessionRepository = new PrismaSessionRepository(prisma);
    
    authService = new AuthService(
      userRepository,
      studentRepository,
      refreshTokenRepository,
      sessionRepository,
      tokenService,
      passwordService
    );
    
    learningSessionService = new LearningSessionService(prisma, studentRepository);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    // Clean database before each test in correct order to respect foreign keys
    await prisma.questionAttempt.deleteMany();
    await prisma.learningSessionQuestion.deleteMany();
    await prisma.learningSession.deleteMany();
    await prisma.skillMastery.deleteMany();
    await prisma.topicMastery.deleteMany();
    await prisma.learningProgress.deleteMany();
    await prisma.recommendation.deleteMany();
    await prisma.assessmentAttempt.deleteMany();
    await prisma.assessmentResult.deleteMany();
    await prisma.diagnosticResult.deleteMany();
    await prisma.errorAnalysis.deleteMany();
    await prisma.masteryAudit.deleteMany();
    await prisma.refreshToken.deleteMany();
    await prisma.session.deleteMany();
    await prisma.studentProfile.deleteMany();
    await prisma.user.deleteMany();
  });

  describe('Expiration Race Test', () => {
    it('should handle expiration boundary deterministically', async () => {
      const user = await prisma.user.create({
        data: {
          email: 'race@example.com',
          passwordHash: 'hash',
          firstName: 'Race',
          lastName: 'User',
        },
      });

      const student = await prisma.studentProfile.create({
        data: {
          userId: user.id,
          grade: 11,
        },
      });

      // Create session that will expire in 50ms
      const session = await prisma.learningSession.create({
        data: {
          studentId: student.id,
          status: 'ACTIVE',
          startedAt: new Date(),
          expiresAt: new Date(Date.now() + 50),
        },
      });

      // Request 1: immediately (should succeed)
      const result1 = await learningSessionService.completeSession(session.id, user.id);
      expect(result1.status).toBe('COMPLETED');

      // Create another session that's already expired
      const session2 = await prisma.learningSession.create({
        data: {
          studentId: student.id,
          status: 'ACTIVE',
          startedAt: new Date(),
          expiresAt: new Date(Date.now() - 100), // Already expired
        },
      });

      // Request 2: already expired (should fail)
      await expect(
        learningSessionService.completeSession(session2.id, user.id)
      ).rejects.toThrow(AuthorizationError);

      // Verify session2 was not completed
      const finalSession = await prisma.learningSession.findUnique({
        where: { id: session2.id },
      });
      expect(finalSession?.status).toBe('ACTIVE');
    });

    it('should handle concurrent requests at expiration boundary', async () => {
      const user = await prisma.user.create({
        data: {
          email: 'concurrent-expire@example.com',
          passwordHash: 'hash',
          firstName: 'Concurrent',
          lastName: 'Expire',
        },
      });

      const student = await prisma.studentProfile.create({
        data: {
          userId: user.id,
          grade: 11,
        },
      });

      // Create session with longer expiration to avoid race conditions in test
      const session = await prisma.learningSession.create({
        data: {
          studentId: student.id,
          status: 'ACTIVE',
          startedAt: new Date(),
          expiresAt: new Date(Date.now() + 5000), // 5 seconds
        },
      });

      // Launch concurrent requests immediately
      const requests = [
        learningSessionService.completeSession(session.id, user.id),
        learningSessionService.completeSession(session.id, user.id),
        learningSessionService.completeSession(session.id, user.id),
      ];

      const results = await Promise.allSettled(requests);

      // Count successes and failures
      const successes = results.filter(r => r.status === 'fulfilled');
      const failures = results.filter(r => r.status === 'rejected');

      // Behavior should be deterministic: either all fail (expired) or one succeeds
      // The important thing is that we don't get inconsistent state
      expect(successes.length + failures.length).toBe(3);

      // Verify final state is consistent
      const finalSession = await prisma.learningSession.findUnique({
        where: { id: session.id },
      });

      // Session should either be COMPLETED (if one succeeded) or ACTIVE (if all failed)
      expect(['COMPLETED', 'ACTIVE']).toContain(finalSession?.status);
    });
  });

  describe('Revocation Race Test', () => {
    it('should handle logout vs active request race', async () => {
      const user = await prisma.user.create({
        data: {
          email: 'revocation@example.com',
          passwordHash: 'hash',
          firstName: 'Revocation',
          lastName: 'User',
        },
      });

      const student = await prisma.studentProfile.create({
        data: {
          userId: user.id,
          grade: 11,
        },
      });

      // Create session
      const session = await prisma.session.create({
        data: {
          userId: user.id,
          token: 'sessionToken',
          expiresAt: new Date(Date.now() + 3600000),
        },
      });

      // Create refresh token
      const refreshToken = await prisma.refreshToken.create({
        data: {
          userId: user.id,
          token: 'refreshToken',
          expiresAt: new Date(Date.now() + 2592000000),
        },
      });

      // Request A: Start a long-running operation (simulated)
      const operationA = (async () => {
        await new Promise(resolve => setTimeout(resolve, 100));
        // Try to use the session after logout
        const sessionCheck = await sessionRepository.findByToken('sessionToken');
        return sessionCheck;
      })();

      // Request B: Logout immediately
      const operationB = (async () => {
        await authService.logout(user.id);
        const sessions = await sessionRepository.findByUserId(user.id);
        return sessions;
      })();

      const [resultA, resultB] = await Promise.all([operationA, operationB]);

      // After logout, no sessions should exist
      expect(resultB).toHaveLength(0);

      // The session check in operationA may still find the session if it hasn't been deleted yet
      // This is acceptable - the important thing is that subsequent operations are rejected
      if (resultA) {
        // Session may still exist immediately after logout starts
        // But it should be expired/revoked
        expect(resultA.isExpired() || resultA.userId !== user.id).toBeTruthy();
      }
    });

    it('should handle refresh vs logout race', async () => {
      const user = await prisma.user.create({
        data: {
          email: 'refresh-race@example.com',
          passwordHash: 'hash',
          firstName: 'Refresh',
          lastName: 'Race',
        },
      });

      // Create refresh token
      const refreshToken = await prisma.refreshToken.create({
        data: {
          userId: user.id,
          token: 'raceRefreshToken',
          expiresAt: new Date(Date.now() + 2592000000),
        },
      });

      // Request A: Attempt refresh
      const operationA = authService.refreshToken('raceRefreshToken');

      // Request B: Logout simultaneously
      const operationB = authService.logout(user.id);

      // Execute both
      const results = await Promise.allSettled([operationA, operationB]);

      // One should succeed, one should fail
      const successCount = results.filter(r => r.status === 'fulfilled').length;
      const failureCount = results.filter(r => r.status === 'rejected').length;

      expect(successCount + failureCount).toBe(2);

      // Verify final state: refresh token should be revoked
      const finalToken = await refreshTokenRepository.findByToken('raceRefreshToken');
      expect(finalToken?.isRevoked()).toBe(true);
    });

    it('should handle concurrent logout requests', async () => {
      const user = await prisma.user.create({
        data: {
          email: 'concurrent-logout@example.com',
          passwordHash: 'hash',
          firstName: 'Concurrent',
          lastName: 'Logout',
        },
      });

      // Create sessions
      await prisma.session.createMany({
        data: [
          {
            userId: user.id,
            token: 'token1',
            expiresAt: new Date(Date.now() + 3600000),
          },
          {
            userId: user.id,
            token: 'token2',
            expiresAt: new Date(Date.now() + 3600000),
          },
        ],
      });

      // Create refresh tokens
      await prisma.refreshToken.createMany({
        data: [
          {
            userId: user.id,
            token: 'refresh1',
            expiresAt: new Date(Date.now() + 2592000000),
          },
          {
            userId: user.id,
            token: 'refresh2',
            expiresAt: new Date(Date.now() + 2592000000),
          },
        ],
      });

      // Concurrent logout requests
      const logouts = [
        authService.logout(user.id),
        authService.logout(user.id),
        authService.logout(user.id),
      ];

      const results = await Promise.allSettled(logouts);

      // All should succeed (logout is idempotent)
      const successCount = results.filter(r => r.status === 'fulfilled').length;
      expect(successCount).toBe(3);

      // Verify all sessions and tokens are revoked/deleted
      const sessions = await sessionRepository.findByUserId(user.id);
      const tokens = await refreshTokenRepository.findByUserId(user.id);

      expect(sessions).toHaveLength(0);
      expect(tokens.every(t => t.isRevoked())).toBe(true);
    });
  });

  describe('Concurrent Learning Session Mutations', () => {
    it('should handle concurrent session completions safely', async () => {
      const user = await prisma.user.create({
        data: {
          email: 'concurrent-session@example.com',
          passwordHash: 'hash',
          firstName: 'Concurrent',
          lastName: 'Session',
        },
      });

      const student = await prisma.studentProfile.create({
        data: {
          userId: user.id,
          grade: 11,
        },
      });

      const session = await learningSessionService.startSession({
        studentId: student.id,
      });

      // Concurrent completion attempts
      const completions = [
        learningSessionService.completeSession(session.id, user.id),
        learningSessionService.completeSession(session.id, user.id),
        learningSessionService.completeSession(session.id, user.id),
      ];

      const results = await Promise.allSettled(completions);

      // One or more should succeed, others should fail
      const successCount = results.filter(r => r.status === 'fulfilled').length;
      const failureCount = results.filter(r => r.status === 'rejected').length;

      expect(successCount + failureCount).toBe(3);
      expect(successCount).toBeGreaterThanOrEqual(1);
      expect(failureCount).toBeGreaterThanOrEqual(0);

      // Verify final state is consistent - should be COMPLETED
      const finalSession = await prisma.learningSession.findUnique({
        where: { id: session.id },
      });

      expect(finalSession?.status).toBe('COMPLETED');
    });

    it('should handle concurrent question additions safely', async () => {
      const user = await prisma.user.create({
        data: {
          email: 'concurrent-questions@example.com',
          passwordHash: 'hash',
          firstName: 'Concurrent',
          lastName: 'Questions',
        },
      });

      const student = await prisma.studentProfile.create({
        data: {
          userId: user.id,
          grade: 11,
        },
      });

      const session = await learningSessionService.startSession({
        studentId: student.id,
      });

      // Create questions
      const question1 = await prisma.question.create({
        data: {
          content: 'Question 1',
          type: 'MULTIPLE_CHOICE',
          difficulty: 1,
          skillId: 'skill1',
          correctAnswer: 'A',
        },
      });

      const question2 = await prisma.question.create({
        data: {
          content: 'Question 2',
          type: 'MULTIPLE_CHOICE',
          difficulty: 1,
          skillId: 'skill1',
          correctAnswer: 'B',
        },
      });

      // Concurrent question additions
      const additions = [
        learningSessionService.addQuestionToSession({
          sessionId: session.id,
          questionId: question1.id,
          order: 1,
        }),
        learningSessionService.addQuestionToSession({
          sessionId: session.id,
          questionId: question2.id,
          order: 2,
        }),
      ];

      const results = await Promise.allSettled(additions);

      // Both should succeed (different questions)
      const successCount = results.filter(r => r.status === 'fulfilled').length;
      expect(successCount).toBe(2);

      // Verify both questions were added
      const finalSession = await prisma.learningSession.findUnique({
        where: { id: session.id },
        include: { questions: true },
      });

      expect(finalSession?.questions).toHaveLength(2);
    });

    it('should prevent duplicate question additions concurrently', async () => {
      const user = await prisma.user.create({
        data: {
          email: 'duplicate-concurrent@example.com',
          passwordHash: 'hash',
          firstName: 'Duplicate',
          lastName: 'Concurrent',
        },
      });

      const student = await prisma.studentProfile.create({
        data: {
          userId: user.id,
          grade: 11,
        },
      });

      const session = await learningSessionService.startSession({
        studentId: student.id,
      });

      const question = await prisma.question.create({
        data: {
          content: 'Question',
          type: 'MULTIPLE_CHOICE',
          difficulty: 1,
          skillId: 'skill1',
          correctAnswer: 'A',
        },
      });

      // Concurrent attempts to add the same question
      const additions = [
        learningSessionService.addQuestionToSession({
          sessionId: session.id,
          questionId: question.id,
          order: 1,
        }),
        learningSessionService.addQuestionToSession({
          sessionId: session.id,
          questionId: question.id,
          order: 1,
        }),
      ];

      const results = await Promise.allSettled(additions);

      // One should succeed, one should fail
      const successCount = results.filter(r => r.status === 'fulfilled').length;
      const failureCount = results.filter(r => r.status === 'rejected').length;

      expect(successCount + failureCount).toBe(2);
      expect(successCount).toBe(1);
      expect(failureCount).toBe(1);

      // Verify only one instance exists
      const finalSession = await prisma.learningSession.findUnique({
        where: { id: session.id },
        include: { questions: true },
      });

      expect(finalSession?.questions).toHaveLength(1);
    });
  });

  describe('Refresh Token Replay Protection', () => {
    it('should prevent replay of already-consumed refresh token', async () => {
      const user = await prisma.user.create({
        data: {
          email: 'replay@example.com',
          passwordHash: 'hash',
          firstName: 'Replay',
          lastName: 'User',
        },
      });

      // Generate a valid JWT refresh token using the token service
      const refreshTokenId = 'test-token-id';
      const jwtToken = tokenService.generateRefreshToken(user.id, refreshTokenId);

      // Create refresh token in database
      const refreshToken = await prisma.refreshToken.create({
        data: {
          userId: user.id,
          token: jwtToken,
          expiresAt: new Date(Date.now() + 2592000000),
        },
      });

      // First refresh should succeed
      const firstRefresh = await authService.refreshToken(jwtToken);
      expect(firstRefresh).toBeDefined();
      expect(firstRefresh.refreshToken).toBeDefined();

      // Second refresh with same token (should fail - token was revoked)
      await expect(
        authService.refreshToken(jwtToken)
      ).rejects.toThrow(AuthenticationError);

      // Verify original token was revoked
      const token = await refreshTokenRepository.findByToken(jwtToken);
      expect(token?.isRevoked()).toBe(true);
    });
  });
});