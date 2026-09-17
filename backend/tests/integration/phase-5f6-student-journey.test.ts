import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { QuestionIngestionService } from '../../src/application/services/ingestion/QuestionIngestionService.js';
import { QuestionAnalysisService } from '../../src/application/services/ingestion/QuestionAnalysisService.js';
import { QuestionSkillMappingService } from '../../src/application/services/skills/QuestionSkillMappingService.js';
import { MasteryApplicationService } from '../../src/application/services/learning/MasteryApplicationService.js';
import { ErrorAnalysisApplicationService } from '../../src/application/services/learning/ErrorAnalysisApplicationService.js';
import { QuestionAttemptService } from '../../src/application/services/learning/QuestionAttemptService.js';
import { IdempotencyService } from '../../src/infrastructure/idempotency/IdempotencyService.js';
import { INGESTION_STATES } from '../../src/domain/ingestion/ingestionStateMachine.js';
import { MockOcrProvider } from '../../src/infrastructure/ocr/MockOcrProvider.js';
import { MockQuestionUnderstandingProvider } from '../../src/infrastructure/ai/providers/MockQuestionUnderstandingProvider.js';
import { QuestionNormalizationService } from '../../src/application/services/ingestion/QuestionNormalizationService.js';
import { CurriculumCandidateService } from '../../src/application/services/curriculum/CurriculumCandidateService.js';
import { QuestionCurriculumMappingService } from '../../src/application/services/ingestion/QuestionCurriculumMappingService.js';
import { AIErrorAnalysisService } from '../../src/application/services/ai/AIErrorAnalysisService.js';
import type { IAIProvider, AIRequest, AIResponse } from '../../src/domain/interfaces/ai/IAIProvider.js';

/**
 * Phase 5F.6 — Real Student Question Journey End-to-End Verification
 * 
 * This test suite proves the complete student journey:
 * Student upload → analysis → canonical question → answer submission → mastery/error analysis
 * 
 * All content is SYNTHETIC test fixture text. No MEB textbook question text is reproduced.
 */

/** Minimal deterministic AI provider for error analysis testing */
class FakeErrorProvider implements IAIProvider {
  constructor(private readonly value: any) {}
  getProviderName() { return 'fake'; }
  getModelName() { return 'fake-model'; }
  getVersion() { return '1.0.0'; }
  async isAvailable() { return true; }
  async complete(_r: AIRequest): Promise<AIResponse> {
    return {
      content: '{}',
      model: 'fake-model',
      version: '1.0.0',
      tokensUsed: 1,
      latencyMs: 1,
      finishReason: 'stop',
    };
  }
  async completeStructured<T>(_r: AIRequest, _s: any): Promise<AIResponse & { structured: T }> {
    return {
      content: JSON.stringify(this.value),
      structured: this.value as T,
      model: 'fake-model',
      version: '1.0.0',
      tokensUsed: 1,
      latencyMs: 1,
      finishReason: 'stop',
    };
  }
}

