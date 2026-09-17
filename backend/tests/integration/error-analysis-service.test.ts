import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { ErrorAnalysisApplicationService } from '../../src/application/services/learning/ErrorAnalysisApplicationService.js';
import { AIErrorAnalysisService } from '../../src/application/services/ai/AIErrorAnalysisService.js';
import { MasteryApplicationService } from '../../src/application/services/learning/MasteryApplicationService.js';
import { AssessmentService } from '../../src/application/services/assessment/AssessmentService.js';
import type { IAIProvider, AIRequest, AIResponse } from '../../src/domain/interfaces/ai/IAIProvider.js';

/**
 * Phase 5F.4 — attempt-level ErrorAnalysis -> ErrorPattern persistence.
 *
 * Scope: error signal only. No recommendations, no taxonomy mutation.
 */

/** Deterministic, controllable AI provider for error analysis. */
class FakeProvider implements IAIProvider {
  constructor(private readonly result: any | (() => any)) {}
  getProviderName() { return 'fake'; }
  getModelName() { return 'fake-model'; }
  getVersion() { return '1.0.0'; }
  async isAvailable() { return true; }
  async complete(_r: AIRequest): Promise<AIResponse> {
    return { content: '{}', model: 'fake-model', version: '1.0.0', tokensUsed: 1, latencyMs: 1, finishReason: 'stop' };
  }
  async completeStructured<T>(_r: AIRequest, _s: any): Promise<AIResponse & { structured: T }> {
    const value = typeof this.result === 'function' ? this.result() : this.result;
    if (value instanceof Error) throw value;
    return {
      content: JSON.stringify(value),
      structured: value as T,
      model: 'fake-model', version: '1.0.0', tokensUsed: 1, latencyMs: 1, finishReason: 'stop',
    };
  }
}

/** A valid AI classification payload. */
const aiClassifies = (errorType: string, confidence = 0.9) => ({
  errorType,
  confidence,
  hypothesis: 'Student applied an incorrect operation.',
  relatedSkills: [],
  suggestion: 'Review the operation.',
});

