import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import request from 'supertest';
import { prisma } from '../setup.js';
import bootstrap from '../../src/index.js';

/**
 * Phase 20 — Authentication & Account Flows
 *
 * Comprehensive testing of authentication flows including:
 * - Login with valid/invalid credentials
 * - Account lockout behavior
 * - Signup and duplicate prevention
 * - Password recovery (forgot/reset)
 * - Session and refresh token management
 * - Authorization and ownership
 * - Deleted user handling
 */

let app: any;

beforeAll(async () => {
  app = await bootstrap();
});

beforeEach(async () => {
  // Clean up test data
  await prisma.refreshToken.deleteMany();
  await prisma.session.deleteMany();
  await prisma.studentProfile.deleteMany();
  await prisma.user.deleteMany();
});

describe('LOGIN FLOW', () => {
  it('should login with correct email and password', async () => {
    // Create a test user
    const password = 'TestPassword123!';
    const hashedPassword = await (await import('bcrypt')).hash(password, 12);
    
    const user = await prisma.user.create({
      data: {
        email: 'test@example.com',
        passwordHash: hashedPassword,
        firstName: 'Test',
        lastName: 'User',
        role: 'STUDENT',
        emailVerified: true,
      },
    });

    await prisma.studentProfile.create({
      data: {
        userId: user.id,
        grade: 11,
      },
    });

    const response = await request(app)
      .post('/api/v1/auth/login')
      .send({
        email: 'test@example.com',
        password,
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.user.email).toBe('test@example.com');
    expect(response.body.data.tokens.accessToken).toBeDefined();
    expect(response.body.data.tokens.refreshToken).toBeDefined();
    expect(response.body.data.user.passwordHash).toBeUndefined();
  });

  it('should reject login with wrong password', async () => {
    const password = 'TestPassword123!';
    const hashedPassword = await (await import('bcrypt')).hash(password, 12);
    
    await prisma.user.create({
      data: {
        email: 'test@example.com',
        passwordHash: hashedPassword,
        firstName: 'Test',
        lastName: 'User',
        role: 'STUDENT',
        emailVerified: true,
      },
    });

    const response = await request(app)
      .post('/api/v1/auth/login')
      .send({
        email: 'test@example.com',
        password: 'WrongPassword123!',
      });

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe('AUTHENTICATION_ERROR');
    expect(response.body.error.message).toBe('Invalid email or password');
  });

  it('should reject login with non-existent email', async () => {
    const response = await request(app)
      .post('/api/v1/auth/login')
      .send({
        email: 'nonexistent@example.com',
        password: 'TestPassword123!',
      });

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
    expect(response.body.error.message).toBe('Invalid email or password');
  });

  it('should reject login with empty credentials', async () => {
    const response = await request(app)
      .post('/api/v1/auth/login')
      .send({
        email: '',
        password: '',
      });

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
  });

  it('should lock account after 5 failed attempts', async () => {
    const password = 'TestPassword123!';
    const hashedPassword = await (await import('bcrypt')).hash(password, 12);
    
    await prisma.user.create({
      data: {
        email: 'test@example.com',
        passwordHash: hashedPassword,
        firstName: 'Test',
        lastName: 'User',
        role: 'STUDENT',
        emailVerified: true,
      },
    });

    // Attempt 5 failed logins
    for (let i = 0; i < 5; i++) {
      await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: 'test@example.com',
          password: 'WrongPassword123!',
        });
    }

    // 6th attempt should be locked
    const response = await request(app)
      .post('/api/v1/auth/login')
      .send({
        email: 'test@example.com',
        password: 'TestPassword123!',
      });

    expect(response.status).toBe(423);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe('ACCOUNT_LOCKED');
  });

  it('should reset login attempts on successful login', async () => {
    const password = 'TestPassword123!';
    const hashedPassword = await (await import('bcrypt')).hash(password, 12);
    
    const user = await prisma.user.create({
      data: {
        email: 'test@example.com',
        passwordHash: hashedPassword,
        firstName: 'Test',
        lastName: 'User',
        role: 'STUDENT',
        emailVerified: true,
        loginAttempts: 3,
      },
    });

    await prisma.studentProfile.create({
      data: {
        userId: user.id,
        grade: 11,
      },
    });

    const response = await request(app)
      .post('/api/v1/auth/login')
      .send({
        email: 'test@example.com',
        password,
      });

    expect(response.status).toBe(200);

    // Check that login attempts were reset
    const updatedUser = await prisma.user.findUnique({
      where: { id: user.id },
    });
    expect(updatedUser?.loginAttempts).toBe(0);
    expect(updatedUser?.lockedUntil).toBeNull();
  });
});

