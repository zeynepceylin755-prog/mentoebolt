import { getEnv } from './environment.js';

export const prodConfig = {
  app: {
    name: process.env.APP_NAME || 'mentora-backend',
    version: process.env.APP_VERSION || '1.0.0',
    env: 'production',
    port: parseInt(process.env.PORT || '3000'),
    host: '0.0.0.0',
  },
  database: {
    url: process.env.DATABASE_URL!,
    pool: {
      min: parseInt(process.env.DATABASE_POOL_MIN || '2'),
      max: parseInt(process.env.DATABASE_POOL_MAX || '10'),
      idleTimeout: parseInt(process.env.DATABASE_POOL_IDLE_TIMEOUT || '30000'),
      connectionTimeout: parseInt(process.env.DATABASE_CONNECTION_TIMEOUT || '5000'),
    },
  },
  jwt: {
    secret: process.env.JWT_SECRET!,
    expiresIn: process.env.JWT_EXPIRES_IN || '15m',
    refreshSecret: process.env.JWT_REFRESH_SECRET!,
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
  },
  cors: {
    origins: process.env.CORS_ORIGINS ? process.env.CORS_ORIGINS.split(',') : [],
  },
  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000'),
    max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100'),
  },
  authRateLimit: {
    windowMs: parseInt(process.env.AUTH_RATE_LIMIT_WINDOW_MS || '900000'),
    max: parseInt(process.env.AUTH_RATE_LIMIT_MAX_REQUESTS || '10'),
  },
  ai: {
    provider: process.env.AI_PROVIDER || 'mock',
    timeout: parseInt(process.env.AI_TIMEOUT || '30000'),
    maxRetries: parseInt(process.env.AI_MAX_RETRIES || '3'),
    maxTokens: parseInt(process.env.AI_MAX_TOKENS || '4000'),
    temperature: parseFloat(process.env.AI_TEMPERATURE || '0.7'),
  },
  redis: {
    url: process.env.REDIS_URL,
    prefix: process.env.REDIS_PREFIX || 'mentora',
    ttl: parseInt(process.env.REDIS_TTL || '3600'),
  },
  logging: {
    level: process.env.LOG_LEVEL || 'info',
    format: process.env.LOG_FORMAT || 'json',
  },
  features: {
    enableAI: process.env.ENABLE_AI !== 'false',
    enableAnalytics: process.env.ENABLE_ANALYTICS !== 'false',
    enableEmail: process.env.ENABLE_EMAIL !== 'false',
    enableCache: process.env.ENABLE_CACHE !== 'false',
    enableQueue: process.env.ENABLE_QUEUE !== 'false',
  },
  security: {
    bcryptRounds: parseInt(process.env.BCRYPT_ROUNDS || '12'),
    maxLoginAttempts: parseInt(process.env.MAX_LOGIN_ATTEMPTS || '5'),
    accountLockDurationMinutes: parseInt(process.env.ACCOUNT_LOCK_DURATION_MINUTES || '15'),
  },
  monitoring: {
    sentryDsn: process.env.SENTRY_DSN,
    healthCheckInterval: parseInt(process.env.HEALTH_CHECK_INTERVAL || '30000'),
    metricsEnabled: process.env.METRICS_ENABLED !== 'false',
    metricsPort: parseInt(process.env.METRICS_PORT || '9090'),
  },
  backup: {
    enabled: process.env.BACKUP_ENABLED !== 'false',
    schedule: process.env.BACKUP_SCHEDULE || '0 2 * * *',
    retentionDays: parseInt(process.env.BACKUP_RETENTION_DAYS || '30'),
    s3Bucket: process.env.BACKUP_S3_BUCKET,
    s3Region: process.env.BACKUP_S3_REGION || 'us-east-1',
    s3Path: process.env.BACKUP_S3_PATH || 'backups/',
  },
};

// Validate required config
export function validateProdConfig(): void {
  const errors: string[] = [];

  if (!process.env.DATABASE_URL) {
    errors.push('DATABASE_URL is required');
  }
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
    errors.push('JWT_SECRET must be at least 32 characters');
  }
  if (!process.env.JWT_REFRESH_SECRET || process.env.JWT_REFRESH_SECRET.length < 32) {
    errors.push('JWT_REFRESH_SECRET must be at least 32 characters');
  }

  if (errors.length > 0) {
    throw new Error(`Production config validation failed:\n${errors.join('\n')}`);
  }
}
