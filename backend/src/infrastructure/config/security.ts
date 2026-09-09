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
      allowedOrigins: env.CORS_ORIGIN ? env.CORS_ORIGIN.split(',') : ['http://localhost:5173'],
      allowedMethods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID', 'X-Requested-With'],
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
