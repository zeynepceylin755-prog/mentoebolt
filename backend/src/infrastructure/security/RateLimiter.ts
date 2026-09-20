import rateLimit, { type RateLimitRequestHandler } from 'express-rate-limit';
import { Request, Response } from 'express';
import { getSecurityConfig } from '../config/security.js';

export class RateLimiter {
  /**
   * Phase 7.3 — every limiter instance created here is tracked so tests can
   * reset their in-memory counters between files. Without this, the per-process
   * store accumulates across sequential test files sharing a fork and a later
   * file can be spuriously rate-limited (the known full-suite flake). Production
   * behaviour is unchanged; this only adds a test-facing reset hook.
   */
  private static readonly instances: RateLimitRequestHandler[] = [];

  private static track<T extends RateLimitRequestHandler>(limiter: T): T {
    RateLimiter.instances.push(limiter);
    return limiter;
  }

  /**
   * Reset the in-memory counters of every limiter created by this process.
   * Intended for test isolation; safe to call at any time.
   */
  static resetAll(): void {
    for (const limiter of RateLimiter.instances) {
      const local = (limiter as any).local;
      if (local && typeof local.resetAll === 'function') {
        local.resetAll();
      }
    }
  }

  static getDefaultLimiter() {
    const config = getSecurityConfig().rateLimit;

    return RateLimiter.track(rateLimit({
      windowMs: config.windowMs,
      max: config.max,
      keyGenerator: (req: Request) => {
        // Phase 5F.8 / A4: `req.userId` is populated by the principal resolver
        // that runs BEFORE the limiter, so an authenticated request is keyed to
        // its user; an unauthenticated one stays IP-keyed. This keys per user
        // (not IP:user) so one user cannot escape their budget by rotating IPs.
        const userId = (req as any).userId;
        return userId ? `user:${userId}` : `ip:${req.ip}`;
      },
      validate: { trustProxy: false },
      handler: (req: Request, res: Response) => {
        res.status(429).json({
          success: false,
          error: {
            code: 'RATE_LIMIT_EXCEEDED',
            message: 'Too many requests, please try again later.',
          },
        });
      },
      skip: (req: Request) => {
        // Skip rate limiting for every health/liveness/readiness probe so an
        // orchestrator's frequent checks never consume a user's budget or trip
        // the limiter (Phase 7.3).
        return (
          req.path === '/health' ||
          req.path === '/health/live' ||
          req.path === '/health/ready'
        );
      },
    }));
  }

  static getAuthLimiter() {
    const config = getSecurityConfig().rateLimit;

    return RateLimiter.track(rateLimit({
      windowMs: 15 * 60 * 1000, // 15 minutes
      max: 10, // 10 attempts per 15 minutes
      keyGenerator: (req: Request) => {
        // Rate limit by email for auth endpoints
        const email = req.body?.email || 'unknown';
        return `${req.ip}:${email}`;
      },
      handler: (req: Request, res: Response) => {
        res.status(429).json({
          success: false,
          error: {
            code: 'RATE_LIMIT_EXCEEDED',
            message: 'Too many authentication attempts, please try again later.',
          },
        });
      },
    }));
  }

  static getAILimiter() {
    return RateLimiter.track(rateLimit({
      windowMs: 60 * 1000, // 1 minute
      max: 20, // 20 AI requests per minute
      keyGenerator: (req: Request) => {
        // See getDefaultLimiter: principal resolved before the limiter (A4).
        const userId = (req as any).userId;
        return userId ? `user:${userId}` : `ip:${req.ip}`;
      },
      validate: { trustProxy: false },
      handler: (req: Request, res: Response) => {
        res.status(429).json({
          success: false,
          error: {
            code: 'AI_RATE_LIMIT_EXCEEDED',
            message: 'Too many AI requests, please try again later.',
          },
        });
      },
    }));
  }

  static getSessionLimiter() {
    return RateLimiter.track(rateLimit({
      windowMs: 60 * 1000, // 1 minute
      max: 30, // 30 session requests per minute
      keyGenerator: (req: Request) => {
        const userId = (req as any).userId;
        return userId ? `user:${userId}` : `ip:${req.ip}`;
      },
      validate: { trustProxy: false },
    }));
  }

  /**
   * Phase 7.3 - Upload-specific rate limiter.
   * Upload endpoints are more request-intensive during analysis workflows.
   * Separate from default limiter to prevent analytics requests from consuming
   * the upload budget and vice versa.
   */
  static getUploadLimiter() {
    const config = getSecurityConfig().rateLimit;

    return RateLimiter.track(rateLimit({
      windowMs: config.windowMs,
      max: config.max * 2, // Double the default limit for upload workflows
      keyGenerator: (req: Request) => {
        // Phase 5F.8 / A4: same user-keyed strategy as default limiter
        const userId = (req as any).userId;
        return userId ? `user:${userId}:upload` : `ip:${req.ip}:upload`;
      },
      validate: { trustProxy: false },
      handler: (req: Request, res: Response) => {
        res.status(429).json({
          success: false,
          error: {
            code: 'UPLOAD_RATE_LIMIT_EXCEEDED',
            message: 'Too many upload requests, please try again later.',
          },
        });
      },
      skip: (req: Request) => {
        // Skip rate limiting for health probes
        return (
          req.path === '/health' ||
          req.path === '/health/live' ||
          req.path === '/health/ready'
        );
      },
    }));
  }
}