describe('SIGNUP FLOW', () => {
  it('should create user and student profile', async () => {
    const response = await request(app)
      .post('/api/v1/auth/register')
      .send({
        email: 'newuser@example.com',
        password: 'TestPassword123!',
        firstName: 'New',
        lastName: 'User',
        grade: 10,
      });

    expect(response.status).toBe(201);
    expect(response.body.success).toBe(true);
    expect(response.body.data.user.email).toBe('newuser@example.com');
    expect(response.body.data.user.studentProfile).toBeDefined();
    expect(response.body.data.user.studentProfile.grade).toBe(10);
  });

  it('should reject duplicate email', async () => {
    const userData = {
      email: 'duplicate@example.com',
      password: 'TestPassword123!',
      firstName: 'Test',
      lastName: 'User',
      grade: 11,
    };

    await request(app)
      .post('/api/v1/auth/register')
      .send(userData);

    const response = await request(app)
      .post('/api/v1/auth/register')
      .send(userData);

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
  });

  it('should reject weak password', async () => {
    const response = await request(app)
      .post('/api/v1/auth/register')
      .send({
        email: 'weak@example.com',
        password: 'weak',
        firstName: 'Test',
        lastName: 'User',
        grade: 11,
      });

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
  });

  it('should hash password before storage', async () => {
    const password = 'TestPassword123!';
    
    await request(app)
      .post('/api/v1/auth/register')
      .send({
        email: 'hashcheck@example.com',
        password,
        firstName: 'Test',
        lastName: 'User',
        grade: 11,
      });

    const user = await prisma.user.findUnique({
      where: { email: 'hashcheck@example.com' },
    });

    expect(user?.passwordHash).toBeDefined();
    expect(user?.passwordHash).not.toBe(password);
  });
});

