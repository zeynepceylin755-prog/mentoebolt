import { getEnv } from './environment.js';

export interface SecurityConfig {
  jwt: {
    secret: string;
    expiresIn: string;
    refreshSecret: string;
    refreshExpiresIn: string;
    issuer: string;
    audience: string;
  };
  cors: {
    allowedOrigins: string[];
    allowedMethods: string[];
    allowedHeaders: string[];
    exposedHeaders: string[];
    maxAge: number;
    credentials: boolean;
  };
  rateLimit: {
    windowMs: number;
    max: number;
    skipFailedRequests: boolean;
    skipSuccessfulRequests: boolean;
  };
  securityHeaders: {
    contentSecurityPolicy: boolean;
    hsts: boolean;
    noSniff: boolean;
    xssProtection: boolean;
    frameOptions: boolean;
    referrerPolicy: boolean;
  };
  input: {
    maxBodySize: string;
    maxUrlLength: number;
    maxParameterCount: number;
  };
}

/**
 * Resolve the CORS allowlist from the (plural) production variable and the
 * (singular) legacy/test variable. The plural form wins when both are present.
 * Pure and side-effect free so it can be unit-tested directly.
 */
export function resolveAllowedOrigins(
  plural: string | undefined,
  singular: string | undefined
): string[] {
  const raw = plural && plural.trim().length > 0 ? plural : singular;
  if (!raw || raw.trim().length === 0) {
    return ['http://localhost:5173'];
  }
  return raw
    .split(',')
    .map((o) => o.trim())
    .filter((o) => o.length > 0);
}

export function getSecurityConfig(): SecurityConfig {
  const env = getEnv();

  return {
    jwt: {
      secret: env.JWT_SECRET,
      expiresIn: env.JWT_EXPIRES_IN || '15m',
      refreshSecret: env.JWT_REFRESH_SECRET,
      refreshExpiresIn: env.JWT_REFRESH_EXPIRES_IN || '7d',
      issuer: 'mentora.ai',
      audience: 'mentora-api',
    },
    cors: {
      // Phase 7.3: prefer the production plural CORS_ORIGINS, fall back to the
      // historical singular CORS_ORIGIN, then to the local development origin.
      allowedOrigins: resolveAllowedOrigins(env.CORS_ORIGINS, env.CORS_ORIGIN),
      allowedMethods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
      allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Request-ID',
      'X-Requested-With',
      // Phase 6.7: the student client legitimately sends these on the upload and
      // idempotent-attempt paths. Without them a browser preflight would reject
      // the request, silently disabling idempotency/upload in the real UI.
      'Idempotency-Key',
      'X-Upload-Filename',
    ],
      exposedHeaders: ['X-RateLimit-Limit', 'X-RateLimit-Remaining', 'X-RateLimit-Reset'],
      maxAge: 86400,
      credentials: true,
    },
    rateLimit: {
      windowMs: Number(env.RATE_LIMIT_WINDOW_MS) || 900000,
      max: Number(env.RATE_LIMIT_MAX_REQUESTS) || 100,
      skipFailedRequests: false,
      skipSuccessfulRequests: false,
    },
    securityHeaders: {
      contentSecurityPolicy: true,
      hsts: true,
      noSniff: true,
      xssProtection: true,
      frameOptions: true,
      referrerPolicy: true,
    },
    input: {
      maxBodySize: '10mb',
      maxUrlLength: 2048,
      maxParameterCount: 100,
    },
  };
}