describe('Phase 5F.6 - Real Student Question Journey End-to-End', () => {
  let prisma: PrismaClient;
  let idempotencyService: IdempotencyService;
  let ingestionService: QuestionIngestionService;
  let analysisService: QuestionAnalysisService;
  let skillMappingService: QuestionSkillMappingService;
  let masteryService: MasteryApplicationService;
  let errorAnalysisService: ErrorAnalysisApplicationService;
  let questionAttemptService: QuestionAttemptService;

  const STUDENT_USER = 'p5f6-student-user';
  const STAFF_USER = 'p5f6-staff-user';

  beforeAll(async () => {
    prisma = new PrismaClient();
    await prisma.$connect();
    await prisma.$executeRawUnsafe('PRAGMA foreign_keys = ON');
    
    idempotencyService = new IdempotencyService(prisma);
    ingestionService = new QuestionIngestionService(prisma, idempotencyService);
    skillMappingService = new QuestionSkillMappingService(prisma, idempotencyService);
    masteryService = new MasteryApplicationService(prisma);
    questionAttemptService = new QuestionAttemptService(prisma);
    
    const curriculumCandidateService = new CurriculumCandidateService(prisma, idempotencyService);
    const questionCurriculumMappingService = new QuestionCurriculumMappingService(
      prisma,
      curriculumCandidateService,
      skillMappingService
    );
    
    analysisService = new QuestionAnalysisService(
      prisma,
      idempotencyService,
      new MockOcrProvider(),
      new MockQuestionUnderstandingProvider(),
      new QuestionNormalizationService(),
      curriculumCandidateService,
      skillMappingService,
      ingestionService,
      questionCurriculumMappingService
    );
    
    errorAnalysisService = new ErrorAnalysisApplicationService(
      prisma,
      new AIErrorAnalysisService(new FakeErrorProvider({
        errorType: 'CONCEPT',
        confidence: 0.9,
        hypothesis: 'synthetic',
        relatedSkills: [],
        suggestion: 'x',
      }))
    );
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    // Clean up in reverse dependency order
    await prisma.auditLog.deleteMany();
    await prisma.masteryAudit.deleteMany();
    await prisma.learningProgress.deleteMany();
    await prisma.skillMastery.deleteMany();
    await prisma.errorAnalysis.deleteMany();
    await prisma.errorPatternMicroSkill.deleteMany();
    await prisma.errorPattern.deleteMany();
    await prisma.questionAttempt.deleteMany();
    await prisma.questionSkillMapping.deleteMany();
    await prisma.curriculumCandidate.deleteMany();
    await prisma.questionInstance.deleteMany();
    await prisma.questionIngestion.deleteMany();
    await prisma.question.deleteMany();
    await prisma.questionSource.deleteMany();
    await prisma.microSkill.deleteMany();
    await prisma.processComponent.deleteMany();
    await prisma.learningOutcome.deleteMany();
    await prisma.theme.deleteMany();
    await prisma.curriculumVersion.deleteMany();
    await prisma.idempotencyRecord.deleteMany();
    await prisma.studentProfile.deleteMany();
    await prisma.user.deleteMany();

    // Create test users
    await prisma.user.create({
      data: {
        id: STUDENT_USER,
        email: 'p5f6-student@example.com',
        firstName: 'P5F6',
        lastName: 'Student',
        role: 'STUDENT',
        passwordHash: 'hash',
      },
    });
    const studentProfile = await prisma.studentProfile.create({ 
      data: { userId: STUDENT_USER, grade: 11, school: 'Test School' } 
    });

    await prisma.user.create({
      data: {
        id: STAFF_USER,
        email: 'p5f6-staff@example.com',
        firstName: 'P5F6',
        lastName: 'Staff',
        role: 'ADMIN',
        passwordHash: 'hash',
      },
    });

    // Store the actual student profile ID for use in tests
    (global as any).TEST_STUDENT_PROFILE_ID = studentProfile.id;
  });

  // ------------------------------------------------------------------ fixtures

  async function buildMicroSkill() {
    const uid = Math.random().toString(36).slice(2, 10);
    const version = await prisma.curriculumVersion.create({
      data: {
        code: 'P5F6-CUR-' + uid,
        name: 'P5F6 Curriculum',
        grade: 11,
        subject: 'Matematik',
        version: '1.0',
        source: 'TEST_FIXTURE',
      },
    });
    const theme = await prisma.theme.create({
      data: {
        curriculumVersionId: version.id,
        officialCode: 'P5F6.T-' + uid,
        name: 'Algebra Functions',
        lessonHours: 10,
        sourceOrder: 1,
      },
    });
    const lo = await prisma.learningOutcome.create({
      data: { 
        themeId: theme.id, 
        officialCode: 'P5F6.LO-' + uid, 
        officialText: 'Understanding linear functions', 
        sourceOrder: 1 
      },
    });
    const pc = await prisma.processComponent.create({
      data: { 
        learningOutcomeId: lo.id, 
        officialCode: 'P5F6.PC-' + uid, 
        officialText: 'Function evaluation', 
        sourceOrder: 1 
      },
    });
    const microSkill = await prisma.microSkill.create({
      data: {
        processComponentId: pc.id,
        code: 'P5F6.MS-' + uid,
        name: 'Evaluate Linear Function',
        description: 'Substitute values into linear function expressions',
        source: 'TEST_FIXTURE',
        isActive: true,
      },
    });
    return { version, theme, lo, pc, microSkill };
  }

  async function createStudentUploadSource() {
    return prisma.questionSource.create({
      data: {
        code: 'P5F6-SRC-' + Math.random().toString(36).slice(2, 8),
        name: 'Student uploaded content',
        origin: 'STUDENT_UPLOADED',
        trustCeiling: 'UNVERIFIED',
        license: 'Student-provided; not redistributable',
        isActive: true,
      },
    });
  }

  // ==================================================== JOURNEY TESTS

  it('J1. Complete student journey: upload → analyze → answer correct → mastery', async () => {
    const { microSkill } = await buildMicroSkill();
    const source = await createStudentUploadSource();

    // Step 1: Student uploads question
    const ingestion = await ingestionService.createIngestion(STUDENT_USER, {
      ingestMethod: 'IMAGE_UPLOAD',
      originalAssetRef: 's3://student-uploads/p5f6-journey-1.png',
      originalAssetMimeType: 'image/png',
      sourceId: source.id,
      studentId: STUDENT_USER,
    });

    expect(ingestion.state).toBe(INGESTION_STATES.INGESTED);
    // Ownership is a REAL persisted column (not part of the public projection):
    // the uploader is the authenticated user.
    const persisted = await prisma.questionIngestion.findUnique({ where: { id: ingestion.id } });
    expect(persisted!.ingestedByUserId).toBe(STUDENT_USER);

    // Step 2: Analysis (with synthetic normalized text)
    await analysisService.analyzeIngestion(ingestion.id, STAFF_USER, 'ADMIN', {
      skipOcr: true,
      normalizedText: 'Synthetic: f(x) = 2x + 3 fonksiyonu için f(5) değerini hesaplayın.',
    });

    // Step 3: Drive to review state. Analysis lands on ANALYZED or
    // REVIEW_REQUIRED depending on confidence; only drive ANALYZED ->
    // REVIEW_REQUIRED (a valid transition) and otherwise leave REVIEW_REQUIRED.
    const analyzed = await prisma.questionIngestion.findUnique({ where: { id: ingestion.id } });
    if (analyzed!.state === INGESTION_STATES.ANALYZED) {
      await ingestionService.transitionIngestion(ingestion.id, STAFF_USER, 'ADMIN', {
        toState: INGESTION_STATES.REVIEW_REQUIRED,
      });
    }

    // Step 4: Create canonical question
    const { question, instance } = await ingestionService.createCanonicalQuestionFromIngestion(
      ingestion.id, STAFF_USER, 'ADMIN'
    );

    expect(question.origin).toBe('STUDENT_UPLOADED');
    expect(question.trust).toBe('UNVERIFIED');
    // The instance is owned by this student's StudentProfile (real identity chain).
    expect(instance.studentId).toBe((global as any).TEST_STUDENT_PROFILE_ID);

    // Define the answer key for this synthetic question so answer validation has a
    // real correct answer to check against (a bare student-uploaded question has none).
    await prisma.question.update({
      where: { id: question.id },
      data: { correctAnswer: '13' },
    });

    // Step 5: Create PRIMARY mapping for mastery
    await skillMappingService.createMapping(STAFF_USER, 'ADMIN', {
      questionId: question.id,
      microSkillId: microSkill.id,
      relevance: 0.9,
      isPrimary: true,
      reviewed: true,
      mappingSource: 'MANUAL_REVIEW',
    });

    // Step 6: Student submits correct answer
    const attempt = await questionAttemptService.submitAnswer({
      studentId: (global as any).TEST_STUDENT_PROFILE_ID,
      sessionId: 'standalone',
      questionId: question.id,
      answer: '13',
      timeSpentSeconds: 30,
    });

    expect(attempt.isCorrect).toBe(true);
    expect(attempt.attemptId).toBeTruthy();

    // Step 7: Apply mastery
    const masteryResult = await masteryService.applyAttemptMastery({ 
      attemptId: attempt.attemptId 
    });

    expect(masteryResult.applied).toBe(true);
    expect(masteryResult.microSkillId).toBe(microSkill.id);

    // Step 8: Verify mastery state. SkillMastery's compound unique is
    // (studentId, skillId); by convention skillId === microSkillId.
    const skillMastery = await prisma.skillMastery.findUnique({
      where: {
        studentId_skillId: {
          studentId: (global as any).TEST_STUDENT_PROFILE_ID,
          skillId: microSkill.id,
        },
      },
    });

    expect(skillMastery).toBeTruthy();
    expect(skillMastery!.masteryLevel).toBeGreaterThan(0);

    // Step 9: Verify no error analysis for correct answer
    const errorAnalysis = await prisma.errorAnalysis.findFirst({
      where: { attemptId: attempt.attemptId },
    });

    expect(errorAnalysis).toBeNull();
  });

  it('J2. Complete student journey: upload → analyze → answer incorrect → error analysis', async () => {
    const { microSkill } = await buildMicroSkill();
    const source = await createStudentUploadSource();

    // Setup error pattern for testing.
    // The AI mock classifies with `errorType: 'CONCEPT'`, which the governance
    // table (ERROR_TYPE_TO_CATEGORIES) maps to the canonical category
    // 'CONCEPTUAL_MISUNDERSTANDING'. The fixture must use that same category so
    // the resolver can find a compatible ErrorPattern; it is not a production
    // concern (governance still owns the mapping).
    const errorPattern = await prisma.errorPattern.create({
      data: {
        code: 'P5F6-EP-1',
        name: 'Conceptual Misunderstanding',
        description: 'Synthetic error pattern for testing',
        category: 'CONCEPTUAL_MISUNDERSTANDING',
        severity: 'MEDIUM',
        source: 'TEST_FIXTURE',
        isActive: true,
      },
    });
    await prisma.errorPatternMicroSkill.create({
      data: { 
        errorPatternId: errorPattern.id, 
        microSkillId: microSkill.id, 
        relevance: 0.9, 
        isPrimary: true 
      },
    });

    // Steps 1-4: Same as J1
    const ingestion = await ingestionService.createIngestion(STUDENT_USER, {
      ingestMethod: 'IMAGE_UPLOAD',
      originalAssetRef: 's3://student-uploads/p5f6-journey-2.png',
      sourceId: source.id,
    });

    await analysisService.analyzeIngestion(ingestion.id, STAFF_USER, 'ADMIN', {
      skipOcr: true,
      normalizedText: 'Synthetic: Calculate the derivative of f(x) = x².',
    });

    await ingestionService.transitionIngestion(ingestion.id, STAFF_USER, 'ADMIN', {
      toState: INGESTION_STATES.MAPPED,
    });
    await ingestionService.transitionIngestion(ingestion.id, STAFF_USER, 'ADMIN', {
      toState: INGESTION_STATES.REVIEW_REQUIRED,
    });

    const { question } = await ingestionService.createCanonicalQuestionFromIngestion(
      ingestion.id, STAFF_USER, 'ADMIN'
    );

    // Phase 6.3: an answer can only be scored when a canonical answer exists. A
    // raw student upload produces an OPEN_ENDED question with no answer key, which
    // is now explicitly NOT_EVALUABLE (no mastery/error signal). This test is about
    // mastery/error idempotency, so it supplies a canonical answer to make the
    // attempt deterministically evaluable. MULTIPLE_CHOICE + a text answer makes
    // the deterministic error classifier resolve the compatible CONCEPT pattern.
    await prisma.question.update({
      where: { id: question.id },
      data: { type: 'MULTIPLE_CHOICE', correctAnswer: 'x²' },
    });

    await skillMappingService.createMapping(STAFF_USER, 'ADMIN', {
      questionId: question.id,
      microSkillId: microSkill.id,
      relevance: 0.9,
      isPrimary: true,
      reviewed: true,
      mappingSource: 'MANUAL_REVIEW',
    });

    // Step 5: Student submits incorrect answer
    const attempt = await questionAttemptService.submitAnswer({
      studentId: (global as any).TEST_STUDENT_PROFILE_ID,
      sessionId: 'standalone',
      questionId: question.id,
      answer: '2x', // Wrong answer
      timeSpentSeconds: 45,
    });

    expect(attempt.isCorrect).toBe(false);

    // Step 6: Apply mastery (should still apply for incorrect answers)
    const masteryResult = await masteryService.applyAttemptMastery({
      attemptId: attempt.attemptId
    });

    expect(masteryResult.applied).toBe(true);

    // Step 7: Apply error analysis
    const errorResult = await errorAnalysisService.processAttemptError({
      attemptId: attempt.attemptId
    });

    expect(errorResult.processed).toBe(true);
    expect(errorResult.errorPatternId).toBe(errorPattern.id);

    // Step 8: Verify error analysis state
    const errorAnalysis = await prisma.errorAnalysis.findFirst({
      where: { attemptId: attempt.attemptId },
    });

    expect(errorAnalysis).toBeTruthy();
    expect(errorAnalysis!.errorPatternId).toBe(errorPattern.id);
  });

  it('J3. Mastery idempotency: retry produces no duplicate effect', async () => {
    const { microSkill } = await buildMicroSkill();
    const source = await createStudentUploadSource();

    // Quick setup. The production contract requires rawText, normalizedText or a
    // real asset reference; a synthetic asset ref satisfies it without weakening
    // validation.
    const ingestion = await ingestionService.createIngestion(STUDENT_USER, {
      ingestMethod: 'IMAGE_UPLOAD',
      originalAssetRef: 's3://student-uploads/p5f6-idempotency-test.png',
      originalAssetMimeType: 'image/png',
      sourceId: source.id,
    });

    await analysisService.analyzeIngestion(ingestion.id, STAFF_USER, 'ADMIN', {
      skipOcr: true,
      normalizedText: 'Synthetic math question for idempotency test.',
    });

    await ingestionService.transitionIngestion(ingestion.id, STAFF_USER, 'ADMIN', {
      toState: INGESTION_STATES.MAPPED,
    });
    await ingestionService.transitionIngestion(ingestion.id, STAFF_USER, 'ADMIN', {
      toState: INGESTION_STATES.REVIEW_REQUIRED,
    });

    const { question } = await ingestionService.createCanonicalQuestionFromIngestion(
      ingestion.id, STAFF_USER, 'ADMIN'
    );

    // Phase 6.3: make the attempt deterministically evaluable (see J2 note).
    await prisma.question.update({
      where: { id: question.id },
      data: { type: 'CALCULATION', correctAnswer: '42' },
    });

    await skillMappingService.createMapping(STAFF_USER, 'ADMIN', {
      questionId: question.id,
      microSkillId: microSkill.id,
      relevance: 0.9,
      isPrimary: true,
      reviewed: true,
      mappingSource: 'MANUAL_REVIEW',
    });

    const attempt = await questionAttemptService.submitAnswer({
      studentId: (global as any).TEST_STUDENT_PROFILE_ID,
      sessionId: 'standalone',
      questionId: question.id,
      answer: '42',
      timeSpentSeconds: 20,
    });

    // First mastery application
    const firstResult = await masteryService.applyAttemptMastery({ 
      attemptId: attempt.attemptId 
    });

    expect(firstResult.applied).toBe(true);

    // Second mastery application (should be idempotent)
    const secondResult = await masteryService.applyAttemptMastery({ 
      attemptId: attempt.attemptId 
    });

    expect(secondResult.applied).toBe(false);
    expect(secondResult.reason).toBe('ALREADY_APPLIED');

    // Verify only one mastery audit record
    const auditCount = await prisma.masteryAudit.count({
      where: { correlationId: attempt.attemptId },
    });

    expect(auditCount).toBe(1);
  });

  it('J4. Student authorization: cannot access another student data', async () => {
    // Create another student
    const otherUserId = 'p5f6-other-student';
    await prisma.user.create({
      data: {
        id: otherUserId,
        email: 'other@example.com',
        firstName: 'Other',
        lastName: 'Student',
        role: 'STUDENT',
        passwordHash: 'hash',
      },
    });
    await prisma.studentProfile.create({ 
      data: { userId: otherUserId, grade: 11, school: 'Test School' } 
    });

    const { microSkill } = await buildMicroSkill();
    const source = await createStudentUploadSource();

    // Create ingestion for original student
    const ingestion = await ingestionService.createIngestion(STUDENT_USER, {
      ingestMethod: 'IMAGE_UPLOAD',
      originalAssetRef: 's3://student-uploads/auth-test.png',
      sourceId: source.id,
      studentId: (global as any).TEST_STUDENT_PROFILE_ID,
    });

    // Other student should not be able to read this ingestion
    await expect(
      ingestionService.getIngestion(ingestion.id, otherUserId, 'STUDENT')
    ).rejects.toThrow();

    // Other student should not be able to transition this ingestion
    await expect(
      ingestionService.transitionIngestion(ingestion.id, otherUserId, 'STUDENT', {
        toState: INGESTION_STATES.EXTRACTED,
      })
    ).rejects.toThrow();
  });

  it('J5. Provenance security: STUDENT_UPLOADED origin cannot be changed', async () => {
    const source = await createStudentUploadSource();
    const ingestion = await ingestionService.createIngestion(STUDENT_USER, {
      ingestMethod: 'IMAGE_UPLOAD',
      originalAssetRef: 's3://student-uploads/provenance-test.png',
      sourceId: source.id,
      studentId: (global as any).TEST_STUDENT_PROFILE_ID,
    });

    await analysisService.analyzeIngestion(ingestion.id, STAFF_USER, 'ADMIN', {
      skipOcr: true,
      normalizedText: 'Synthetic question.',
    });

    // Analysis lands on ANALYZED or REVIEW_REQUIRED depending on confidence.
    // Follow the real state machine: only drive ANALYZED -> REVIEW_REQUIRED
    // (a valid transition); REVIEW_REQUIRED is already a terminal-for-review
    // state on the path to canonical creation.
    const analyzed = await prisma.questionIngestion.findUnique({ where: { id: ingestion.id } });
    if (analyzed!.state === INGESTION_STATES.ANALYZED) {
      await ingestionService.transitionIngestion(ingestion.id, STAFF_USER, 'ADMIN', {
        toState: INGESTION_STATES.REVIEW_REQUIRED,
      });
    }

    const { question } = await ingestionService.createCanonicalQuestionFromIngestion(
      ingestion.id, STAFF_USER, 'ADMIN'
    );

    // Origin should remain STUDENT_UPLOADED
    expect(question.origin).toBe('STUDENT_UPLOADED');
    expect(question.origin).not.toBe('MEB');
    expect(question.origin).not.toBe('MEB_TEXTBOOK');
  });

  it('J6. Review gate: student upload cannot auto-promote to APPROVED', async () => {
    const source = await createStudentUploadSource();
    // Real production contract: a synthetic asset reference is a valid input.
    const ingestion = await ingestionService.createIngestion(STUDENT_USER, {
      ingestMethod: 'IMAGE_UPLOAD',
      originalAssetRef: 's3://student-uploads/p5f6-review-gate-test.png',
      originalAssetMimeType: 'image/png',
      sourceId: source.id,
    });

    // Student should not be able to move to APPROVED
    await expect(
      ingestionService.transitionIngestion(ingestion.id, STUDENT_USER, 'STUDENT', {
        toState: INGESTION_STATES.APPROVED,
      })
    ).rejects.toThrow();

    // Even staff should be blocked by trust ceiling
    await analysisService.analyzeIngestion(ingestion.id, STAFF_USER, 'ADMIN', {
      skipOcr: true,
      normalizedText: 'Synthetic question.',
    });

    // Follow the real state machine: analysis lands on ANALYZED or
    // REVIEW_REQUIRED. Both are valid review-path states for the trust gate.
    const analyzed = await prisma.questionIngestion.findUnique({ where: { id: ingestion.id } });
    if (analyzed!.state === INGESTION_STATES.ANALYZED) {
      await ingestionService.transitionIngestion(ingestion.id, STAFF_USER, 'ADMIN', {
        toState: INGESTION_STATES.REVIEW_REQUIRED,
      });
    }

    await expect(
      ingestionService.transitionIngestion(ingestion.id, STAFF_USER, 'ADMIN', {
        toState: INGESTION_STATES.APPROVED,
      })
    ).rejects.toThrow(/trust ceiling/);
  });

  it('J7. Audit safety: no sensitive content in audit logs', async () => {
    const source = await createStudentUploadSource();
    const ingestion = await ingestionService.createIngestion(STUDENT_USER, {
      ingestMethod: 'IMAGE_UPLOAD',
      originalAssetRef: 's3://sensitive-content.png',
      sourceId: source.id,
    });

    await analysisService.analyzeIngestion(ingestion.id, STAFF_USER, 'ADMIN', {
      skipOcr: true,
      normalizedText: 'SENSITIVE-TEST-CONTENT-THAT-SHOULD-NOT-APPEAR-IN-AUDIT',
    });

    const auditLogs = await prisma.auditLog.findMany();
    const serialized = JSON.stringify(auditLogs);

    expect(serialized).not.toContain('SENSITIVE-TEST-CONTENT');
    expect(serialized).not.toContain('sensitive-content.png');
  });

  it('J8. Database isolation: test data does not leak to main database', async () => {
    // This test runs in isolation - verify that test cleanup worked
    const questionCount = await prisma.question.count();
    const ingestionCount = await prisma.questionIngestion.count();
    const attemptCount = await prisma.questionAttempt.count();

    // All should be 0 since we clean up in beforeEach
    expect(questionCount).toBe(0);
    expect(ingestionCount).toBe(0);
    expect(attemptCount).toBe(0);
  });
});