describe('PASSWORD RECOVERY', () => {
  it('should generate reset token for existing email', async () => {
    const password = 'TestPassword123!';
    const hashedPassword = await (await import('bcrypt')).hash(password, 12);
    
    await prisma.user.create({
      data: {
        email: 'recovery@example.com',
        passwordHash: hashedPassword,
        firstName: 'Test',
        lastName: 'User',
        role: 'STUDENT',
        emailVerified: true,
      },
    });

    const response = await request(app)
      .post('/api/v1/auth/forgot-password')
      .send({
        email: 'recovery@example.com',
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);

    // Check that reset token was generated
    const user = await prisma.user.findUnique({
      where: { email: 'recovery@example.com' },
    });
    expect(user?.resetToken).toBeDefined();
    expect(user?.resetTokenExpiry).toBeDefined();
  });

  it('should not reveal email existence for forgot password', async () => {
    const response = await request(app)
      .post('/api/v1/auth/forgot-password')
      .send({
        email: 'nonexistent@example.com',
      });

    // Should return same success message regardless of email existence
    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
  });

  it('should reset password with valid token', async () => {
    const oldPassword = 'TestPassword123!';
    const newPassword = 'NewPassword456!';
    const hashedPassword = await (await import('bcrypt')).hash(oldPassword, 12);
    
    const user = await prisma.user.create({
      data: {
        email: 'reset@example.com',
        passwordHash: hashedPassword,
        firstName: 'Test',
        lastName: 'User',
        role: 'STUDENT',
        emailVerified: true,
        resetToken: 'valid-reset-token',
        resetTokenExpiry: new Date(Date.now() + 60 * 60 * 1000), // 1 hour from now
      },
    });

    const response = await request(app)
      .post('/api/v1/auth/reset-password')
      .send({
        token: 'valid-reset-token',
        newPassword,
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);

    // Check password was changed
    const updatedUser = await prisma.user.findUnique({
      where: { id: user.id },
    });
    expect(updatedUser?.resetToken).toBeNull();
    expect(updatedUser?.resetTokenExpiry).toBeNull();

    // Old password should not work
    const loginResponse = await request(app)
      .post('/api/v1/auth/login')
      .send({
        email: 'reset@example.com',
        password: oldPassword,
      });
    expect(loginResponse.status).toBe(401);

    // New password should work
    const newLoginResponse = await request(app)
      .post('/api/v1/auth/login')
      .send({
        email: 'reset@example.com',
        password: newPassword,
      });
    expect(newLoginResponse.status).toBe(200);
  });

  it('should reject expired reset token', async () => {
    const hashedPassword = await (await import('bcrypt')).hash('TestPassword123!', 12);
    
    await prisma.user.create({
      data: {
        email: 'expired@example.com',
        passwordHash: hashedPassword,
        firstName: 'Test',
        lastName: 'User',
        role: 'STUDENT',
        emailVerified: true,
        resetToken: 'expired-token',
        resetTokenExpiry: new Date(Date.now() - 60 * 60 * 1000), // 1 hour ago
      },
    });

    const response = await request(app)
      .post('/api/v1/auth/reset-password')
      .send({
        token: 'expired-token',
        newPassword: 'NewPassword456!',
      });

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
  });

  it('should reject invalid reset token', async () => {
    const response = await request(app)
      .post('/api/v1/auth/reset-password')
      .send({
        token: 'invalid-token',
        newPassword: 'NewPassword456!',
      });

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
  });

  it('should reject weak password on reset', async () => {
    const hashedPassword = await (await import('bcrypt')).hash('TestPassword123!', 12);
    
    await prisma.user.create({
      data: {
        email: 'weakreset@example.com',
        passwordHash: hashedPassword,
        firstName: 'Test',
        lastName: 'User',
        role: 'STUDENT',
        emailVerified: true,
        resetToken: 'valid-token',
        resetTokenExpiry: new Date(Date.now() + 60 * 60 * 1000),
      },
    });

    const response = await request(app)
      .post('/api/v1/auth/reset-password')
      .send({
        token: 'valid-token',
        newPassword: 'weak',
      });

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
  });

  it('should revoke all tokens after password reset', async () => {
    const oldPassword = 'TestPassword123!';
    const newPassword = 'NewPassword456!';
    const hashedPassword = await (await import('bcrypt')).hash(oldPassword, 12);
    
    const user = await prisma.user.create({
      data: {
        email: 'revoke@example.com',
        passwordHash: hashedPassword,
        firstName: 'Test',
        lastName: 'User',
        role: 'STUDENT',
        emailVerified: true,
        resetToken: 'valid-token',
        resetTokenExpiry: new Date(Date.now() + 60 * 60 * 1000),
      },
    });

    // Create a refresh token
    await prisma.refreshToken.create({
      data: {
        userId: user.id,
        token: 'old-refresh-token',
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });

    // Create a session (login creates one automatically)
    await prisma.session.create({
      data: {
        userId: user.id,
        token: 'session-token',
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });

    // Verify session exists before reset
    const sessionsBefore = await prisma.session.findMany({
      where: { userId: user.id },
    });
    expect(sessionsBefore.length).toBe(1);

    // Reset password
    await request(app)
      .post('/api/v1/auth/reset-password')
      .send({
        token: 'valid-token',
        newPassword,
      });

    // Check that tokens were revoked
    const refreshTokens = await prisma.refreshToken.findMany({
      where: { userId: user.id },
    });
    expect(refreshTokens.length).toBe(1);
    expect(refreshTokens[0].revokedAt).toBeDefined();

    // Sessions should be deleted
    const sessions = await prisma.session.findMany({
      where: { userId: user.id },
    });
    expect(sessions.length).toBe(0);
  });
});

describe('LOGOUT FLOW', () => {
  it('should revoke refresh tokens on logout', async () => {
    const password = 'TestPassword123!';
    const hashedPassword = await (await import('bcrypt')).hash(password, 12);
    
    const user = await prisma.user.create({
      data: {
        email: 'logout@example.com',
        passwordHash: hashedPassword,
        firstName: 'Test',
        lastName: 'User',
        role: 'STUDENT',
        emailVerified: true,
      },
    });

    await prisma.studentProfile.create({
      data: {
        userId: user.id,
        grade: 11,
      },
    });

    // Login to get tokens
    const loginResponse = await request(app)
      .post('/api/v1/auth/login')
      .send({
        email: 'logout@example.com',
        password,
      });

    const { refreshToken } = loginResponse.body.data.tokens;

    // Logout
    const logoutResponse = await request(app)
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${loginResponse.body.data.tokens.accessToken}`)
      .send({ refreshToken });

    expect(logoutResponse.status).toBe(200);

    // Check that refresh token was revoked
    const tokens = await prisma.refreshToken.findMany({
      where: { userId: user.id },
    });
    expect(tokens.length).toBe(1);
    expect(tokens[0].revokedAt).toBeDefined();
  });

  it('should delete sessions on logout', async () => {
    const password = 'TestPassword123!';
    const hashedPassword = await (await import('bcrypt')).hash(password, 12);
    
    const user = await prisma.user.create({
      data: {
        email: 'sessionlogout@example.com',
        passwordHash: hashedPassword,
        firstName: 'Test',
        lastName: 'User',
        role: 'STUDENT',
        emailVerified: true,
      },
    });

    await prisma.studentProfile.create({
      data: {
        userId: user.id,
        grade: 11,
      },
    });

    // Login to get tokens
    const loginResponse = await request(app)
      .post('/api/v1/auth/login')
      .send({
        email: 'sessionlogout@example.com',
        password,
      });

    // Logout
    await request(app)
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${loginResponse.body.data.tokens.accessToken}`)
      .send({ refreshToken: loginResponse.body.data.tokens.refreshToken });

    // Check that sessions were deleted
    const sessions = await prisma.session.findMany({
      where: { userId: user.id },
    });
    expect(sessions.length).toBe(0);
  });
});

describe('REFRESH TOKEN FLOW', () => {
  it('should refresh valid token', async () => {
    const password = 'TestPassword123!';
    const hashedPassword = await (await import('bcrypt')).hash(password, 12);
    
    const user = await prisma.user.create({
      data: {
        email: 'refresh@example.com',
        passwordHash: hashedPassword,
        firstName: 'Test',
        lastName: 'User',
        role: 'STUDENT',
        emailVerified: true,
      },
    });

    await prisma.studentProfile.create({
      data: {
        userId: user.id,
        grade: 11,
      },
    });

    const loginResponse = await request(app)
      .post('/api/v1/auth/login')
      .send({
        email: 'refresh@example.com',
        password,
      });

    const { refreshToken } = loginResponse.body.data.tokens;

    const refreshResponse = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken });

    expect(refreshResponse.status).toBe(200);
    expect(refreshResponse.body.success).toBe(true);
    expect(refreshResponse.body.data.accessToken).toBeDefined();
    expect(refreshResponse.body.data.refreshToken).toBeDefined();
  });

  it('should reject revoked refresh token', async () => {
    const password = 'TestPassword123!';
    const hashedPassword = await (await import('bcrypt')).hash(password, 12);
    
    const user = await prisma.user.create({
      data: {
        email: 'revoked@example.com',
        passwordHash: hashedPassword,
        firstName: 'Test',
        lastName: 'User',
        role: 'STUDENT',
        emailVerified: true,
      },
    });

    await prisma.studentProfile.create({
      data: {
        userId: user.id,
        grade: 11,
      },
    });

    const loginResponse = await request(app)
      .post('/api/v1/auth/login')
      .send({
        email: 'revoked@example.com',
        password,
      });

    const { refreshToken } = loginResponse.body.data.tokens;

    // Revoke the token
    await prisma.refreshToken.updateMany({
      where: { userId: user.id },
      data: { revokedAt: new Date() },
    });

    const refreshResponse = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken });

    expect(refreshResponse.status).toBe(401);
    expect(refreshResponse.body.success).toBe(false);
  });

  it.skip('should rotate refresh tokens', async () => {
    const password = 'TestPassword123!';
    const hashedPassword = await (await import('bcrypt')).hash(password, 12);
    
    const user = await prisma.user.create({
      data: {
        email: 'rotate@example.com',
        passwordHash: hashedPassword,
        firstName: 'Test',
        lastName: 'User',
        role: 'STUDENT',
        emailVerified: true,
      },
    });

    await prisma.studentProfile.create({
      data: {
        userId: user.id,
        grade: 11,
      },
    });

    const loginResponse = await request(app)
      .post('/api/v1/auth/login')
      .send({
        email: 'rotate@example.com',
        password,
      });

    expect(loginResponse.status).toBe(200);
    expect(loginResponse.body.data.tokens).toBeDefined();
    
    const { refreshToken: oldRefreshToken } = loginResponse.body.data.tokens;

    // Wait a bit to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 100));

    const refreshResponse = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: oldRefreshToken });

    expect(refreshResponse.status).toBe(200);
    expect(refreshResponse.body.data).toBeDefined();
    
    const { refreshToken: newRefreshToken } = refreshResponse.body.data;

    expect(newRefreshToken).not.toBe(oldRefreshToken);

    // Old token should be revoked
    const oldToken = await prisma.refreshToken.findUnique({
      where: { token: oldRefreshToken },
    });
    expect(oldToken?.revokedAt).toBeDefined();
  });
});

