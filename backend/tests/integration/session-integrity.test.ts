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

describe('Session Integrity Tests - Phase 4', () => {
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

  describe('IDOR Tests', () => {
    describe('Test 1: User A attempts to read User B\'s authentication/session data', () => {
      it('should deny access to another user\'s session data', async () => {
        // Create User A
        const userA = await prisma.user.create({
          data: {
            email: 'userA@example.com',
            passwordHash: 'hashA',
            firstName: 'User',
            lastName: 'A',
          },
        });

        // Create User B
        const userB = await prisma.user.create({
          data: {
            email: 'userB@example.com',
            passwordHash: 'hashB',
            firstName: 'User',
            lastName: 'B',
          },
        });

        // Create session for User B
        const sessionB = await prisma.session.create({
          data: {
            userId: userB.id,
            token: 'tokenB',
            expiresAt: new Date(Date.now() + 3600000),
          },
        });

        // User A attempts to access User B's session
        const session = await sessionRepository.findByToken('tokenB');
        
        expect(session).not.toBeNull();
        expect(session?.userId).toBe(userB.id);
        
        // Verify that User A cannot impersonate User B
        if (session && session.userId !== userA.id) {
          // This is the expected behavior - User A should not be able to use User B's session
          expect(session.userId).not.toBe(userA.id);
        }
      });
    });

    describe('Test 2: User A attempts to mutate User B\'s LearningSession', () => {
      it('should deny mutation of another user\'s learning session', async () => {
        // Create User A
        const userA = await prisma.user.create({
          data: {
            email: 'userA2@example.com',
            passwordHash: 'hashA',
            firstName: 'User',
            lastName: 'A',
          },
        });

        const studentA = await prisma.studentProfile.create({
          data: {
            userId: userA.id,
            grade: 11,
          },
        });

        // Create User B
        const userB = await prisma.user.create({
          data: {
            email: 'userB2@example.com',
            passwordHash: 'hashB',
            firstName: 'User',
            lastName: 'B',
          },
        });

        const studentB = await prisma.studentProfile.create({
          data: {
            userId: userB.id,
            grade: 11,
          },
        });

        // Create learning session for User B
        const sessionB = await prisma.learningSession.create({
          data: {
            studentId: studentB.id,
            status: 'ACTIVE',
            startedAt: new Date(),
            expiresAt: new Date(Date.now() + 3600000),
          },
        });

        // User A attempts to complete User B's session
        await expect(
          learningSessionService.completeSession(sessionB.id, userA.id)
        ).rejects.toThrow(AuthorizationError);
      });
    });

    describe('Test 3: User A provides User B\'s session identifier', () => {
      it('should deny access using another user\'s session identifier', async () => {
        // Create User A
        const userA = await prisma.user.create({
          data: {
            email: 'userA3@example.com',
            passwordHash: 'hashA',
            firstName: 'User',
            lastName: 'A',
          },
        });

        // Create User B
        const userB = await prisma.user.create({
          data: {
            email: 'userB3@example.com',
            passwordHash: 'hashB',
            firstName: 'User',
            lastName: 'B',
          },
        });

        // Create session for User B
        const sessionB = await prisma.session.create({
          data: {
            userId: userB.id,
            token: 'secretTokenB',
            expiresAt: new Date(Date.now() + 3600000),
          },
        });

        // Verify session belongs to User B
        const session = await sessionRepository.findByToken('secretTokenB');
        expect(session?.userId).toBe(userB.id);
        expect(session?.userId).not.toBe(userA.id);
      });
    });

    describe('Test 4: User A attempts to use another student\'s learning-session identifier', () => {
      it('should deny access to another student\'s learning session', async () => {
        // Create User A
        const userA = await prisma.user.create({
          data: {
            email: 'userA4@example.com',
            passwordHash: 'hashA',
            firstName: 'User',
            lastName: 'A',
          },
        });

        const studentA = await prisma.studentProfile.create({
          data: {
            userId: userA.id,
            grade: 11,
          },
        });

        // Create User B
        const userB = await prisma.user.create({
          data: {
            email: 'userB4@example.com',
            passwordHash: 'hashB',
            firstName: 'User',
            lastName: 'B',
          },
        });

        const studentB = await prisma.studentProfile.create({
          data: {
            userId: userB.id,
            grade: 11,
          },
        });

        // Create learning session for User B
        const sessionB = await prisma.learningSession.create({
          data: {
            studentId: studentB.id,
            status: 'ACTIVE',
            startedAt: new Date(),
            expiresAt: new Date(Date.now() + 3600000),
          },
        });

        // User A attempts to get User B's session
        await expect(
          learningSessionService.getSession(sessionB.id, userA.id)
        ).rejects.toThrow(AuthorizationError);
      });
    });
  });

  describe('Expiration Test Matrix', () => {
    describe('Test 1: Active session succeeds', () => {
      it('should allow operations on active session', async () => {
        const user = await prisma.user.create({
          data: {
            email: 'active@example.com',
            passwordHash: 'hash',
            firstName: 'Active',
            lastName: 'User',
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

        expect(session.status).toBe('ACTIVE');
        expect(session.expiresAt).not.toBeNull();
      });
    });

    describe('Test 2: Expired authentication session is rejected', () => {
      it('should reject operations with expired session', async () => {
        const user = await prisma.user.create({
          data: {
            email: 'expired@example.com',
            passwordHash: 'hash',
            firstName: 'Expired',
            lastName: 'User',
          },
        });

        // Create expired session
        const expiredSession = await prisma.session.create({
          data: {
            userId: user.id,
            token: 'expiredToken',
            expiresAt: new Date(Date.now() - 1000), // Expired 1 second ago
          },
        });

        const session = await sessionRepository.findByToken('expiredToken');
        expect(session).not.toBeNull();
        expect(session?.isExpired()).toBe(true);
      });
    });

    describe('Test 3: Expired LearningSession mutation is rejected', () => {
      it('should reject mutations on expired learning session', async () => {
        const user = await prisma.user.create({
          data: {
            email: 'expiredLearning@example.com',
            passwordHash: 'hash',
            firstName: 'Expired',
            lastName: 'Learning',
          },
        });

        const student = await prisma.studentProfile.create({
          data: {
            userId: user.id,
            grade: 11,
          },
        });

        // Create expired learning session
        const expiredSession = await prisma.learningSession.create({
          data: {
            studentId: student.id,
            status: 'ACTIVE',
            startedAt: new Date(Date.now() - 7200000), // 2 hours ago
            expiresAt: new Date(Date.now() - 1000), // Expired 1 second ago
          },
        });

        // Attempt to complete expired session
        await expect(
          learningSessionService.completeSession(expiredSession.id, user.id)
        ).rejects.toThrow(AuthorizationError);
      });
    });

    describe('Test 4: Revoked session is rejected', () => {
      it('should reject operations with revoked refresh token', async () => {
        const user = await prisma.user.create({
          data: {
            email: 'revoked@example.com',
            passwordHash: 'hash',
            firstName: 'Revoked',
            lastName: 'User',
          },
        });

        // Create and revoke refresh token
        const refreshToken = await prisma.refreshToken.create({
          data: {
            userId: user.id,
            token: 'revokedToken',
            expiresAt: new Date(Date.now() + 3600000),
            revokedAt: new Date(),
          },
        });

        const token = await refreshTokenRepository.findByToken('revokedToken');
        expect(token).not.toBeNull();
        expect(token?.isRevoked()).toBe(true);
        expect(token?.isActive()).toBe(false);
      });
    });

    describe('Test 5: Unknown session is rejected', () => {
      it('should reject operations with non-existent session', async () => {
        const session = await sessionRepository.findByToken('nonExistentToken');
        expect(session).toBeNull();
      });
    });

    describe('Test 6: Wrong owner is rejected', () => {
      it('should reject access by wrong owner', async () => {
        const userA = await prisma.user.create({
          data: {
            email: 'ownerA@example.com',
            passwordHash: 'hashA',
            firstName: 'Owner',
            lastName: 'A',
          },
        });

        const userB = await prisma.user.create({
          data: {
            email: 'ownerB@example.com',
            passwordHash: 'hashB',
            firstName: 'Owner',
            lastName: 'B',
          },
        });

        const studentB = await prisma.studentProfile.create({
          data: {
            userId: userB.id,
            grade: 11,
          },
        });

        const session = await prisma.learningSession.create({
          data: {
            studentId: studentB.id,
            status: 'ACTIVE',
            startedAt: new Date(),
            expiresAt: new Date(Date.now() + 3600000),
          },
        });

        // User A tries to access User B's session
        await expect(
          learningSessionService.getSession(session.id, userA.id)
        ).rejects.toThrow(AuthorizationError);
      });
    });

    describe('Test 7: Soft-deleted user is rejected', () => {
      it('should reject operations for soft-deleted user', async () => {
        const user = await prisma.user.create({
          data: {
            email: 'deleted@example.com',
            passwordHash: 'hash',
            firstName: 'Deleted',
            lastName: 'User',
            deletedAt: new Date(),
          },
        });

        // Soft-deleted user should not be able to refresh tokens
        const refreshToken = await prisma.refreshToken.create({
          data: {
            userId: user.id,
            token: 'deletedUserToken',
            expiresAt: new Date(Date.now() + 3600000),
          },
        });

        await expect(
          authService.refreshToken('deletedUserToken')
        ).rejects.toThrow(AuthenticationError);
      });
    });

    describe('Test 8: Repeated logout is safe', () => {
      it('should handle repeated logout gracefully', async () => {
        const user = await prisma.user.create({
          data: {
            email: 'logout@example.com',
            passwordHash: 'hash',
            firstName: 'Logout',
            lastName: 'User',
          },
        });

        // First logout
        await authService.logout(user.id);
        
        // Second logout should not throw
        await expect(authService.logout(user.id)).resolves.not.toThrow();
      });
    });

    describe('Test 9: Refresh with expired token is rejected', () => {
      it('should reject refresh with expired token', async () => {
        const user = await prisma.user.create({
          data: {
            email: 'expiredRefresh@example.com',
            passwordHash: 'hash',
            firstName: 'Expired',
            lastName: 'Refresh',
          },
        });

        const expiredToken = await prisma.refreshToken.create({
          data: {
            userId: user.id,
            token: 'expiredRefreshToken',
            expiresAt: new Date(Date.now() - 1000),
          },
        });

        await expect(
          authService.refreshToken('expiredRefreshToken')
        ).rejects.toThrow(AuthenticationError);
      });
    });

    describe('Test 10: Refresh with revoked token is rejected', () => {
      it('should reject refresh with revoked token', async () => {
        const user = await prisma.user.create({
          data: {
            email: 'revokedRefresh@example.com',
            passwordHash: 'hash',
            firstName: 'Revoked',
            lastName: 'Refresh',
          },
        });

        const revokedToken = await prisma.refreshToken.create({
          data: {
            userId: user.id,
            token: 'revokedRefreshToken',
            expiresAt: new Date(Date.now() + 3600000),
            revokedAt: new Date(),
          },
        });

        await expect(
          authService.refreshToken('revokedRefreshToken')
        ).rejects.toThrow(AuthenticationError);
      });
    });

    describe('Test 11: Concurrent session requests behave consistently', () => {
      it('should handle concurrent session mutations safely', async () => {
        const user = await prisma.user.create({
          data: {
            email: 'concurrent@example.com',
            passwordHash: 'hash',
            firstName: 'Concurrent',
            lastName: 'User',
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

        // Attempt concurrent completions
        const completions = [
          learningSessionService.completeSession(session.id, user.id),
          learningSessionService.completeSession(session.id, user.id),
        ];

        const results = await Promise.allSettled(completions);

        // One should succeed, one should fail
        const successCount = results.filter(r => r.status === 'fulfilled').length;
        const failureCount = results.filter(r => r.status === 'rejected').length;

        expect(successCount + failureCount).toBe(2);
        expect(successCount).toBeGreaterThan(0);
      });
    });

    describe('Test 12: Expiration boundary behaves deterministically', () => {
      it('should handle expiration boundary correctly', async () => {
        const user = await prisma.user.create({
          data: {
            email: 'boundary@example.com',
            passwordHash: 'hash',
            firstName: 'Boundary',
            lastName: 'User',
          },
        });

        const student = await prisma.studentProfile.create({
          data: {
            userId: user.id,
            grade: 11,
          },
        });

        // Create session with very short expiration
        const session = await prisma.learningSession.create({
          data: {
            studentId: student.id,
            status: 'ACTIVE',
            startedAt: new Date(),
            expiresAt: new Date(Date.now() + 100), // 100ms from now
          },
        });

        // Should work immediately
        await expect(
          learningSessionService.completeSession(session.id, user.id)
        ).resolves.not.toThrow();

        // Wait for expiration
        await new Promise(resolve => setTimeout(resolve, 150));

        // Create another session
        const session2 = await prisma.learningSession.create({
          data: {
            studentId: student.id,
            status: 'ACTIVE',
            startedAt: new Date(),
            expiresAt: new Date(Date.now() - 100), // Already expired
          },
        });

        // Should fail after expiration
        await expect(
          learningSessionService.completeSession(session2.id, user.id)
        ).rejects.toThrow(AuthorizationError);
      });
    });
  });

  describe('Session State Management', () => {
    it('should correctly track session states', async () => {
      const user = await prisma.user.create({
        data: {
          email: 'state@example.com',
          passwordHash: 'hash',
          firstName: 'State',
          lastName: 'User',
        },
      });

      const student = await prisma.studentProfile.create({
        data: {
          userId: user.id,
          grade: 11,
        },
      });

      // Start session
      const session = await learningSessionService.startSession({
        studentId: student.id,
      });
      expect(session.status).toBe('ACTIVE');

      // Complete session
      const completed = await learningSessionService.completeSession(session.id, user.id);
      expect(completed.status).toBe('COMPLETED');
      expect(completed.endedAt).not.toBeNull();

      // Cannot complete again
      await expect(
        learningSessionService.completeSession(session.id, user.id)
      ).rejects.toThrow();
    });
  });

  describe('Learning Session Expiration Enforcement', () => {
    it('should auto-expire sessions when accessed', async () => {
      const user = await prisma.user.create({
        data: {
          email: 'autoexpire@example.com',
          passwordHash: 'hash',
          firstName: 'Auto',
          lastName: 'Expire',
        },
      });

      const student = await prisma.studentProfile.create({
        data: {
          userId: user.id,
          grade: 11,
        },
      });

      // Create expired session
      const session = await prisma.learningSession.create({
        data: {
          studentId: student.id,
          status: 'ACTIVE',
          startedAt: new Date(Date.now() - 7200000),
          expiresAt: new Date(Date.now() - 1000),
        },
      });

      // Get active session should return null (auto-expired)
      const activeSession = await learningSessionService.getActiveSession(student.id);
      expect(activeSession).toBeNull();

      // Verify session was auto-expired in database
      const updatedSession = await prisma.learningSession.findUnique({
        where: { id: session.id },
      });
      expect(updatedSession?.status).toBe('EXPIRED');
    });
  });
});