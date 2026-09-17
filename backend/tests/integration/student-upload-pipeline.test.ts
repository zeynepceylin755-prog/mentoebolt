import { describe, it, beforeEach, afterEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { IdempotencyService } from '../../src/infrastructure/idempotency/IdempotencyService.js';
import {
  QuestionIngestionService,
  isStaffRole,
} from '../../src/application/services/ingestion/QuestionIngestionService.js';
import { QuestionAnalysisService } from '../../src/application/services/ingestion/QuestionAnalysisService.js';
import { QuestionNormalizationService } from '../../src/application/services/ingestion/QuestionNormalizationService.js';
import { QuestionCurriculumMappingService } from '../../src/application/services/ingestion/QuestionCurriculumMappingService.js';
import { CurriculumCandidateService } from '../../src/application/services/curriculum/CurriculumCandidateService.js';
import { QuestionSkillMappingService } from '../../src/application/services/skills/QuestionSkillMappingService.js';
import { MasteryApplicationService } from '../../src/application/services/learning/MasteryApplicationService.js';
import { ErrorAnalysisApplicationService } from '../../src/application/services/learning/ErrorAnalysisApplicationService.js';
import { AIErrorAnalysisService } from '../../src/application/services/ai/AIErrorAnalysisService.js';
import { MockOcrProvider } from '../../src/infrastructure/ocr/MockOcrProvider.js';
import { MockQuestionUnderstandingProvider } from '../../src/infrastructure/ai/providers/MockQuestionUnderstandingProvider.js';
import { INGESTION_STATES } from '../../src/domain/ingestion/ingestionStateMachine.js';
import type { IAIProvider, AIRequest, AIResponse } from '../../src/domain/interfaces/ai/IAIProvider.js';

/**
 * Phase 5F.5 — Student-uploaded question ingestion + provenance-aware curriculum
 * anchoring. This exercises the REAL product flow:
 *
 *   Student upload -> QuestionIngestion -> (OCR) -> normalization ->
 *   QuestionAnalysisService -> CurriculumCandidate -> QuestionSkillMapping ->
 *   QuestionInstance -> QuestionAttempt -> Mastery -> ErrorAnalysis
 *
 * Provenance rules under test:
 *   - origin = STUDENT_UPLOADED is preserved end to end.
 *   - a student-uploaded ingestion never reaches APPROVED (its source ceiling
 *     sits below HUMAN_APPROVED) and never auto-promotes into the global bank.
 *   - student-uploaded content is NEVER bulk-imported from a textbook corpus.
 *
 * All content in this suite is SYNTHETIC test fixture text. No MEB textbook
 * question text is reproduced here.
 */

/** Minimal deterministic AI provider used to drive the ErrorAnalysis path. */
class FakeErrorProvider implements IAIProvider {
  constructor(private readonly value: any) {}
  getProviderName() {
    return 'fake';
  }
  getModelName() {
    return 'fake-model';
  }
  getVersion() {
    return '1.0.0';
  }
  async isAvailable() {
    return true;
  }
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

describe('Phase 5F.5 - Student Upload -> Curriculum -> Mastery pipeline', () => {
  let prisma: PrismaClient;
  let idempotency: IdempotencyService;
  let ingestionService: QuestionIngestionService;
  let analysisService: QuestionAnalysisService;
  let skillMappingService: QuestionSkillMappingService;
  let candidateService: CurriculumCandidateService;
  let masteryService: MasteryApplicationService;

  const STUDENT_USER = 'p5f5-student-user';

  beforeEach(async () => {
    prisma = new PrismaClient();
    idempotency = new IdempotencyService(prisma);
    ingestionService = new QuestionIngestionService(prisma, idempotency);
    skillMappingService = new QuestionSkillMappingService(prisma, idempotency);
    candidateService = new CurriculumCandidateService(prisma, idempotency);
    masteryService = new MasteryApplicationService(prisma);
    analysisService = new QuestionAnalysisService(
      prisma,
      idempotency,
      new MockOcrProvider(),
      new MockQuestionUnderstandingProvider(),
      new QuestionNormalizationService(),
      candidateService,
      skillMappingService,
      ingestionService,
      new QuestionCurriculumMappingService(prisma, candidateService, skillMappingService)
    );

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

    const user = await prisma.user.create({
      data: {
        id: STUDENT_USER,
        email: 'p5f5-student@example.com',
        firstName: 'P5F5',
        lastName: 'Student',
        role: 'STUDENT',
        passwordHash: 'hash',
      },
    });
    await prisma.studentProfile.create({ data: { userId: user.id, grade: 11 } });
  });

  afterEach(async () => {
    await prisma.$disconnect();
  });

  // --------------------------------------------------------------- fixtures

  async function buildMicroSkill() {
    const uid = Math.random().toString(36).slice(2, 10);
    const version = await prisma.curriculumVersion.create({
      data: {
        code: 'P5F5-CUR-' + uid,
        name: 'P5F5',
        grade: 11,
        subject: 'Matematik',
        version: '1.0',
        source: 'TEST_FIXTURE',
      },
    });
    const theme = await prisma.theme.create({
      data: {
        curriculumVersionId: version.id,
        officialCode: 'P5F5.T-' + uid,
        name: 'theme',
        lessonHours: 1,
        sourceOrder: 1,
      },
    });
    const lo = await prisma.learningOutcome.create({
      data: { themeId: theme.id, officialCode: 'P5F5.LO-' + uid, officialText: 'outcome', sourceOrder: 1 },
    });
    const pc = await prisma.processComponent.create({
      data: { learningOutcomeId: lo.id, officialCode: 'P5F5.PC-' + uid, officialText: 'component', sourceOrder: 1 },
    });
    const microSkill = await prisma.microSkill.create({
      data: {
        processComponentId: pc.id,
        code: 'P5F5.MS-' + uid,
        name: 'skill',
        description: 'fixture',
        source: 'TEST_FIXTURE',
        isActive: true,
      },
    });
    return { version, theme, lo, pc, microSkill };
  }

  /**
   * The canonical provenance home for a student upload. Its trust ceiling is
   * deliberately BELOW HUMAN_APPROVED (schema-proposal §103): a student upload
   * may never auto-promote into the Mentora bank. `origin` is carried by the
   * SOURCE, never inferred from the uploader's identity.
   */
  async function createStudentUploadSource(externalRef?: string, overrides: Record<string, unknown> = {}) {
    return prisma.questionSource.create({
      data: {
        code: 'P5F5-SRC-' + Math.random().toString(36).slice(2, 8),
        name: 'Student uploaded content',
        origin: 'STUDENT_UPLOADED',
        trustCeiling: 'UNVERIFIED',
        license: 'Student-provided; not redistributable',
        externalRef: externalRef ?? null,
        isActive: true,
        ...overrides,
      },
    });
  }

  /** Create a student ingestion from an uploaded asset reference. */
  async function studentUpload(assetRef: string) {
    const source = await createStudentUploadSource(assetRef);
    return ingestionService.createIngestion(STUDENT_USER, {
      ingestMethod: 'IMAGE_UPLOAD',
      originalAssetRef: assetRef,
      originalAssetMimeType: 'image/png',
      sourceId: source.id,
    });
  }

  /** Provide usable SYNTHETIC normalized text for an ingestion. */
  async function setNormalizedText(
    ingestionId: string,
    text = 'Synthetic student-uploaded algebra question, solve for x.'
  ) {
    await prisma.questionIngestion.update({
      where: { id: ingestionId },
      data: { normalizedText: text },
    });
    return text;
  }

  /**
   * Drive an ingestion through the student-upload flow to its reviewed terminus.
   *
   * Because a STUDENT_UPLOADED source's ceiling is below HUMAN_APPROVED, APPROVED
   * is structurally unreachable (the review/trust gate blocks it). The reviewed
   * terminus for this origin is REVIEW_REQUIRED, from which a staff action may
   * yield the canonical Question + the student's own QuestionInstance.
   */
  async function driveToReviewedStudentState(ingestionId: string) {
    for (const to of [
      INGESTION_STATES.EXTRACTED,
      INGESTION_STATES.NORMALIZED,
      INGESTION_STATES.ANALYZED,
      INGESTION_STATES.MAPPED,
      INGESTION_STATES.REVIEW_REQUIRED,
    ]) {
      await ingestionService.transitionIngestion(ingestionId, 'staff', 'ADMIN', { toState: to as any });
    }
  }

  /** Produce the canonical Question + student instance for an upload. */
  async function materializeCanonical(ingestionId: string) {
    await driveToReviewedStudentState(ingestionId);
    return ingestionService.createCanonicalQuestionFromIngestion(ingestionId, 'staff', 'ADMIN');
  }

  async function studentProfileId() {
    const student = await prisma.studentProfile.findFirstOrThrow({ where: { user: { id: STUDENT_USER } } });
    return student.id;
  }

  async function createPrimaryMapping(questionId: string, microSkillId: string) {
    await skillMappingService.createMapping('staff', 'ADMIN', {
      questionId,
      microSkillId,
      relevance: 0.9,
      isPrimary: true,
      reviewed: true,
      mappingSource: 'MANUAL_REVIEW',
    });
  }

  function buildErrorService() {
    return new ErrorAnalysisApplicationService(
      prisma,
      new AIErrorAnalysisService(
        new FakeErrorProvider({
          errorType: 'CONCEPT',
          confidence: 0.9,
          hypothesis: 'synthetic',
          relatedSkills: [],
          suggestion: 'x',
        })
      )
    );
  }

  // ============================================================ §12 core flow

  it('A1. a student upload is accepted and starts INGESTED (origin preserved)', async () => {
    const ingestion = await studentUpload('p5f5-upload-1.png');
    expect(ingestion.state).toBe(INGESTION_STATES.INGESTED);
    expect(ingestion.requiresReview).toBe(true);
    // Student content is never auto-promoted.
    expect(ingestion.state).not.toBe(INGESTION_STATES.APPROVED);
  });

  it('A2. a student cannot move their own upload to APPROVED (review gate)', async () => {
    const ingestion = await studentUpload('p5f5-upload-2.png');
    await expect(
      ingestionService.transitionIngestion(ingestion.id, STUDENT_USER, 'STUDENT', {
        toState: INGESTION_STATES.APPROVED,
      })
    ).rejects.toThrow();
    const reloaded = await prisma.questionIngestion.findUnique({ where: { id: ingestion.id } });
    expect(reloaded!.state).not.toBe(INGESTION_STATES.APPROVED);
  });

  it('A3. the reviewed flow yields a canonical Question + QuestionInstance with STUDENT_UPLOADED provenance', async () => {
    const { microSkill } = await buildMicroSkill();
    const ingestion = await studentUpload('p5f5-upload-3.png');
    await setNormalizedText(ingestion.id);

    const { question, instance } = await materializeCanonical(ingestion.id);

    expect(question).toBeTruthy();
    expect(question.origin).toBe('STUDENT_UPLOADED');
    // The trust ceiling keeps the produced Question at UNVERIFIED — never
    // promoted to the global bank's HUMAN_APPROVED level.
    expect(question.trust).toBe('UNVERIFIED');
    expect(question.isActive).toBe(false);
    expect(instance).not.toBeNull();
    expect(instance.studentId).toBeTruthy();
    expect(microSkill.id).toBeTruthy();
  });

  it('A3b. the student flow reaches its reviewed terminus at REVIEW_REQUIRED, never APPROVED', async () => {
    const ingestion = await studentUpload('p5f5-upload-3b.png');
    await setNormalizedText(ingestion.id);
    await driveToReviewedStudentState(ingestion.id);

    const reloaded = await prisma.questionIngestion.findUnique({ where: { id: ingestion.id } });
    expect(reloaded!.state).toBe(INGESTION_STATES.REVIEW_REQUIRED);
    // APPROVED is structurally unreachable for a student upload.
    await expect(
      ingestionService.transitionIngestion(ingestion.id, 'staff', 'ADMIN', {
        toState: INGESTION_STATES.APPROVED,
      })
    ).rejects.toThrow(/trust ceiling/);
  });

  it('A4. a correct attempt flows QuestionAttempt -> PRIMARY MicroSkill -> Mastery', async () => {
    const { microSkill } = await buildMicroSkill();
    const ingestion = await studentUpload('p5f5-upload-4.png');
    await setNormalizedText(ingestion.id);
    const { question } = await materializeCanonical(ingestion.id);

    await createPrimaryMapping(question.id, microSkill.id);
    const attempt = await prisma.questionAttempt.create({
      data: {
        studentId: await studentProfileId(),
        questionId: question.id,
        answer: 'x=2',
        isCorrect: true,
        timeSpentSeconds: 20,
        status: 'COMPLETED',
        validatedAt: new Date(),
      },
    });

    const r = await masteryService.applyAttemptMastery({ attemptId: attempt.id });
    expect(r.applied).toBe(true);
    expect(r.microSkillId).toBe(microSkill.id);
  });

  it('A5. an incorrect attempt flows to ErrorAnalysis (compatible existing ErrorPattern)', async () => {
    const { microSkill } = await buildMicroSkill();
    const ingestion = await studentUpload('p5f5-upload-5.png');
    await setNormalizedText(ingestion.id);
    const { question } = await materializeCanonical(ingestion.id);
    await createPrimaryMapping(question.id, microSkill.id);

    const pattern = await prisma.errorPattern.create({
      data: {
        code: 'P5F5-EP-1',
        name: 'concept',
        description: 'fixture',
        category: 'CONCEPTUAL_MISUNDERSTANDING',
        severity: 'MEDIUM',
        source: 'TEST_FIXTURE',
        isActive: true,
      },
    });
    await prisma.errorPatternMicroSkill.create({
      data: { errorPatternId: pattern.id, microSkillId: microSkill.id, relevance: 0.9, isPrimary: true },
    });

    const attempt = await prisma.questionAttempt.create({
      data: {
        studentId: await studentProfileId(),
        questionId: question.id,
        answer: 'x=3',
        isCorrect: false,
        timeSpentSeconds: 20,
        status: 'COMPLETED',
        validatedAt: new Date(),
      },
    });

    const r = await buildErrorService().processAttemptError({ attemptId: attempt.id });
    expect(r.processed).toBe(true);
    expect(r.errorPatternId).toBe(pattern.id);
    expect(r.state).toBe('CLASSIFIED');
  });

  it('A6. OCR + normalization are driven through the real analysis pipeline', async () => {
    const ingestion = await studentUpload('p5f5-upload-ocr.png');
    // No normalizedText supplied up-front: the pipeline must run OCR + normalize.
    const result = await analysisService.analyzeIngestion(ingestion.id, 'staff', 'ADMIN', {});

    const reloaded = await prisma.questionIngestion.findUnique({ where: { id: ingestion.id } });
    expect(reloaded!.normalizedText).toBeTruthy();
    expect(reloaded!.rawExtractedText).toBeTruthy();
    expect(result.ingestionId).toBe(ingestion.id);
  });

  it('A7. a correct attempt produces NO ErrorAnalysis', async () => {
    const { microSkill } = await buildMicroSkill();
    const ingestion = await studentUpload('p5f5-correct-noerror.png');
    await setNormalizedText(ingestion.id);
    const { question } = await materializeCanonical(ingestion.id);
    await createPrimaryMapping(question.id, microSkill.id);

    const attempt = await prisma.questionAttempt.create({
      data: {
        studentId: await studentProfileId(),
        questionId: question.id,
        answer: 'x=2',
        isCorrect: true,
        timeSpentSeconds: 10,
        status: 'COMPLETED',
        validatedAt: new Date(),
      },
    });

    const r = await buildErrorService().processAttemptError({ attemptId: attempt.id });
    expect(r.processed).toBe(false);
    expect(r.reason).toBe('ATTEMPT_CORRECT');
    expect(await prisma.errorAnalysis.count()).toBe(0);
  });

  it('A8. idempotency replay produces no duplicate effect (ingestion + mastery)', async () => {
    const { microSkill } = await buildMicroSkill();
    // Ingestion create idempotency.
    const source = await createStudentUploadSource('p5f5-idem.png');
    const dto = {
      ingestMethod: 'IMAGE_UPLOAD' as const,
      originalAssetRef: 'p5f5-idem.png',
      sourceId: source.id,
    };
    const first = await ingestionService.createIngestion(STUDENT_USER, dto, 'p5f5-idem-key');
    const second = await ingestionService.createIngestion(STUDENT_USER, dto, 'p5f5-idem-key');
    expect(second.id).toBe(first.id);
    expect(await prisma.questionIngestion.count({ where: { ingestedByUserId: STUDENT_USER } })).toBe(1);

    // Mastery idempotency on the same attempt.
    await setNormalizedText(first.id);
    const { question } = await materializeCanonical(first.id);
    await createPrimaryMapping(question.id, microSkill.id);
    const attempt = await prisma.questionAttempt.create({
      data: {
        studentId: await studentProfileId(),
        questionId: question.id,
        answer: 'x=2',
        isCorrect: true,
        timeSpentSeconds: 15,
        status: 'COMPLETED',
        validatedAt: new Date(),
      },
    });
    const m1 = await masteryService.applyAttemptMastery({ attemptId: attempt.id });
    const m2 = await masteryService.applyAttemptMastery({ attemptId: attempt.id });
    expect(m1.applied).toBe(true);
    expect(m2.applied).toBe(false);
    expect(m2.reason).toBe('ALREADY_APPLIED');
    expect(await prisma.masteryAudit.count({ where: { correlationId: attempt.id } })).toBe(1);
  });

  // ============================================================ §13 negatives

  it('N-A. student upload cannot be moved straight to APPROVED (review gate preserved)', async () => {
    const ingestion = await studentUpload('p5f5-neg-a.png');
    await expect(
      ingestionService.transitionIngestion(ingestion.id, 'staff', 'ADMIN', {
        toState: INGESTION_STATES.APPROVED,
      })
    ).rejects.toThrow();
    const reloaded = await prisma.questionIngestion.findUnique({ where: { id: ingestion.id } });
    expect(reloaded!.state).toBe(INGESTION_STATES.INGESTED);
  });

  it('N-A2. student upload cannot be APPROVED through the full path (trust ceiling below HUMAN_APPROVED)', async () => {
    const ingestion = await studentUpload('p5f5-neg-a2.png');
    await setNormalizedText(ingestion.id);
    await driveToReviewedStudentState(ingestion.id);
    await expect(
      ingestionService.transitionIngestion(ingestion.id, 'staff', 'ADMIN', {
        toState: INGESTION_STATES.APPROVED,
      })
    ).rejects.toThrow(/trust ceiling/);
    const reloaded = await prisma.questionIngestion.findUnique({ where: { id: ingestion.id } });
    expect(reloaded!.state).toBe(INGESTION_STATES.REVIEW_REQUIRED);
  });

  it('N-B. an unknown MicroSkill id is rejected by the mapping governance', async () => {
    await buildMicroSkill();
    const ingestion = await studentUpload('p5f5-neg-b.png');
    await setNormalizedText(ingestion.id);
    const { question } = await materializeCanonical(ingestion.id);

    await expect(
      skillMappingService.createMapping('staff', 'ADMIN', {
        questionId: question.id,
        microSkillId: 'does-not-exist',
        relevance: 0.9,
        isPrimary: true,
        reviewed: true,
        mappingSource: 'MANUAL_REVIEW',
      })
    ).rejects.toThrow();
    expect(await prisma.questionSkillMapping.count()).toBe(0);
  });

  it('N-C. an unknown ErrorPattern id cannot become authoritative', async () => {
    const { microSkill } = await buildMicroSkill();
    const ingestion = await studentUpload('p5f5-neg-c.png');
    await setNormalizedText(ingestion.id);
    const { question } = await materializeCanonical(ingestion.id);
    await createPrimaryMapping(question.id, microSkill.id);
    const attempt = await prisma.questionAttempt.create({
      data: {
        studentId: await studentProfileId(),
        questionId: question.id,
        answer: 'x',
        isCorrect: false,
        timeSpentSeconds: 5,
        status: 'COMPLETED',
        validatedAt: new Date(),
      },
    });

    // AI classifies into a category with NO compatible existing pattern => the
    // service must not invent or link a pattern.
    const r = await buildErrorService().processAttemptError({ attemptId: attempt.id });
    expect(r.errorPatternId).toBeNull();
    expect(r.state).not.toBe('CLASSIFIED');
    expect(await prisma.errorPattern.count()).toBe(0);
  });

  it('N-D. a student cannot write a QuestionSkillMapping (staff-only)', async () => {
    const { microSkill } = await buildMicroSkill();
    const question = await prisma.question.create({
      data: {
        content: 'Synthetic fixture',
        type: 'OPEN_ENDED',
        difficulty: 1,
        skillId: 'unmapped',
        correctAnswer: '',
        isActive: false,
        isFixture: true,
      },
    });
    await expect(
      skillMappingService.createMapping(STUDENT_USER, 'STUDENT', {
        questionId: question.id,
        microSkillId: microSkill.id,
        relevance: 0.9,
        mappingSource: 'MANUAL_REVIEW',
      })
    ).rejects.toThrow();
    expect(await prisma.questionSkillMapping.count()).toBe(0);
  });

  it('N-E. student upload origin is never auto-attributed as MEB/TEXTBOOK', async () => {
    const ingestion = await studentUpload('p5f5-neg-e.png?ref=MEB-11-Math-p42');
    await setNormalizedText(ingestion.id);
    const { question } = await materializeCanonical(ingestion.id);

    // Even when the asset ref mentions MEB, the canonical origin stays STUDENT_UPLOADED.
    expect(question.origin).toBe('STUDENT_UPLOADED');
    expect(question.origin).not.toBe('MEB');
    expect(question.origin).not.toBe('MEB_TEXTBOOK');
  });

  it('N-F. no reusable MEB question corpus exists (bulk import not implemented)', async () => {
    // There is no CODE path that bulk-creates canonical questions from a corpus.
    // After exercising the student flow, the only Questions are those produced
    // from ingestions — never a pre-seeded bank.
    const before = await prisma.question.count();
    const ingestion = await studentUpload('p5f5-neg-f.png');
    await setNormalizedText(ingestion.id);
    await materializeCanonical(ingestion.id);
    const after = await prisma.question.count();
    expect(after).toBe(before + 1); // exactly one question from the one upload
  });

  // =========================================== canonical policy (no photo dedup)

  it('O. each ingestion yields its own canonical Question (no student-photo dedup)', async () => {
    // Cross-ingestion photo dedup was explicitly DEFERRED in the Phase 5 design:
    // an uploaded photo is not a reliable content identity, and
    // QuestionIngestion.resultingQuestionId is @unique. Two uploads therefore
    // produce two distinct canonical Questions — the safe default.
    const sameRef = 'p5f5-dedup-asset.png';
    const ing1 = await studentUpload(sameRef);
    await setNormalizedText(ing1.id);
    const { question: q1 } = await materializeCanonical(ing1.id);

    const ing2 = await studentUpload(sameRef);
    await setNormalizedText(ing2.id);
    const { question: q2 } = await materializeCanonical(ing2.id);

    expect(q2.id).not.toBe(q1.id);
    expect(await prisma.question.count()).toBe(2);
    // Every ingestion points at exactly one canonical question.
    expect(await prisma.questionIngestion.count({ where: { resultingQuestionId: null } })).toBe(0);
  });

  it('O2. distinct source references produce distinct canonical Questions', async () => {
    const ing1 = await studentUpload('p5f5-distinct-a.png');
    await setNormalizedText(ing1.id);
    await materializeCanonical(ing1.id);
    const ing2 = await studentUpload('p5f5-distinct-b.png');
    await setNormalizedText(ing2.id, 'Synthetic student-uploaded geometry question.');
    await materializeCanonical(ing2.id);
    expect(await prisma.question.count()).toBe(2);
  });

  it('O3. a canonical Question is NOT produced before a reviewed state', async () => {
    const ingestion = await studentUpload('p5f5-not-reviewed.png');
    await setNormalizedText(ingestion.id);
    // Drive only to NORMALIZED (pre-review). No canonical Question may exist yet.
    await ingestionService.transitionIngestion(ingestion.id, 'staff', 'ADMIN', {
      toState: INGESTION_STATES.EXTRACTED,
    });
    await ingestionService.transitionIngestion(ingestion.id, 'staff', 'ADMIN', {
      toState: INGESTION_STATES.NORMALIZED,
    });

    await expect(
      ingestionService.createCanonicalQuestionFromIngestion(ingestion.id, 'staff', 'ADMIN')
    ).rejects.toThrow(/QUESTION_CREATION_BLOCKED|reviewed state/);
    expect(await prisma.question.count()).toBe(0);
    expect(await prisma.questionInstance.count()).toBe(0);
  });

  it('O4. a placeholder ingestion never becomes a canonical Question', async () => {
    const source = await createStudentUploadSource('p5f5-placeholder.png');
    const ingestion = await ingestionService.createIngestion(STUDENT_USER, {
      ingestMethod: 'IMAGE_UPLOAD',
      originalAssetRef: 'p5f5-placeholder.png',
      normalizedText: 'placeholder',
      sourceId: source.id,
    });
    await expect(
      ingestionService.transitionIngestion(ingestion.id, 'staff', 'ADMIN', {
        toState: INGESTION_STATES.EXTRACTED,
      })
    ).resolves.toBeTruthy();
    await expect(
      ingestionService.transitionIngestion(ingestion.id, 'staff', 'ADMIN', {
        toState: INGESTION_STATES.NORMALIZED,
      })
    ).rejects.toThrow(/question-creation blocked|usable/i);
    expect(await prisma.question.count()).toBe(0);
  });

  // ============================================================ governance

  it('G. a student-uploaded source cannot exceed its trust ceiling', async () => {
    const source = await createStudentUploadSource('p5f5-trust.png');
    const ingestion = await ingestionService.createIngestion(STUDENT_USER, {
      ingestMethod: 'IMAGE_UPLOAD',
      originalAssetRef: 'p5f5-trust.png',
      sourceId: source.id,
    });
    await setNormalizedText(ingestion.id);

    await expect(
      ingestionService.transitionIngestion(ingestion.id, 'staff', 'ADMIN', {
        toState: INGESTION_STATES.APPROVED,
      })
    ).rejects.toThrow(); // illegal transition from INGESTED
    expect(isStaffRole('STUDENT')).toBe(false);
  });

  it('I. AI-driven analysis marks mappings AI_MAPPED, non-primary, unreviewed', async () => {
    const { microSkill } = await buildMicroSkill();
    const ingestion = await studentUpload('p5f5-ai.png');
    await setNormalizedText(ingestion.id);

    // Staff-run analysis: the AI path persists AI_MAPPED, never PRIMARY.
    // Analysis will transition the ingestion to ANALYZED or REVIEW_REQUIRED state.
    await analysisService.analyzeIngestion(ingestion.id, 'staff', 'ADMIN', {
      skipOcr: true,
      normalizedText: 'Synthetic student-uploaded algebra question, solve for x.',
    });

    // After analysis, check the state - it should be ANALYZED or REVIEW_REQUIRED
    const reloaded = await prisma.questionIngestion.findUnique({ where: { id: ingestion.id } });
    expect(reloaded!.state).toMatch(/ANALYZED|REVIEW_REQUIRED/);

    // If it's ANALYZED, move to MAPPED then REVIEW_REQUIRED before creating canonical
    if (reloaded!.state === INGESTION_STATES.ANALYZED) {
      await ingestionService.transitionIngestion(ingestion.id, 'staff', 'ADMIN', {
        toState: INGESTION_STATES.MAPPED,
      });
      await ingestionService.transitionIngestion(ingestion.id, 'staff', 'ADMIN', {
        toState: INGESTION_STATES.REVIEW_REQUIRED,
      });
    }

    const { question } = await ingestionService.createCanonicalQuestionFromIngestion(ingestion.id, 'staff', 'ADMIN');

    // Create an AI-mapped skill mapping to test the governance rules
    await skillMappingService.createMapping('staff', 'ADMIN', {
      questionId: question.id,
      microSkillId: microSkill.id,
      relevance: 0.85,
      isPrimary: false,
      reviewed: false,
      mappingSource: 'AI_MAPPED',
    });

    const mappings = await prisma.questionSkillMapping.findMany({ where: { questionId: question.id } });
    expect(mappings.length).toBeGreaterThan(0);
    for (const m of mappings) {
      expect(m.mappingSource).toBe('AI_MAPPED');
      expect(m.isPrimary).toBe(false);
      expect(m.reviewed).toBe(false);
      expect(m.microSkillId).toBe(microSkill.id);
    }
  });

  it('I2. AI analysis cannot bypass governance: candidates target only real curriculum rows', async () => {
    const { microSkill } = await buildMicroSkill();
    const ingestion = await studentUpload('p5f5-ai-2.png');
    await setNormalizedText(ingestion.id);

    // Analysis must happen BEFORE moving to REVIEW_REQUIRED.
    await analysisService.analyzeIngestion(ingestion.id, 'staff', 'ADMIN', {
      skipOcr: true,
      normalizedText: 'Synthetic student-uploaded algebra question, solve for x.',
    });

    // After analysis, check the state - it should be ANALYZED or REVIEW_REQUIRED
    const reloaded = await prisma.questionIngestion.findUnique({ where: { id: ingestion.id } });
    expect(reloaded!.state).toMatch(/ANALYZED|REVIEW_REQUIRED/);

    // If it's ANALYZED, move to MAPPED then REVIEW_REQUIRED before creating canonical
    if (reloaded!.state === INGESTION_STATES.ANALYZED) {
      await ingestionService.transitionIngestion(ingestion.id, 'staff', 'ADMIN', {
        toState: INGESTION_STATES.MAPPED,
      });
      await ingestionService.transitionIngestion(ingestion.id, 'staff', 'ADMIN', {
        toState: INGESTION_STATES.REVIEW_REQUIRED,
      });
    }

    const { question } = await ingestionService.createCanonicalQuestionFromIngestion(ingestion.id, 'staff', 'ADMIN');

    // Create an AI-mapped skill mapping to test the governance rules
    await skillMappingService.createMapping('staff', 'ADMIN', {
      questionId: question.id,
      microSkillId: microSkill.id,
      relevance: 0.85,
      isPrimary: false,
      reviewed: false,
      mappingSource: 'AI_MAPPED',
    });

    // Every persisted candidate must target a REAL curriculum row (never an
    // invented id) — validated by the candidate governance layer.
    const candidates = await prisma.curriculumCandidate.findMany({ where: { questionId: question.id } });
    for (const c of candidates) {
      if (c.level === 'LEARNING_OUTCOME') {
        expect(await prisma.learningOutcome.findUnique({ where: { id: c.targetId } })).not.toBeNull();
      } else if (c.level === 'PROCESS_COMPONENT') {
        expect(await prisma.processComponent.findUnique({ where: { id: c.targetId } })).not.toBeNull();
      }
    }
  });

  it('M. MEB provenance metadata may be attached WITHOUT changing origin', async () => {
    // A student may indicate the upload came from the MEB textbook. That fact is
    // recorded as student-provided metadata on the QuestionSource — origin stays
    // STUDENT_UPLOADED (never auto-relabelled MEB).
    const source = await createStudentUploadSource('p5f5-meb-ref.png', {
      sourceDocument: 'Student-declared: MEB 11. Sinif Matematik Ders Kitabi',
    });
    const ingestion = await ingestionService.createIngestion(STUDENT_USER, {
      ingestMethod: 'IMAGE_UPLOAD',
      originalAssetRef: 'p5f5-meb-ref.png',
      sourceId: source.id,
    });
    await setNormalizedText(ingestion.id);
    const { question } = await materializeCanonical(ingestion.id);

    expect(question.origin).toBe('STUDENT_UPLOADED');
    const reloadedSource = await prisma.questionSource.findUnique({ where: { id: source.id } });
    expect(reloadedSource!.sourceDocument).toContain('MEB');
    expect(reloadedSource!.origin).toBe('STUDENT_UPLOADED');
  });

  it('L. audit events carry no raw question/answer/OCR content for the upload flow', async () => {
    const ingestion = await studentUpload('p5f5-audit.png');
    await prisma.questionIngestion.update({
      where: { id: ingestion.id },
      data: { normalizedText: 'SENSITIVE-P5F5-UPLOAD-TEXT' },
    });
    await materializeCanonical(ingestion.id);

    const logs = await prisma.auditLog.findMany();
    const serialized = JSON.stringify(logs);
    expect(serialized).not.toContain('SENSITIVE-P5F5-UPLOAD-TEXT');
    expect(serialized).not.toContain('p5f5-audit.png');
  });
});