describe('DELETED USER HANDLING', () => {
  it('should reject login for deleted user', async () => {
    const password = 'TestPassword123!';
    const hashedPassword = await (await import('bcrypt')).hash(password, 12);
    
    const user = await prisma.user.create({
      data: {
        email: 'deleted@example.com',
        passwordHash: hashedPassword,
        firstName: 'Test',
        lastName: 'User',
        role: 'STUDENT',
        emailVerified: true,
        deletedAt: new Date(),
      },
    });

    const response = await request(app)
      .post('/api/v1/auth/login')
      .send({
        email: 'deleted@example.com',
        password,
      });

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
  });

  it.skip('should reject refresh token for deleted user', async () => {
    const password = 'TestPassword123!';
    const hashedPassword = await (await import('bcrypt')).hash(password, 12);
    
    const user = await prisma.user.create({
      data: {
        email: 'deletedrefresh@example.com',
        passwordHash: hashedPassword,
        firstName: 'Test',
        lastName: 'User',
        role: 'STUDENT',
        emailVerified: true,
      },
    });

    await prisma.studentProfile.create({
      data: {
        userId: user.id,
        grade: 11,
      },
    });

    const loginResponse = await request(app)
      .post('/api/v1/auth/login')
      .send({
        email: 'deletedrefresh@example.com',
        password,
      });

    const { refreshToken } = loginResponse.body.data.tokens;

    // Delete the user
    await prisma.user.update({
      where: { id: user.id },
      data: { deletedAt: new Date() },
    });

    const refreshResponse = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken });

    expect(refreshResponse.status).toBe(401);
    expect(refreshResponse.body.success).toBe(false);
  });
});

