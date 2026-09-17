import express, { Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import path from 'node:path';
import crypto from 'node:crypto';
import { pinoHttp } from 'pino-http';
import { PrismaClient } from '@prisma/client';

import { getEnv } from './infrastructure/config/environment.js';
import { getSecurityConfig } from './infrastructure/config/security.js';
import { logger } from './infrastructure/logging/logger.js';
import { errorHandler } from './infrastructure/errors/ErrorHandler.js';
import { RateLimiter } from './infrastructure/security/RateLimiter.js';
import { InputSanitizer } from './infrastructure/security/InputSanitizer.js';

// Repositories
import { PrismaUserRepository } from './infrastructure/repositories/PrismaUserRepository.js';
import { PrismaStudentRepository } from './infrastructure/repositories/PrismaStudentRepository.js';
import { PrismaRefreshTokenRepository } from './infrastructure/repositories/PrismaRefreshTokenRepository.js';
import { PrismaSessionRepository } from './infrastructure/repositories/PrismaSessionRepository.js';

// Domain services
import { TokenService } from './domain/services/TokenService.js';
import { PasswordService } from './domain/services/PasswordService.js';

// Application services
import { AuthService } from './application/services/auth/AuthService.js';
import { StudentService } from './application/services/StudentService.js';
import { LearningSessionService } from './application/services/learning/LearningSessionService.js';
import { QuestionAttemptService } from './application/services/learning/QuestionAttemptService.js';
import { MasteryService } from './application/services/learning/MasteryService.js';
import { ProgressService } from './application/services/learning/ProgressService.js';
import { NextLearningActionService } from './application/services/learning/NextLearningActionService.js';
import { AssessmentService } from './application/services/assessment/AssessmentService.js';
import { QuestionIngestionService } from './application/services/ingestion/QuestionIngestionService.js';
import { CurriculumCandidateService } from './application/services/curriculum/CurriculumCandidateService.js';
import { QuestionSkillMappingService } from './application/services/skills/QuestionSkillMappingService.js';
import { QuestionCurriculumMappingService } from './application/services/ingestion/QuestionCurriculumMappingService.js';
import { ReviewQueueService } from './application/services/ingestion/ReviewQueueService.js';
import { MasteryApplicationService } from './application/services/learning/MasteryApplicationService.js';
import { ErrorAnalysisApplicationService } from './application/services/learning/ErrorAnalysisApplicationService.js';

// Analytics services
import { ProgressService as AnalyticsProgressService } from './application/services/analytics/ProgressService.js';
import { AnalyticsService } from './application/services/analytics/AnalyticsService.js';

// AI services
import { AIErrorAnalysisService } from './application/services/ai/AIErrorAnalysisService.js';
import { AIRecommendationService } from './application/services/ai/AIRecommendationService.js';
import { AIExplanationService } from './application/services/ai/AIExplanationService.js';
import { AIServiceFactory } from './infrastructure/ai/AIServiceFactory.js';

// Phase 5E services
import { QuestionAnalysisService } from './application/services/ingestion/QuestionAnalysisService.js';
import { QuestionNormalizationService } from './application/services/ingestion/QuestionNormalizationService.js';
import { createOcrProvider } from './infrastructure/ocr/OcrProviderFactory.js';
import { createQuestionUnderstandingProvider } from './infrastructure/ai/question-understanding/QuestionUnderstandingProviderFactory.js';
import { createErrorAnalysisProvider } from './infrastructure/ai/error-analysis/ErrorAnalysisProviderFactory.js';
import { createExplanationProvider } from './infrastructure/ai/explanation/ExplanationProviderFactory.js';

// Phase 5F.8 (C): upload storage
import { LocalDevStorageProvider } from './infrastructure/storage/LocalDevStorageProvider.js';
import { AssetUploadService } from './application/services/ingestion/AssetUploadService.js';

// Idempotency
import { IdempotencyService } from './infrastructure/idempotency/IdempotencyService.js';

// Controllers
import { AuthController } from './api/controllers/AuthController.js';
import { StudentController } from './api/controllers/StudentController.js';
import { AIController } from './api/controllers/AIController.js';
import { AssessmentController } from './api/controllers/AssessmentController.js';
import { AnalyticsController } from './api/controllers/AnalyticsController.js';
import { QuestionIngestionController } from './api/controllers/QuestionIngestionController.js';
import { AssetUploadController } from './api/controllers/AssetUploadController.js';
import { CurriculumCandidateController } from './api/controllers/CurriculumCandidateController.js';
import { QuestionSkillMappingController } from './api/controllers/QuestionSkillMappingController.js';
import { QuestionAttemptController } from './api/controllers/QuestionAttemptController.js';
import { RecommendationController } from './api/controllers/RecommendationController.js';
import { ReviewController } from './api/controllers/ReviewController.js';

// Middleware
import { AuthMiddleware } from './api/middleware/auth.js';
import { OwnershipGuard } from './api/middleware/ownership.js';

// Routes
import { createAuthRoutes } from './api/routes/authRoutes.js';
import { createStudentRoutes } from './api/routes/studentRoutes.js';
import { createAIRoutes, createCanonicalAIRoutes } from './api/routes/aiRoutes.js';
import { createAssessmentRoutes } from './api/routes/assessmentRoutes.js';
import { createAnalyticsRoutes } from './api/routes/analyticsRoutes.js';
import { createQuestionIngestionRoutes } from './api/routes/questionIngestionRoutes.js';
import { createCurriculumCandidateRoutes } from './api/routes/curriculumCandidateRoutes.js';
import { createQuestionSkillMappingRoutes } from './api/routes/questionSkillMappingRoutes.js';
import { createQuestionAttemptRoutes } from './api/routes/questionAttemptRoutes.js';
import { createRecommendationRoutes } from './api/routes/recommendationRoutes.js';
import { createReviewRoutes } from './api/routes/reviewRoutes.js';
import { createDocsRoutes } from './api/routes/docsRoutes.js';

const prisma = new PrismaClient();

export async function bootstrap() {
  const env = getEnv();
  const securityConfig = getSecurityConfig();
  const app = express();

  // Security headers
  app.use(helmet({
    contentSecurityPolicy: securityConfig.securityHeaders.contentSecurityPolicy,
    hsts: securityConfig.securityHeaders.hsts,
    noSniff: securityConfig.securityHeaders.noSniff,
    xssFilter: securityConfig.securityHeaders.xssProtection,
    frameguard: securityConfig.securityHeaders.frameOptions,
    referrerPolicy: securityConfig.securityHeaders.referrerPolicy,
  }));

  // CORS
  app.use(cors({
    origin: (origin, callback) => {
      const allowedOrigins = securityConfig.cors.allowedOrigins;
      if (!origin || allowedOrigins.includes(origin) || allowedOrigins.includes('*')) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    },
    methods: securityConfig.cors.allowedMethods,
    allowedHeaders: securityConfig.cors.allowedHeaders,
    exposedHeaders: securityConfig.cors.exposedHeaders,
    maxAge: securityConfig.cors.maxAge,
    credentials: securityConfig.cors.credentials,
  }));

  // Request correlation ID (Phase 7.3). A lightweight, dependency-free request
  // id is established once, echoed back on the response (so a client/support can
  // quote it), and reused by the logger. It carries NO student content.
  app.use((req: Request, res: Response, next) => {
    const incoming = req.headers['x-request-id'];
    const requestId =
      typeof incoming === 'string' && incoming.length > 0 && incoming.length <= 128
        ? incoming
        : crypto.randomUUID();
    (req as any).requestId = requestId;
    res.setHeader('X-Request-ID', requestId);
    next();
  });

  // Logging
  app.use(pinoHttp({
    logger,
    customProps: (req: Request) => ({
      requestId: (req as any).requestId || req.headers['x-request-id'] || crypto.randomUUID(),
    }),
    serializers: {
      req: (req) => ({
        method: req.method,
        url: req.url,
        headers: {
          'user-agent': req.headers['user-agent'],
          'x-request-id': req.headers['x-request-id'],
        },
      }),
    },
  }));

  // Body limits
  app.use(express.json({ limit: securityConfig.input.maxBodySize }));
  app.use(express.urlencoded({ extended: true, limit: securityConfig.input.maxBodySize }));

  // Input sanitization
  app.use((req: Request, res: Response, next) => {
    if (req.body && typeof req.body === 'object') {
      for (const [key, value] of Object.entries(req.body)) {
        if (typeof value === 'string') {
          req.body[key] = InputSanitizer.sanitizeString(value);
        }
      }
    }
    next();
  });

  // Phase 7.3 — liveness vs readiness.
  //
  // LIVENESS (`/health/live`): "is the process alive?". No dependency checks, no
  // database work, never mutates anything. A failure here means the process is
  // wedged and should be restarted.
  //
  // READINESS (`/health/ready`): "can this instance safely serve requests?". It
  // verifies only the one dependency that matters for serving traffic (the
  // database) with a trivial, read-only `SELECT 1`. It never triggers an AI call
  // and never writes. A failure means "do not send me traffic yet".
  //
  // The historical `/health` endpoint is preserved unchanged as the readiness
  // check, so existing probes/monitoring keep working.
  app.get('/health/live', (_req: Request, res: Response) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  const readinessCheck = async (req: Request, res: Response) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      res.json({
        status: 'ok',
        database: 'connected',
        timestamp: new Date().toISOString(),
        environment: env.NODE_ENV,
      });
    } catch {
      // Never leak the underlying database error to an unauthenticated probe.
      res.status(503).json({
        status: 'error',
        database: 'disconnected',
        timestamp: new Date().toISOString(),
      });
    }
  };

  app.get('/health', readinessCheck);
  app.get('/health/ready', readinessCheck);

  // Repositories
  const userRepository = new PrismaUserRepository(prisma);
  const studentRepository = new PrismaStudentRepository(prisma);
  const refreshTokenRepository = new PrismaRefreshTokenRepository(prisma);
  const sessionRepository = new PrismaSessionRepository(prisma);

  // Domain services
  const tokenService = new TokenService();
  const passwordService = new PasswordService();

  // AI provider
  const aiProvider = AIServiceFactory.getInstance().getProvider();

  // Phase 5F.8 (C): local development storage. Files land outside Prisma, under
  // a configurable directory (UPLOAD_DIR). Real OCR reads bytes through this
  // abstraction, never the filesystem directly.
  const storageProvider = new LocalDevStorageProvider(
    resolveUploadDir((env as any).UPLOAD_DIR)
  );

  // Phase 5E providers. Phase 5F.9-A: OCR is selected by configuration
  // (OCR_PROVIDER, safe default 'mock'); Question Understanding remains MOCK in
  // this phase. A misconfigured real provider fails fast at startup.
  const ocrProvider = createOcrProvider(storageProvider);
  // Phase 5F.9-B: Question Understanding is likewise selected by configuration
  // (QUESTION_UNDERSTANDING_PROVIDER, safe default 'mock'); a misconfigured real
  // provider fails fast at startup.
  const questionUnderstandingProvider = createQuestionUnderstandingProvider();
  // Phase 5F.9-C: Error Analysis is likewise selected configuration
  // (ERROR_ANALYSIS_PROVIDER, safe default 'mock'). A misconfigured real provider
  // fails fast at startup — it is never silently downgraded to mock.
  const errorAnalysisProvider = createErrorAnalysisProvider();
  // Phase 5F.9-D: Explanation / Hint provider selection (EXPLANATION_PROVIDER,
  // safe default 'mock'). This provider is answer-suppressing by construction —
  // the canonical answer is never part of its request contract. A misconfigured
  // real provider fails fast at startup rather than degrading to mock.
  const explanationProvider = createExplanationProvider();
  const normalizationService = new QuestionNormalizationService();

  // Idempotency
  const idempotencyService = new IdempotencyService(prisma);

  // Application services
  const authService = new AuthService(
    userRepository,
    studentRepository,
    refreshTokenRepository,
    sessionRepository,
    tokenService,
    passwordService
  );
  const studentService = new StudentService(studentRepository, userRepository);
  const learningSessionService = new LearningSessionService(prisma, studentRepository);
  const questionAttemptService = new QuestionAttemptService(prisma);
  const masteryService = new MasteryService(prisma);
  const progressService = new ProgressService(prisma);
  const nextActionService = new NextLearningActionService(prisma);
  // Phase 5F.3: mastery application owns its own transaction; it is invoked
  // after a QuestionAttempt is persisted (see AssessmentService.submitAnswer).
  const masteryApplicationService = new MasteryApplicationService(prisma);
  // Phase 5F.4: attempt-level error analysis, invoked after the attempt commits.
  const errorAnalysisApplicationService = new ErrorAnalysisApplicationService(
    prisma,
    new AIErrorAnalysisService(errorAnalysisProvider)
  );
  const assessmentService = new AssessmentService(
    prisma,
    idempotencyService,
    masteryApplicationService,
    errorAnalysisApplicationService
  );
  const questionIngestionService = new QuestionIngestionService(prisma, idempotencyService);

  const maxUploadBytes = Number((env as any).MAX_UPLOAD_BYTES) || 7 * 1024 * 1024;
  const assetUploadService = new AssetUploadService(storageProvider, maxUploadBytes);

  const curriculumCandidateService = new CurriculumCandidateService(prisma, idempotencyService);
  const questionSkillMappingService = new QuestionSkillMappingService(prisma, idempotencyService);
  const reviewQueueService = new ReviewQueueService(prisma);

  // Phase 5F.2 orchestration: candidate/mapping artefacts are applied after the
  // analysis transaction commits, each through its own service transaction.
  const questionCurriculumMappingService = new QuestionCurriculumMappingService(
    prisma,
    curriculumCandidateService,
    questionSkillMappingService
  );

  // Phase 5E service
  const questionAnalysisService = new QuestionAnalysisService(
    prisma,
    idempotencyService,
    ocrProvider,
    questionUnderstandingProvider,
    normalizationService,
    curriculumCandidateService,
    questionSkillMappingService,
    questionIngestionService,
    questionCurriculumMappingService
  );

  // Analytics services
  const analyticsProgressService = new AnalyticsProgressService(prisma);
  const analyticsService = new AnalyticsService(prisma);

  // AI services
  const errorAnalysisService = new AIErrorAnalysisService(errorAnalysisProvider);
  const recommendationService = new AIRecommendationService(aiProvider);
  const explanationService = new AIExplanationService(explanationProvider);

  // Middleware
  const authMiddleware = new AuthMiddleware(tokenService, userRepository, sessionRepository);
  const ownershipGuard = new OwnershipGuard(studentRepository);

  // Controllers
  const authController = new AuthController(authService);
  const studentController = new StudentController(studentService);
  const aiController = new AIController(
    errorAnalysisService,
    recommendationService,
    explanationService,
    // Phase 5F.9-E: attempt-scoped explanation resolves its authoritative context
    // (attempt -> PRIMARY MicroSkill -> persisted ErrorAnalysis) server-side from
    // these read-only dependencies; student identity is never taken from the body.
    prisma,
    studentRepository
  );
  const assessmentController = new AssessmentController(assessmentService, studentRepository);
  const analyticsController = new AnalyticsController(
    analyticsProgressService,
    analyticsService,
    studentRepository
  );
  const questionIngestionController = new QuestionIngestionController(
    questionIngestionService,
    questionAnalysisService
  );
  const assetUploadController = new AssetUploadController(
    assetUploadService,
    questionIngestionService
  );
  const curriculumCandidateController = new CurriculumCandidateController(curriculumCandidateService);
  const questionSkillMappingController = new QuestionSkillMappingController(questionSkillMappingService);
  const questionAttemptController = new QuestionAttemptController(
    questionAttemptService,
    masteryApplicationService,
    errorAnalysisApplicationService,
    studentRepository,
    // Phase 6.3: reuses the existing IdempotencyService for the standalone attempt
    // path — no second, competing idempotency mechanism is introduced.
    idempotencyService,
    // Phase 7.4: read-only curriculum label resolution for the student attempt view.
    prisma
  );
  const recommendationController = new RecommendationController(
    nextActionService,
    studentRepository
  );
  const reviewController = new ReviewController(reviewQueueService);

  // Rate limiters
  const defaultLimiter = RateLimiter.getDefaultLimiter();
  const authLimiter = RateLimiter.getAuthLimiter();
  const aiLimiter = RateLimiter.getAILimiter();

  // Phase 5F.8 / A4 — rate limiter ordering.
  // The limiters below are mounted AHEAD of the routers that run
  // `authMiddleware.authenticate`. Without a principal resolver, `req.userId`
  // would always be unset at limiter time and user-keyed limiting would collapse
  // to anonymous/IP behaviour. `resolvePrincipalOptional` populates the principal
  // from a valid token when present and never rejects, so:
  //   - authenticated requests are keyed by user,
  //   - unauthenticated requests keep IP-based protection,
  //   - access control still comes from `authenticate` on each router.
  // The auth limiter is intentionally NOT preceded by this: login/register are
  // unauthenticated and remain keyed by IP + email.
  app.use('/api/v1', authMiddleware.resolvePrincipalOptional, (req, res, next) => next());

  // Routes
  app.use('/api/v1/auth', authLimiter, createAuthRoutes(authController, authMiddleware));
  app.use('/api/v1', defaultLimiter, createStudentRoutes(studentController, authMiddleware, ownershipGuard));
  // Phase 5F.9-E: canonical single-prefix AI routes (`/api/v1/ai/explanation`,
  // `/api/v1/ai/analyze-error`, `/api/v1/ai/recommendation`) are mounted FIRST as
  // additive aliases. The historical doubled path (`/api/v1/ai/ai/explanation`) is
  // still served below, so no existing client breaks.
  app.use('/api/v1/ai', aiLimiter, createCanonicalAIRoutes(aiController, authMiddleware));
  app.use('/api/v1/ai', aiLimiter, createAIRoutes(aiController, authMiddleware));
  app.use('/api/v1', defaultLimiter, createAssessmentRoutes(assessmentController, authMiddleware, ownershipGuard));
  app.use('/api/v1', defaultLimiter, createQuestionIngestionRoutes(questionIngestionController, authMiddleware, assetUploadController));
  app.use('/api/v1', defaultLimiter, createCurriculumCandidateRoutes(curriculumCandidateController, authMiddleware));
  app.use('/api/v1', defaultLimiter, createQuestionSkillMappingRoutes(questionSkillMappingController, authMiddleware));
  app.use('/api/v1', defaultLimiter, createQuestionAttemptRoutes(questionAttemptController, authMiddleware));
  app.use('/api/v1', defaultLimiter, createRecommendationRoutes(recommendationController, authMiddleware));
  app.use('/api/v1', defaultLimiter, createReviewRoutes(reviewController, authMiddleware));
  app.use('/api/v1', defaultLimiter, createAnalyticsRoutes(analyticsController, authMiddleware, ownershipGuard));
  app.use('/api/v1', defaultLimiter, createDocsRoutes());

  // Error handler (must be last)
  app.use(errorHandler);

  return app;
}

