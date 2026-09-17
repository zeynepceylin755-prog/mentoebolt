import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

import bootstrap from '../../src/index.js';
import { prisma } from '../setup.js';

describe('Auth API Integration', () => {
  let app: express.Application;

  beforeAll(async () => {
    app = await bootstrap();
  });

  beforeEach(async () => {
    // Clean database before each test using the global setup's prisma
    try {
      await prisma.questionAttempt.deleteMany({});
      await prisma.learningSessionQuestion.deleteMany({});
      await prisma.learningSession.deleteMany({});
      await prisma.studentProfile.deleteMany({});
      await prisma.user.deleteMany({});
      await prisma.question.deleteMany({});
      await prisma.assessment.deleteMany({});
      await prisma.refreshToken.deleteMany({});
      await prisma.session.deleteMany({});
    } catch (error) {
      // Ignore errors if tables don't exist
    }
  });

  afterAll(async () => {
    // No cleanup needed - global setup handles disconnect
  });

  describe('POST /auth/register', () => {
    it('should register a new user', async () => {
      const email = `user${Date.now()}@example.com`;
      const response = await request(app)
        .post('/api/v1/auth/register')
        .send({
          email,
          password: 'Test123!@#',
          firstName: 'Test',
          lastName: 'User',
          grade: 11,
        });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data.user).toBeDefined();
      expect(response.body.data.user.email).toBe(email);
    });

    it('should fail with invalid email', async () => {
      const response = await request(app)
        .post('/api/v1/auth/register')
        .send({
          email: 'invalid-email',
          password: 'Test123!@#',
          firstName: 'Test',
          lastName: 'User',
          grade: 11,
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });

    it('should fail with weak password', async () => {
      const response = await request(app)
        .post('/api/v1/auth/register')
        .send({
          email: `weak${Date.now()}@example.com`,
          password: 'weak',
          firstName: 'Test',
          lastName: 'User',
          grade: 11,
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });
  });

  describe('POST /auth/login', () => {
    let testEmail: string;
    const testPassword = 'Test123!@#';

    beforeEach(async () => {
      // Register a test user before each login test
      testEmail = `login${Date.now()}@example.com`;
      await request(app)
        .post('/api/v1/auth/register')
        .send({
          email: testEmail,
          password: testPassword,
          firstName: 'Login',
          lastName: 'Test',
          grade: 11,
        });
    });

    it('should login successfully', async () => {
      const response = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: testEmail,
          password: testPassword,
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.tokens).toBeDefined();
      expect(response.body.data.tokens.accessToken).toBeDefined();
    });

    it('should fail with wrong password', async () => {
      const response = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: testEmail,
          password: 'WrongPassword123!',
        });

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
    });

    it('should fail with non-existent email', async () => {
      const response = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: 'nonexistent@example.com',
          password: testPassword,
        });

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
    });
  });

  describe('POST /auth/logout', () => {
    it('should logout successfully with authentication', async () => {
      // First register and login
      const email = `logout${Date.now()}@example.com`;
      const password = 'Test123!@#';
      await request(app)
        .post('/api/v1/auth/register')
        .send({
          email,
          password,
          firstName: 'Logout',
          lastName: 'Test',
          grade: 11,
        });

      const loginResponse = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email,
          password,
        });

      const accessToken = loginResponse.body.data.tokens.accessToken;

      // Now logout with authentication
      const logoutResponse = await request(app)
        .post('/api/v1/auth/logout')
        .set('Authorization', `Bearer ${accessToken}`);

      expect(logoutResponse.status).toBe(200);
      expect(logoutResponse.body.success).toBe(true);
    });

    it('should fail logout without authentication', async () => {
      const response = await request(app)
        .post('/api/v1/auth/logout');

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
    });
  });
});