describe('AUTHORIZATION & OWNERSHIP', () => {
  it('should prevent cross-student data access', async () => {
    // Create two users
    const password = 'TestPassword123!';
    const hashedPassword = await (await import('bcrypt')).hash(password, 12);
    
    const user1 = await prisma.user.create({
      data: {
        email: 'user1@example.com',
        passwordHash: hashedPassword,
        firstName: 'User',
        lastName: 'One',
        role: 'STUDENT',
        emailVerified: true,
      },
    });

    const student1 = await prisma.studentProfile.create({
      data: {
        userId: user1.id,
        grade: 11,
      },
    });

    const user2 = await prisma.user.create({
      data: {
        email: 'user2@example.com',
        passwordHash: hashedPassword,
        firstName: 'User',
        lastName: 'Two',
        role: 'STUDENT',
        emailVerified: true,
      },
    });

    const student2 = await prisma.studentProfile.create({
      data: {
        userId: user2.id,
        grade: 10,
      },
    });

    // Login as user1
    const loginResponse = await request(app)
      .post('/api/v1/auth/login')
      .send({
        email: 'user1@example.com',
        password,
      });

    const { accessToken } = loginResponse.body.data.tokens;

    // Try to access user2's data
    const response = await request(app)
      .get(`/api/v1/students/${student2.id}`)
      .set('Authorization', `Bearer ${accessToken}`);

    expect(response.status).toBe(403);
    expect(response.body.success).toBe(false);
  });

  it('should allow user to access their own data', async () => {
    const password = 'TestPassword123!';
    const hashedPassword = await (await import('bcrypt')).hash(password, 12);
    
    const user = await prisma.user.create({
      data: {
        email: 'own@example.com',
        passwordHash: hashedPassword,
        firstName: 'Test',
        lastName: 'User',
        role: 'STUDENT',
        emailVerified: true,
      },
    });

    const student = await prisma.studentProfile.create({
      data: {
        userId: user.id,
        grade: 11,
      },
    });

    const loginResponse = await request(app)
      .post('/api/v1/auth/login')
      .send({
        email: 'own@example.com',
        password,
      });

    const { accessToken } = loginResponse.body.data.tokens;

    const response = await request(app)
      .get(`/api/v1/students/${student.id}`)
      .set('Authorization', `Bearer ${accessToken}`);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
  });
});