/**
 * Resolve the upload directory. Relative paths are rooted at the process CWD so
 * the behaviour is deterministic regardless of where the server is started.
 * Defaults to `uploads` when unset.
 */
function resolveUploadDir(configured?: string): string {
  const dir = configured && configured.trim().length > 0 ? configured : 'uploads';
  return path.isAbsolute(dir) ? dir : path.resolve(process.cwd(), dir);
}

// Only start the server outside of tests
if (process.env.NODE_ENV !== 'test') {
  const env = getEnv();
  const port = Number(env.PORT);

  bootstrap().then((app) => {
    const server = app.listen(port, () => {
      logger.info(`🚀 MENTORA Backend running on port ${port} in ${env.NODE_ENV} mode`);
    });

    // Phase 7.3 — bounded, idempotent graceful shutdown.
    //  1. stop accepting new connections,
    //  2. let in-flight requests finish,
    //  3. close the database,
    //  4. exit cleanly — or force-exit after a hard bound so a stuck request can
    //     never block termination indefinitely.
    const SHUTDOWN_TIMEOUT_MS = 30000;
    let shuttingDown = false;

    const shutdown = async (signal: string) => {
      if (shuttingDown) {
        return;
      }
      shuttingDown = true;
      logger.info({ signal }, 'Shutting down gracefully...');

      const forceExit = setTimeout(() => {
        logger.error('Graceful shutdown timed out; forcing exit');
        process.exit(1);
      }, SHUTDOWN_TIMEOUT_MS);
      // Do not keep the event loop alive just for the timer.
      forceExit.unref?.();

      server.close(async () => {
        try {
          await prisma.$disconnect();
        } catch (error) {
          logger.error({ error }, 'Error while closing database connections');
        }
        logger.info('Server closed');
        process.exit(0);
      });
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
  }).catch(async (error) => {
    logger.error({ error }, 'Failed to start application');
    await prisma.$disconnect();
    process.exit(1);
  });
}

export default bootstrap;
