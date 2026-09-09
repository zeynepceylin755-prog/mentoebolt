import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { PrismaClient } from '@prisma/client';

import bootstrap from '../../src/index.js';

describe('Auth API Integration', () => {
  let app: express.Application;
  let prisma: PrismaClient;

  beforeAll(async () => {
    app = await bootstrap();
    prisma = new PrismaClient();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    // Clean database before each test
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
      const registerResponse = await request(app)
        .post('/api/v1/auth/register')
        .send({
          email: testEmail,
          password: testPassword,
          firstName: 'Login',
          lastName: 'Test',
          grade: 11,
        });

      // Log the register response for debugging
      console.log('Register status:', registerResponse.status);
      console.log('Register body:', registerResponse.body);
    });

    it('should login successfully', async () => {
      const response = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: testEmail,
          password: testPassword,
        });

      console.log('Login response:', response.status, response.body);

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
});