describe('ErrorAnalysisApplicationService - Phase 5F.4', () => {
  let prisma: PrismaClient;

  beforeEach(async () => {
    prisma = new PrismaClient();
    await prisma.auditLog.deleteMany();
    await prisma.errorAnalysis.deleteMany();
    await prisma.errorPatternMicroSkill.deleteMany();
    await prisma.errorPattern.deleteMany();
    await prisma.questionAttempt.deleteMany();
    await prisma.questionSkillMapping.deleteMany();
    await prisma.question.deleteMany();
    await prisma.microSkill.deleteMany();
    await prisma.processComponent.deleteMany();
    await prisma.learningOutcome.deleteMany();
    await prisma.theme.deleteMany();
    await prisma.curriculumVersion.deleteMany();
    await prisma.studentProfile.deleteMany();
    await prisma.user.deleteMany();
  });

  afterEach(async () => {
    await prisma.$disconnect();
  });

  // --------------------------------------------------------------- fixtures

  async function createStudent(email = 'p5f4-student@example.com') {
    const user = await prisma.user.create({
      data: { email, firstName: 'P5F4', lastName: 'Student', role: 'STUDENT', passwordHash: 'hash' },
    });
    return prisma.studentProfile.create({ data: { userId: user.id, grade: 11 } });
  }

  async function buildMicroSkill() {
    const uid = Math.random().toString(36).slice(2, 10);
    const version = await prisma.curriculumVersion.create({
      data: { code: 'P5F4-CUR-' + uid, name: 'P5F4', grade: 11, subject: 'Matematik', version: '1.0', source: 'TEST_FIXTURE' },
    });
    const theme = await prisma.theme.create({
      data: { curriculumVersionId: version.id, officialCode: 'P5F4.T-' + uid, name: 'theme', lessonHours: 1, sourceOrder: 1 },
    });
    const lo = await prisma.learningOutcome.create({
      data: { themeId: theme.id, officialCode: 'P5F4.LO-' + uid, officialText: 'outcome', sourceOrder: 1 },
    });
    const pc = await prisma.processComponent.create({
      data: { learningOutcomeId: lo.id, officialCode: 'P5F4.PC-' + uid, officialText: 'component', sourceOrder: 1 },
    });
    return prisma.microSkill.create({
      data: { processComponentId: pc.id, code: 'P5F4.MS-' + uid, name: 'skill', description: 'fixture', source: 'TEST_FIXTURE', isActive: true },
    });
  }

  async function createErrorPattern(category: string, microSkillId?: string, opts: { isActive?: boolean; code?: string } = {}) {
    const code = opts.code ?? 'EP-' + category + '-' + Math.random().toString(36).slice(2, 8);
    const pattern = await prisma.errorPattern.create({
      data: {
        code, name: category, description: 'fixture', category, severity: 'MEDIUM',
        source: 'TEST_FIXTURE', isActive: opts.isActive ?? true, confidence: 0.9,
      },
    });
    if (microSkillId) {
      await prisma.errorPatternMicroSkill.create({
        data: { errorPatternId: pattern.id, microSkillId, relevance: 0.9, isPrimary: true },
      });
    }
    return pattern;
  }

  async function createQuestion(overrides: Record<string, unknown> = {}) {
    return prisma.question.create({
      data: {
        content: 'P5F4 canonical question', type: 'OPEN_ENDED', difficulty: 4,
        skillId: 'unmapped', correctAnswer: '42', isActive: false, isFixture: true,
        ...overrides,
      },
    });
  }

  async function mapPrimary(questionId: string, microSkillId: string, isPrimary = true) {
    return prisma.questionSkillMapping.create({
      data: { questionId, microSkillId, relevance: 0.9, isPrimary, mappingSource: 'MANUAL_REVIEW', reviewed: true },
    });
  }

  async function createAttempt(studentId: string, questionId: string, isCorrect: boolean) {
    return prisma.questionAttempt.create({
      data: { studentId, questionId, answer: isCorrect ? '42' : '41', isCorrect, timeSpentSeconds: 20, status: 'COMPLETED', validatedAt: new Date() },
    });
  }

  const serviceWith = (provider: IAIProvider) =>
    new ErrorAnalysisApplicationService(prisma, new AIErrorAnalysisService(provider));

  // ===================================================================== A

  it('A. a correct attempt creates no ErrorAnalysis', async () => {
    const student = await createStudent();
    const ms = await buildMicroSkill();
    const question = await createQuestion();
    await mapPrimary(question.id, ms.id);
    const attempt = await createAttempt(student.id, question.id, true);

    const service = serviceWith(new FakeProvider(aiClassifies('CONCEPT')));
    const result = await service.processAttemptError({ attemptId: attempt.id });

    expect(result.processed).toBe(false);
    expect(result.reason).toBe('ATTEMPT_CORRECT');
    expect(await prisma.errorAnalysis.count()).toBe(0);
  });

  // ===================================================================== B / C / D

  it('B/C/D. an incorrect attempt creates one ErrorAnalysis linked to an existing, MicroSkill-compatible ErrorPattern', async () => {
    const student = await createStudent();
    const ms = await buildMicroSkill();
    const question = await createQuestion();
    await mapPrimary(question.id, ms.id);
    const pattern = await createErrorPattern('CONCEPTUAL_MISUNDERSTANDING', ms.id);
    const attempt = await createAttempt(student.id, question.id, false);

    const service = serviceWith(new FakeProvider(aiClassifies('CONCEPT', 0.9)));
    const result = await service.processAttemptError({ attemptId: attempt.id });

    expect(result.processed).toBe(true);
    expect(result.state).toBe('CLASSIFIED');
    expect(result.errorPatternId).toBe(pattern.id);
    expect(result.microSkillId).toBe(ms.id);

    const rows = await prisma.errorAnalysis.findMany({ where: { attemptId: attempt.id } });
    expect(rows.length).toBe(1);
    expect(rows[0].errorPatternId).toBe(pattern.id);
    expect(rows[0].validated).toBe(true);
    // The persisted pattern exists in the authoritative taxonomy.
    const patternRow = await prisma.errorPattern.findUnique({ where: { id: rows[0].errorPatternId! } });
    expect(patternRow).not.toBeNull();
  });

  // ===================================================================== E

  it('E. an unknown AI classification is never persisted as an authoritative pattern', async () => {
    const student = await createStudent();
    const ms = await buildMicroSkill();
    const question = await createQuestion();
    await mapPrimary(question.id, ms.id);
    const attempt = await createAttempt(student.id, question.id, false);

    // 'OPERATION' maps to categories with no seeded pattern for this MicroSkill.
    const service = serviceWith(new FakeProvider(aiClassifies('OPERATION', 0.9)));
    const result = await service.processAttemptError({ attemptId: attempt.id });

    expect(result.processed).toBe(true);
    expect(result.errorPatternId).toBeNull();
    expect(result.state).not.toBe('CLASSIFIED');
    const rows = await prisma.errorAnalysis.findMany({ where: { attemptId: attempt.id } });
    expect(rows[0].errorPatternId).toBeNull();
    expect(rows[0].validated).toBe(false);
    // No taxonomy entity was fabricated.
    expect(await prisma.errorPattern.count()).toBe(0);
    expect(await prisma.errorPatternMicroSkill.count()).toBe(0);
  });

  it('E2. AI "OTHER" (no mapping) yields no authoritative pattern', async () => {
    const student = await createStudent();
    const ms = await buildMicroSkill();
    const question = await createQuestion();
    await mapPrimary(question.id, ms.id);
    await createErrorPattern('CONCEPTUAL_MISUNDERSTANDING', ms.id);
    const attempt = await createAttempt(student.id, question.id, false);

    const service = serviceWith(new FakeProvider(aiClassifies('OTHER', 0.9)));
    const result = await service.processAttemptError({ attemptId: attempt.id });
    expect(result.errorPatternId).toBeNull();
    expect(await prisma.errorPattern.count()).toBe(1); // unchanged
  });

  // ===================================================================== F

  it('F. an existing but MicroSkill-incompatible pattern is not authoritative', async () => {
    const student = await createStudent();
    const ms = await buildMicroSkill();
    const otherMs = await buildMicroSkill();
    const question = await createQuestion();
    await mapPrimary(question.id, ms.id);
    // Pattern exists with the right category but is linked to a DIFFERENT MicroSkill.
    await createErrorPattern('CONCEPTUAL_MISUNDERSTANDING', otherMs.id);
    const attempt = await createAttempt(student.id, question.id, false);

    const service = serviceWith(new FakeProvider(aiClassifies('CONCEPT', 0.9)));
    const result = await service.processAttemptError({ attemptId: attempt.id });

    expect(result.errorPatternId).toBeNull();
    expect(result.state).not.toBe('CLASSIFIED');
    const rows = await prisma.errorAnalysis.findMany({ where: { attemptId: attempt.id } });
    expect(rows[0].errorPatternId).toBeNull();
  });

  // ===================================================================== G / H

  it('G. replaying the same attempt creates only one ErrorAnalysis', async () => {
    const student = await createStudent();
    const ms = await buildMicroSkill();
    const question = await createQuestion();
    await mapPrimary(question.id, ms.id);
    await createErrorPattern('CONCEPTUAL_MISUNDERSTANDING', ms.id);
    const attempt = await createAttempt(student.id, question.id, false);

    const service = serviceWith(new FakeProvider(aiClassifies('CONCEPT')));
    const r1 = await service.processAttemptError({ attemptId: attempt.id });
    const r2 = await service.processAttemptError({ attemptId: attempt.id });

    expect(r1.processed).toBe(true);
    expect(r2.processed).toBe(false);
    expect(r2.reason).toBe('ALREADY_PROCESSED');
    expect(await prisma.errorAnalysis.count()).toBe(1);
  });

  it('H. concurrent processing creates at most one ErrorAnalysis', async () => {
    const student = await createStudent();
    const ms = await buildMicroSkill();
    const question = await createQuestion();
    await mapPrimary(question.id, ms.id);
    await createErrorPattern('CONCEPTUAL_MISUNDERSTANDING', ms.id);
    const attempt = await createAttempt(student.id, question.id, false);

    const service = serviceWith(new FakeProvider(aiClassifies('CONCEPT')));
    const results = await Promise.allSettled([
      service.processAttemptError({ attemptId: attempt.id }),
      service.processAttemptError({ attemptId: attempt.id }),
    ]);

    const processedCount = results.filter(
      (r) => r.status === 'fulfilled' && (r.value as any).processed === true
    ).length;
    expect(processedCount).toBeLessThanOrEqual(1);
    expect(await prisma.errorAnalysis.count()).toBe(1);
  });

  // ===================================================================== I

  it('I. no ErrorAnalysis is created for a correct attempt even if the AI hallucinates a pattern', async () => {
    const student = await createStudent();
    const ms = await buildMicroSkill();
    const question = await createQuestion();
    await mapPrimary(question.id, ms.id);
    await createErrorPattern('CONCEPTUAL_MISUNDERSTANDING', ms.id);
    const attempt = await createAttempt(student.id, question.id, true);

    const service = serviceWith(new FakeProvider(aiClassifies('CONCEPT', 0.99)));
    const result = await service.processAttemptError({ attemptId: attempt.id });

    expect(result.processed).toBe(false);
    expect(result.reason).toBe('ATTEMPT_CORRECT');
    expect(await prisma.errorAnalysis.count()).toBe(0);
  });

  // ===================================================================== J

  it('J. an AI failure is contained: no authoritative pattern, attempt untouched', async () => {
    const student = await createStudent();
    const ms = await buildMicroSkill();
    const question = await createQuestion();
    await mapPrimary(question.id, ms.id);
    const pattern = await createErrorPattern('CONCEPTUAL_MISUNDERSTANDING', ms.id);
    const attempt = await createAttempt(student.id, question.id, false);

    // Phase 5F.9-C: a provider failure is SURFACED, never silently turned into a
    // canned fallback classification. The failure stays contained: no
    // ErrorAnalysis is written and the attempt/mastery path is untouched.
    const service = serviceWith(new FakeProvider(new Error('provider down')));
    const result = await service.processAttemptError({ attemptId: attempt.id });

    expect(result.processed).toBe(false);
    expect(result.reason).toBe('AI_FAILED');
    expect(await prisma.errorAnalysis.count()).toBe(0);
    const reloaded = await prisma.questionAttempt.findUnique({ where: { id: attempt.id } });
    expect(reloaded.isCorrect).toBe(false); // attempt untouched
    // The taxonomy was neither consulted nor mutated by the failed analysis.
    expect(pattern.id).toBeTruthy();
    expect(await prisma.errorPattern.count()).toBe(1);
  });

  // ===================================================================== K

  it('K. a low-confidence classification follows the review policy (not CLASSIFIED)', async () => {
    const student = await createStudent();
    const ms = await buildMicroSkill();
    const question = await createQuestion();
    await mapPrimary(question.id, ms.id);
    const attempt = await createAttempt(student.id, question.id, false);

    // Correct category, but no compatible pattern exists => unresolved; a low
    // confidence must not be presented as authoritative.
    const service = serviceWith(new FakeProvider(aiClassifies('CONCEPT', 0.3)));
    const result = await service.processAttemptError({ attemptId: attempt.id });

    expect(result.errorPatternId).toBeNull();
    expect(result.state).toBe('UNCLASSIFIED');
    const rows = await prisma.errorAnalysis.findMany({ where: { attemptId: attempt.id } });
    expect(rows[0].metadata).toContain('UNCLASSIFIED');
  });

  // ===================================================================== L

  it('L. audit contains only IDs/metadata, never raw content', async () => {
    const student = await createStudent();
    const ms = await buildMicroSkill();
    const question = await createQuestion({ content: 'SENSITIVE-P5F4-STEM', correctAnswer: 'SECRET-ANSWER' });
    await mapPrimary(question.id, ms.id);
    await createErrorPattern('CONCEPTUAL_MISUNDERSTANDING', ms.id);
    const attempt = await createAttempt(student.id, question.id, false);

    const service = serviceWith(new FakeProvider(aiClassifies('CONCEPT')));
    await service.processAttemptError({ attemptId: attempt.id });

    const logs = await prisma.auditLog.findMany({ where: { action: 'ERROR_ANALYSIS_CREATED' } });
    expect(logs.length).toBe(1);
    const serialized = JSON.stringify(logs);
    expect(serialized).not.toContain('SENSITIVE-P5F4-STEM');
    expect(serialized).not.toContain('SECRET-ANSWER');
    // The audit stores IDs/metadata only — the student's answer VALUE is absent.
    const details = JSON.parse(logs[0].details as string);
    expect(details.answer).toBeUndefined();
    expect(details.studentAnswer).toBeUndefined();
    expect(Object.values(details)).not.toContain('41');
    expect(Object.values(details)).not.toContain(attempt.answer);
  });

  // ===================================================================== M

  it('M. error analysis produces no second SkillMastery effect', async () => {
    const student = await createStudent();
    const ms = await buildMicroSkill();
    const question = await createQuestion();
    await mapPrimary(question.id, ms.id);
    await createErrorPattern('CONCEPTUAL_MISUNDERSTANDING', ms.id);
    const attempt = await createAttempt(student.id, question.id, false);

    const mastery = new MasteryApplicationService(prisma);
    const errors = serviceWith(new FakeProvider(aiClassifies('CONCEPT')));

    await mastery.applyAttemptMastery({ attemptId: attempt.id });
    const masteryCount = await prisma.skillMastery.count();
    const auditCount = await prisma.masteryAudit.count();
    await errors.processAttemptError({ attemptId: attempt.id });

    expect(await prisma.skillMastery.count()).toBe(masteryCount);
    expect(await prisma.masteryAudit.count()).toBe(auditCount);
  });

  // ===================================================================== N

  it('N. the real AssessmentService.submitAnswer path reaches ErrorAnalysis processing', async () => {
    const student = await createStudent();
    const ms = await buildMicroSkill();
    const question = await createQuestion({ correctAnswer: '42' });
    await mapPrimary(question.id, ms.id);
    const pattern = await createErrorPattern('CONCEPTUAL_MISUNDERSTANDING', ms.id);

    const assessment = await prisma.assessment.create({
      data: { title: 'P5F4', type: 'PRACTICE', status: 'PUBLISHED', skillIds: JSON.stringify([ms.id]), totalQuestions: 1 },
    });
    await prisma.assessmentQuestion.create({
      data: { assessmentId: assessment.id, questionId: question.id, order: 1, points: 1 },
    });
    const assessmentAttempt = await prisma.assessmentAttempt.create({
      data: { studentId: student.id, assessmentId: assessment.id, status: 'IN_PROGRESS' },
    });

    const errorService = serviceWith(new FakeProvider(aiClassifies('CONCEPT', 0.9)));
    const assessmentService = new AssessmentService(
      prisma,
      undefined,
      new MasteryApplicationService(prisma),
      errorService
    );

    // Wrong answer => incorrect attempt => error analysis runs.
    await assessmentService.submitAnswer(assessmentAttempt.id, question.id, '41', 20);

    // Exactly one QuestionAttempt was persisted, and it produced exactly one
    // authoritative ErrorAnalysis through the active assessment path.
    const attemptRow = await prisma.questionAttempt.findFirst({ where: { questionId: question.id } });
    expect(attemptRow).not.toBeNull();
    const rows = await prisma.errorAnalysis.findMany({ where: { attemptId: attemptRow.id } });
    expect(rows.length).toBe(1);
    expect(rows[0].errorPatternId).toBe(pattern.id);
    expect(rows[0].validated).toBe(true);
  });

  // ===================================================================== O

  it('O. a persistence failure does not leave a partial authoritative ErrorAnalysis', async () => {
    const student = await createStudent();
    const ms = await buildMicroSkill();
    const question = await createQuestion();
    await mapPrimary(question.id, ms.id);
    await createErrorPattern('CONCEPTUAL_MISUNDERSTANDING', ms.id);
    const attempt = await createAttempt(student.id, question.id, false);

    // A studentId that violates the ErrorAnalysis -> StudentProfile FK forces the
    // create to fail; the surrounding transaction must roll back entirely.
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.errorAnalysis.create({
          data: {
            attemptId: attempt.id, studentId: 'missing-student', errorType: 'CONCEPT',
            confidence: 0.9, hypothesis: 'x', validated: true,
          },
        });
      })
    ).rejects.toThrow();
    expect(await prisma.errorAnalysis.count()).toBe(0);

    // The service itself is atomic and consistent.
    const service = serviceWith(new FakeProvider(aiClassifies('CONCEPT')));
    const result = await service.processAttemptError({ attemptId: attempt.id });
    expect(result.processed).toBe(true);
    expect(await prisma.errorAnalysis.count()).toBe(1);
  });
});
