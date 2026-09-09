import rateLimit from 'express-rate-limit';
import { Request, Response } from 'express';
import { getSecurityConfig } from '../config/security.js';

export class RateLimiter {
  static getDefaultLimiter() {
    const config = getSecurityConfig().rateLimit;
    
    return rateLimit({
      windowMs: config.windowMs,
      max: config.max,
      keyGenerator: (req: Request) => {
        // Use IP + user ID if available for better rate limiting
        const userId = (req as any).userId || 'anonymous';
        return `${req.ip}:${userId}`;
      },
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
        // Skip rate limiting for health checks
        return req.path === '/health';
      },
    });
  }

  static getAuthLimiter() {
    const config = getSecurityConfig().rateLimit;
    
    return rateLimit({
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
    });
  }

  static getAILimiter() {
    return rateLimit({
      windowMs: 60 * 1000, // 1 minute
      max: 20, // 20 AI requests per minute
      keyGenerator: (req: Request) => {
        const userId = (req as any).userId || 'anonymous';
        return `${req.ip}:${userId}`;
      },
      handler: (req: Request, res: Response) => {
        res.status(429).json({
          success: false,
          error: {
            code: 'AI_RATE_LIMIT_EXCEEDED',
            message: 'Too many AI requests, please try again later.',
          },
        });
      },
    });
  }

  static getSessionLimiter() {
    return rateLimit({
      windowMs: 60 * 1000, // 1 minute
      max: 30, // 30 session requests per minute
      keyGenerator: (req: Request) => {
        const userId = (req as any).userId || 'anonymous';
        return `${req.ip}:${userId}`;
      },
    });
  }
}
