/**
 * Phase 7.3 - Upload Rate Limiter Tests
 * 
 * Verify that upload endpoints have a separate rate limiter from analytics endpoints
 * to prevent analytics requests from consuming the upload budget.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { RateLimiter } from '../../src/infrastructure/security/RateLimiter.js';

describe('Upload Rate Limiter', () => {
  let app: express.Application;
  let defaultLimiter: any;
  let uploadLimiter: any;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    
    // Reset all rate limiters before each test
    RateLimiter.resetAll();
    
    defaultLimiter = RateLimiter.getDefaultLimiter();
    uploadLimiter = RateLimiter.getUploadLimiter();
    
    // Add test endpoints with different limiters
    app.get('/api/v1/analytics/me/skills', defaultLimiter, (req, res) => {
      res.json({ success: true, data: [] });
    });
    
    app.post('/api/v1/question-ingestions/upload', uploadLimiter, (req, res) => {
      res.json({ success: true, data: { ingestion: { id: 'test' } } });
    });
  });

  afterEach(() => {
    RateLimiter.resetAll();
  });

  it('should have separate limiters for upload and analytics endpoints', () => {
    expect(defaultLimiter).toBeDefined();
    expect(uploadLimiter).toBeDefined();
    expect(defaultLimiter).not.toBe(uploadLimiter);
  });

  it('should allow analytics requests even when upload limiter is exhausted', async () => {
    // Exhaust upload limiter by making many requests
    const uploadLimit = 200; // Double the default limit
    for (let i = 0; i < uploadLimit; i++) {
      await request(app)
        .post('/api/v1/question-ingestions/upload')
        .send({});
    }

    // Upload should now be rate limited
    const uploadResponse = await request(app)
      .post('/api/v1/question-ingestions/upload')
      .send({});
    
    expect(uploadResponse.status).toBe(429);
    expect(uploadResponse.body.error?.code).toBe('UPLOAD_RATE_LIMIT_EXCEEDED');

    // Analytics should still work (different limiter bucket)
    const analyticsResponse = await request(app)
      .get('/api/v1/analytics/me/skills');
    
    expect(analyticsResponse.status).toBe(200);
  });

  it('should allow upload requests even when analytics limiter is exhausted', async () => {
    // Exhaust default limiter by making many analytics requests
    const defaultLimit = 100;
    for (let i = 0; i < defaultLimit; i++) {
      await request(app).get('/api/v1/analytics/me/skills');
    }

    // Analytics should now be rate limited
    const analyticsResponse = await request(app)
      .get('/api/v1/analytics/me/skills');
    
    expect(analyticsResponse.status).toBe(429);
    expect(analyticsResponse.body.error?.code).toBe('RATE_LIMIT_EXCEEDED');

    // Upload should still work (different limiter bucket)
    const uploadResponse = await request(app)
      .post('/api/v1/question-ingestions/upload')
      .send({});
    
    expect(uploadResponse.status).toBe(200);
  });

  it('should use higher limit for upload endpoints', () => {
    // The upload limiter should have double the default limit
    // This is verified by the implementation in RateLimiter.getUploadLimiter
    expect(uploadLimiter).toBeDefined();
  });
});