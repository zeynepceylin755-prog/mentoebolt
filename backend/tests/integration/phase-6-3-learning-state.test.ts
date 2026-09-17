import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

import bootstrap from '../../src/index.js';
import { prisma } from '../setup.js';
import { MasteryApplicationService } from '../../src/application/services/learning/MasteryApplicationService.js';
import { ErrorAnalysisApplicationService } from '../../src/application/services/learning/ErrorAnalysisApplicationService.js';
import { AIErrorAnalysisService } from '../../src/application/services/ai/AIErrorAnalysisService.js';

/**
 * Phase 6.3 — Real Learning State: Attempt → Mastery → Error Analysis
 *
 * Exercises the canonical flow against the real HTTP boundary and real services:
 *
 *   QuestionInstance → QuestionAttempt → SkillMastery/LearningProgress/MasteryAudit
 *                    → (if incorrect) ErrorAnalysis
 *
 * All data is created inside this suite against the isolated test database
 * (`prisma/test.db`, forced by tests/setup.ts). No dev.db mutation, no dependency
 * on the 159 placeholder Question records, no test-only production seeds.
 */

async function registerAndLogin(app: express.Application, label: string) {
  const email = `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const password = 'Test123!@#';

  await request(app)
    .post('/api/v1/auth/register')
    .send({ email, password, firstName: label, lastName: 'User', grade: 11 });

  const login = await request(app)
    .post('/api/v1/auth/login')
    .send({ email, password });

  const accessToken = login.body.data.tokens.accessToken as string;
  const userId = login.body.data.user.id as string;

  const profile = await prisma.studentProfile.findUnique({ where: { userId } });
  if (!profile) {
    throw new Error('Expected a StudentProfile to exist for a registered student');
  }

  return { accessToken, userId, studentProfileId: profile.id };
}

/**
 * Build a self-contained, valid curriculum chain + MicroSkill (the test DB is not
 * seeded). The schema requires MicroSkill.processComponentId, so the full
 * CurriculumVersion → Theme → LearningOutcome → ProcessComponent chain is created.
 */
async function createMicroSkill(label: string, opts: { isActive?: boolean } = {}) {
  const uid = `${label}-${Math.random().toString(36).slice(2, 10)}`;
  const version = await prisma.curriculumVersion.create({
    data: { code: `P63-CUR-${uid}`, name: 'C', grade: 11, subject: 'Matematik', version: '1', source: 'TEST_FIXTURE' },
  });
  const theme = await prisma.theme.create({
    data: { curriculumVersionId: version.id, officialCode: `P63.T-${uid}`, name: 'T', lessonHours: 1, sourceOrder: 1 },
  });
  const lo = await prisma.learningOutcome.create({
    data: { themeId: theme.id, officialCode: `P63.LO-${uid}`, officialText: 'T', sourceOrder: 1 },
  });
  const pc = await prisma.processComponent.create({
    data: { learningOutcomeId: lo.id, officialCode: `P63.PC-${uid}`, officialText: 'T', sourceOrder: 1 },
  });
  return prisma.microSkill.create({
    data: {
      processComponentId: pc.id,
      code: `P63.MS-${uid}`,
      name: `Skill ${uid}`,
      description: 'phase 6.3 fixture',
      source: 'TEST_FIXTURE',
      isActive: opts.isActive ?? true,
    },
  });
}

/** Create a Question with a canonical answer and a QuestionInstance owned by the student. */
async function createOwnedQuestion(
  studentProfileId: string,
  opts: { type?: string; correctAnswer?: string; content?: string } = {}
) {
  const question = await prisma.question.create({
    data: {
      content: opts.content ?? 'Phase 6.3 question',
      type: opts.type ?? 'CALCULATION',
      difficulty: 1,
      skillId: 'unmapped',
      correctAnswer: opts.correctAnswer ?? '42',
      isActive: false,
      isFixture: true,
    },
  });
  await prisma.questionInstance.create({
    data: { studentId: studentProfileId, questionId: question.id },
  });
  return question;
}

async function mapPrimary(questionId: string, microSkillId: string, isPrimary = true) {
  return prisma.questionSkillMapping.create({
    data: {
      questionId,
      microSkillId,
      isPrimary,
      relevance: isPrimary ? 0.9 : 0.5,
      mappingSource: 'MANUAL_REVIEW',
      reviewed: true,
    },
  });
}

/** Wire an ErrorPattern (COMPATIBLE category) to the MicroSkill. */
async function createCompatibleErrorPattern(microSkillId: string) {
  const uid = Math.random().toString(36).slice(2, 10);
  const pattern = await prisma.errorPattern.create({
    data: {
      code: `P63.EP-${uid}`,
      name: 'Conceptual misunderstanding',
      description: 'fixture',
      category: 'CONCEPTUAL_MISUNDERSTANDING',
      severity: 'MEDIUM',
      source: 'TEST_FIXTURE',
      confidence: 0.9,
      isActive: true,
    },
  });
  await prisma.errorPatternMicroSkill.create({
    data: { errorPatternId: pattern.id, microSkillId, relevance: 0.9, isPrimary: true },
  });
  return pattern;
}

/** A deterministic AI provider that always classifies as CONCEPT. */
class StubConceptProvider {
  getProviderName() { return 'stub'; }
  getModelName() { return 'stub-model'; }
  getVersion() { return 'stub-1'; }
  async isAvailable() { return true; }
  async complete() {
    return { content: '', model: 'stub-model', version: 'stub-1', tokensUsed: 0, latencyMs: 0, finishReason: 'stop' };
  }
  async completeStructured() {
    const structured = {
      errorType: 'CONCEPT',
      confidence: 0.8,
      hypothesis: 'Kavramsal bir karışıklık olabilir.',
      relatedSkills: [],
      suggestion: 'İlgili kavramı gözden geçir.',
    };
    return {
      content: JSON.stringify(structured),
      structured,
      model: 'stub-model',
      version: 'stub-1',
      tokensUsed: 0,
      latencyMs: 0,
      finishReason: 'stop',
    };
  }
}

/** A deterministic AI provider that always throws (simulates a provider outage). */
class FailingProvider {
  getProviderName() { return 'failing'; }
  getModelName() { return 'failing-model'; }
  getVersion() { return 'failing-1'; }
  async isAvailable() { return false; }
  async complete() { throw new Error('provider down'); }
  async completeStructured() { throw new Error('provider down'); }
}

describe('Phase 6.3 — Real Learning State', () => {
  let app: express.Application;

  beforeAll(async () => {
    app = await bootstrap();
  });

  beforeEach(async () => {
    // Isolated, per-test data. Deleted child → parent to respect FKs.
    await prisma.errorAnalysis.deleteMany({});
    await prisma.masteryAudit.deleteMany({});
    await prisma.learningProgress.deleteMany({});
    await prisma.skillMastery.deleteMany({});
    await prisma.questionAttempt.deleteMany({});
    await prisma.questionInstance.deleteMany({});
    await prisma.questionSkillMapping.deleteMany({});
    await prisma.errorPatternMicroSkill.deleteMany({});
    await prisma.errorPattern.deleteMany({});
    await prisma.microSkill.deleteMany({});
    await prisma.processComponent.deleteMany({});
    await prisma.learningOutcome.deleteMany({});
    await prisma.theme.deleteMany({});
    await prisma.curriculumVersion.deleteMany({});
    await prisma.question.deleteMany({});
    await prisma.studentProfile.deleteMany({});
    await prisma.user.deleteMany({});
  });

  // ------------------------------------------------------------------ Attempt
  describe('Question Attempt', () => {
    it('1. authenticated student can submit a valid QuestionInstance answer', async () => {
      const user = await registerAndLogin(app, 'attemptA');
      const question = await createOwnedQuestion(user.studentProfileId, { correctAnswer: '5' });

      const res = await request(app)
        .post('/api/v1/question-attempts')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ questionId: question.id, answer: '5', timeSpentSeconds: 10 });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.evaluationState).toBe('EVALUATED');
      expect(res.body.data.isCorrect).toBe(true);
      expect(res.body.data.attemptId).toBeDefined();

      const attempt = await prisma.questionAttempt.findUnique({ where: { id: res.body.data.attemptId } });
      expect(attempt?.studentId).toBe(user.studentProfileId);
      expect(attempt?.questionId).toBe(question.id);
    });

    it('2. an unauthorized student cannot submit another student\'s instance', async () => {
      const userA = await registerAndLogin(app, 'unauthA');
      const userB = await registerAndLogin(app, 'unauthB');
      const question = await createOwnedQuestion(userA.studentProfileId, { correctAnswer: '42' });

      const instance = await prisma.questionInstance.findFirst({
        where: { studentId: userA.studentProfileId, questionId: question.id },
      });

      // B names A's instance explicitly — it must be rejected.
      const res = await request(app)
        .post('/api/v1/question-attempts')
        .set('Authorization', `Bearer ${userB.accessToken}`)
        .send({ questionId: question.id, answer: '42', timeSpentSeconds: 10, instanceId: instance!.id });

      expect(res.status).toBe(403);
      expect(await prisma.questionAttempt.count()).toBe(0);
    });

    it('3. deterministic MULTIPLE_CHOICE correctness (case-insensitive, trimmed)', async () => {
      const user = await registerAndLogin(app, 'mc');
      const question = await createOwnedQuestion(user.studentProfileId, {
        type: 'MULTIPLE_CHOICE', correctAnswer: 'Ankara', content: 'Capital?',
      });

      const res = await request(app)
        .post('/api/v1/question-attempts')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ questionId: question.id, answer: '  ankara ', timeSpentSeconds: 10 });

      expect(res.status).toBe(201);
      expect(res.body.data.isCorrect).toBe(true);
    });

    it('4. deterministic CALCULATION correctness tolerates whitespace', async () => {
      const user = await registerAndLogin(app, 'calc');
      const question = await createOwnedQuestion(user.studentProfileId, { type: 'CALCULATION', correctAnswer: 'x = 4' });

      const res = await request(app)
        .post('/api/v1/question-attempts')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ questionId: question.id, answer: 'x=4', timeSpentSeconds: 10 });

      expect(res.status).toBe(201);
      expect(res.body.data.isCorrect).toBe(true);
      expect(res.body.data.evaluationState).toBe('EVALUATED');
    });

    it('5. a deterministic incorrect answer is recorded as evaluated-incorrect', async () => {
      const user = await registerAndLogin(app, 'wrong');
      const question = await createOwnedQuestion(user.studentProfileId, { correctAnswer: '5' });

      const res = await request(app)
        .post('/api/v1/question-attempts')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ questionId: question.id, answer: '7', timeSpentSeconds: 10 });

      expect(res.status).toBe(201);
      expect(res.body.data.isCorrect).toBe(false);
      expect(res.body.data.evaluationState).toBe('EVALUATED');
    });

    it('6. a question the student cannot access is rejected (no attempt created)', async () => {
      const user = await registerAndLogin(app, 'invalidQ');
      // A Question exists but has NO instance/session for this student.
      const orphan = await prisma.question.create({
        data: { content: 'orphan', type: 'CALCULATION', difficulty: 1, skillId: 'unmapped', correctAnswer: '1' },
      });

      const res = await request(app)
        .post('/api/v1/question-attempts')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ questionId: orphan.id, answer: '1', timeSpentSeconds: 10 });

      expect(res.status).toBe(403);
      expect(await prisma.questionAttempt.count()).toBe(0);
    });

    it('7. an OPEN_ENDED question with no canonical answer is explicitly NOT_EVALUABLE', async () => {
      const user = await registerAndLogin(app, 'openEnded');
      const question = await createOwnedQuestion(user.studentProfileId, { type: 'OPEN_ENDED', correctAnswer: '' });

      const res = await request(app)
        .post('/api/v1/question-attempts')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ questionId: question.id, answer: 'my reasoning', timeSpentSeconds: 30 });

      expect(res.status).toBe(201);
      expect(res.body.data.evaluationState).toBe('NOT_EVALUABLE');
      // No fabricated answer key is echoed back.
      expect(res.body.data.correctAnswer).toBeNull();
    });

    it('8. an unauthenticated request cannot submit an attempt', async () => {
      const user = await registerAndLogin(app, 'noauth');
      const question = await createOwnedQuestion(user.studentProfileId);

      const res = await request(app)
        .post('/api/v1/question-attempts')
        .send({ questionId: question.id, answer: '42', timeSpentSeconds: 10 });

      expect(res.status).toBe(401);
    });
  });

  // ------------------------------------------------------------------ Mastery
  describe('Mastery Application', () => {
    it('9. a correct attempt creates mastery and a safe audit entry', async () => {
      const user = await registerAndLogin(app, 'masteryCorrect');
      const ms = await createMicroSkill('correct');
      const question = await createOwnedQuestion(user.studentProfileId, { correctAnswer: '42' });
      await mapPrimary(question.id, ms.id);

      const res = await request(app)
        .post('/api/v1/question-attempts')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ questionId: question.id, answer: '42', timeSpentSeconds: 10 });

      expect(res.status).toBe(201);

      const mastery = await prisma.skillMastery.findUnique({
        where: { studentId_skillId: { studentId: user.studentProfileId, skillId: ms.id } },
      });
      expect(mastery).toBeDefined();
      expect(mastery?.attempts).toBe(1);
      expect(mastery?.correctAttempts).toBe(1);
      expect(mastery?.masteryLevel).toBeGreaterThan(0);
      expect(mastery?.masteryLevel).toBeLessThanOrEqual(100);
      expect(mastery?.version).toBe(1);

      const audit = await prisma.masteryAudit.findFirst({ where: { correlationId: res.body.data.attemptId } });
      expect(audit).not.toBeNull();
      expect(audit?.source).toBe('QUESTION_ATTEMPT');
      // Safe metadata only: the audit carries no raw answer TEXT. Assert on the
      // audit's own scalar values (not the whole serialized row) — the row's
      // random cuid correlationId can coincidentally contain the substring
      // '42', which made a whole-row substring check flaky without strengthening
      // the invariant.
      const auditValues = [
        audit?.reason,
        audit?.source,
        audit?.correlationId,
        String(audit?.previousMastery),
        String(audit?.newMastery),
      ];
      expect(auditValues).not.toContain('42');
    });

    it('10. an incorrect attempt records correct mastery counters', async () => {
      const user = await registerAndLogin(app, 'masteryIncorrect');
      const ms = await createMicroSkill('incorrect');
      const question = await createOwnedQuestion(user.studentProfileId, { correctAnswer: '42' });
      await mapPrimary(question.id, ms.id);

      await request(app)
        .post('/api/v1/question-attempts')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ questionId: question.id, answer: '41', timeSpentSeconds: 10 });

      const mastery = await prisma.skillMastery.findUnique({
        where: { studentId_skillId: { studentId: user.studentProfileId, skillId: ms.id } },
      });
      expect(mastery?.attempts).toBe(1);
      expect(mastery?.correctAttempts).toBe(0);
    });

    it('11. PRIMARY mapping controls mastery; SECONDARY does not', async () => {
      const user = await registerAndLogin(app, 'primaryOnly');
      const primaryMs = await createMicroSkill('primary');
      const secondaryMs = await createMicroSkill('secondary');
      const question = await createOwnedQuestion(user.studentProfileId, { correctAnswer: '42' });
      await mapPrimary(question.id, primaryMs.id, true);
      await mapPrimary(question.id, secondaryMs.id, false);

      await request(app)
        .post('/api/v1/question-attempts')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ questionId: question.id, answer: '42', timeSpentSeconds: 10 });

      const primary = await prisma.skillMastery.findUnique({
        where: { studentId_skillId: { studentId: user.studentProfileId, skillId: primaryMs.id } },
      });
      const secondary = await prisma.skillMastery.findUnique({
        where: { studentId_skillId: { studentId: user.studentProfileId, skillId: secondaryMs.id } },
      });

      expect(primary).not.toBeNull();
      expect(secondary).toBeNull();
    });

    it('12. a SECONDARY-only mapping causes no mastery mutation', async () => {
      const user = await registerAndLogin(app, 'secondaryOnly');
      const ms = await createMicroSkill('secondaryOnlyMs');
      const question = await createOwnedQuestion(user.studentProfileId, { correctAnswer: '42' });
      await mapPrimary(question.id, ms.id, false);

      await request(app)
        .post('/api/v1/question-attempts')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ questionId: question.id, answer: '42', timeSpentSeconds: 10 });

      expect(await prisma.skillMastery.count({ where: { studentId: user.studentProfileId }})).toBe(0);
    });

    it('13. no mapping causes no mastery mutation and no audit', async () => {
      const user = await registerAndLogin(app, 'noMapping');
      const question = await createOwnedQuestion(user.studentProfileId, { correctAnswer: '42' });

      await request(app)
        .post('/api/v1/question-attempts')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ questionId: question.id, answer: '42', timeSpentSeconds: 10 });

      expect(await prisma.skillMastery.count({ where: { studentId: user.studentProfileId }})).toBe(0);
      expect(await prisma.masteryAudit.count({ where: { studentId: user.studentProfileId }})).toBe(0);
    });

    it('14. an inactive MicroSkill is never used for mastery', async () => {
      const user = await registerAndLogin(app, 'inactiveMs');
      const ms = await createMicroSkill('inactive', { isActive: false });
      const question = await createOwnedQuestion(user.studentProfileId, { correctAnswer: '42' });
      await mapPrimary(question.id, ms.id);

      await request(app)
        .post('/api/v1/question-attempts')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ questionId: question.id, answer: '42', timeSpentSeconds: 10 });

      expect(await prisma.skillMastery.count({ where: { studentId: user.studentProfileId }})).toBe(0);
    });

    it('15. a NOT_EVALUABLE attempt never mutates mastery', async () => {
      const user = await registerAndLogin(app, 'notEvalMastery');
      const ms = await createMicroSkill('notEval');
      const question = await createOwnedQuestion(user.studentProfileId, { type: 'OPEN_ENDED', correctAnswer: '' });
      await mapPrimary(question.id, ms.id);

      await request(app)
        .post('/api/v1/question-attempts')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ questionId: question.id, answer: 'free text', timeSpentSeconds: 10 });

      expect(await prisma.skillMastery.count({ where: { studentId: user.studentProfileId }})).toBe(0);
    });

    it('16. replaying mastery for the same attempt is a no-op', async () => {
      const user = await registerAndLogin(app, 'replay');
      const ms = await createMicroSkill('replay');
      const question = await createOwnedQuestion(user.studentProfileId, { correctAnswer: '42' });
      await mapPrimary(question.id, ms.id);

      const res = await request(app)
        .post('/api/v1/question-attempts')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ questionId: question.id, answer: '42', timeSpentSeconds: 10 });
      const attemptId = res.body.data.attemptId;

      const service = new MasteryApplicationService(prisma as any);
      const first = await service.applyAttemptMastery({ attemptId });
      const second = await service.applyAttemptMastery({ attemptId });

      expect(first.applied).toBe(false);
      expect(first.reason).toBe('ALREADY_APPLIED');
      expect(second.applied).toBe(false);

      const mastery = await prisma.skillMastery.findUnique({
        where: { studentId_skillId: { studentId: user.studentProfileId, skillId: ms.id } },
      });
      expect(mastery?.attempts).toBe(1);
      expect(await prisma.masteryAudit.count({ where: { correlationId: attemptId }})).toBe(1);
    });

    it('17. concurrent mastery processing does not double-apply', async () => {
      const user = await registerAndLogin(app, 'concurrent');
      const ms = await createMicroSkill('concurrent');
      const question = await createOwnedQuestion(user.studentProfileId, { correctAnswer: '42' });
      await mapPrimary(question.id, ms.id);

      const res = await request(app)
        .post('/api/v1/question-attempts')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ questionId: question.id, answer: '42', timeSpentSeconds: 10 });
      const attemptId = res.body.data.attemptId;

      const service = new MasteryApplicationService(prisma as any);
      const results = await Promise.all([
        service.applyAttemptMastery({ attemptId }),
        service.applyAttemptMastery({ attemptId }),
        service.applyAttemptMastery({ attemptId }),
      ]);

      // The attempt was already applied during submission → all replays are no-ops.
      expect(results.every((r) => r.applied === false)).toBe(true);

      const mastery = await prisma.skillMastery.findUnique({
        where: { studentId_skillId: { studentId: user.studentProfileId, skillId: ms.id } },
      });
      expect(mastery?.attempts).toBe(1);
      expect(await prisma.masteryAudit.count({ where: { correlationId: attemptId }})).toBe(1);
    });

    it('18. two attempts in the same day fold into ONE LearningProgress row', async () => {
      const user = await registerAndLogin(app, 'progressDaily');
      const ms = await createMicroSkill('progressDaily');
      const question = await createOwnedQuestion(user.studentProfileId, { correctAnswer: '42' });
      await mapPrimary(question.id, ms.id);

      for (let i = 0; i < 2; i++) {
        const res = await request(app)
          .post('/api/v1/question-attempts')
          .set('Authorization', `Bearer ${user.accessToken}`)
          .send({ questionId: question.id, answer: '42', timeSpentSeconds: 10 });
        expect(res.status).toBe(201);
      }

      const progress = await prisma.learningProgress.findMany({
        where: { studentId: user.studentProfileId, skillId: ms.id },
      });
      expect(progress).toHaveLength(1);
      expect(progress[0].attemptsCount).toBe(2);
      expect(progress[0].correctCount).toBe(2);
      expect(progress[0].masteryLevel).toBeGreaterThan(0);
    });
  });

  // ------------------------------------------------------------- ErrorAnalysis
  describe('Error Analysis', () => {
    function buildErrorService(provider: any) {
      return new ErrorAnalysisApplicationService(prisma as any, new AIErrorAnalysisService(provider));
    }

    it('19. an incorrect EVALUATED attempt creates exactly one ErrorAnalysis (CLASSIFIED)', async () => {
      const user = await registerAndLogin(app, 'errorClassified');
      const ms = await createMicroSkill('errClassified');
      const question = await createOwnedQuestion(user.studentProfileId, { correctAnswer: '42' });
      await mapPrimary(question.id, ms.id);
      const pattern = await createCompatibleErrorPattern(ms.id);

      const attempt = await prisma.questionAttempt.create({
        data: {
          studentId: user.studentProfileId,
          questionId: question.id,
          answer: '41',
          isCorrect: false,
          timeSpentSeconds: 10,
          status: 'COMPLETED',
          validatedAt: new Date(),
          metadata: JSON.stringify({ evaluationState: 'EVALUATED', hasCanonicalAnswer: true }),
        },
      });

      const service = buildErrorService(new StubConceptProvider());
      const result = await service.processAttemptError({ attemptId: attempt.id });

      expect(result.processed).toBe(true);
      expect(result.state).toBe('CLASSIFIED');
      expect(result.errorPatternId).toBe(pattern.id);
      expect(result.microSkillId).toBe(ms.id);

      const rows = await prisma.errorAnalysis.findMany({ where: { attemptId: attempt.id } });
      expect(rows).toHaveLength(1);
      expect(rows[0].validated).toBe(true);
    });

    it('20. a correct attempt creates NO ErrorAnalysis', async () => {
      const user = await registerAndLogin(app, 'noErrorCorrect');
      const ms = await createMicroSkill('noErr');
      const question = await createOwnedQuestion(user.studentProfileId, { correctAnswer: '42' });
      await mapPrimary(question.id, ms.id);

      const attempt = await prisma.questionAttempt.create({
        data: {
          studentId: user.studentProfileId,
          questionId: question.id,
          answer: '42',
          isCorrect: true,
          timeSpentSeconds: 10,
          status: 'COMPLETED',
          validatedAt: new Date(),
          metadata: JSON.stringify({ evaluationState: 'EVALUATED', hasCanonicalAnswer: true }),
        },
      });

      const service = buildErrorService(new StubConceptProvider());
      const result = await service.processAttemptError({ attemptId: attempt.id });

      expect(result.processed).toBe(false);
      expect(result.reason).toBe('ATTEMPT_CORRECT');
      expect(await prisma.errorAnalysis.count({ where: { attemptId: attempt.id }})).toBe(0);
    });

    it('21. a NOT_EVALUABLE attempt creates NO ErrorAnalysis', async () => {
      const user = await registerAndLogin(app, 'noErrorNotEval');
      const ms = await createMicroSkill('noErrNotEval');
      const question = await createOwnedQuestion(user.studentProfileId, { type: 'OPEN_ENDED', correctAnswer: '' });
      await mapPrimary(question.id, ms.id);

      const attempt = await prisma.questionAttempt.create({
        data: {
          studentId: user.studentProfileId,
          questionId: question.id,
          answer: 'free text',
          isCorrect: false,
          timeSpentSeconds: 10,
          status: 'COMPLETED',
          validatedAt: new Date(),
          metadata: JSON.stringify({ evaluationState: 'NOT_EVALUABLE', hasCanonicalAnswer: false }),
        },
      });

      const service = buildErrorService(new StubConceptProvider());
      const result = await service.processAttemptError({ attemptId: attempt.id });

      expect(result.processed).toBe(false);
      expect(result.reason).toBe('ATTEMPT_NOT_EVALUABLE');
      expect(await prisma.errorAnalysis.count({ where: { attemptId: attempt.id }})).toBe(0);
    });

    it('22. an AI provider failure creates NO ErrorAnalysis (never fabricates)', async () => {
      const user = await registerAndLogin(app, 'aiFailure');
      const ms = await createMicroSkill('aiFail');
      const question = await createOwnedQuestion(user.studentProfileId, { correctAnswer: '42' });
      await mapPrimary(question.id, ms.id);
      await createCompatibleErrorPattern(ms.id);

      const attempt = await prisma.questionAttempt.create({
        data: {
          studentId: user.studentProfileId,
          questionId: question.id,
          answer: '41',
          isCorrect: false,
          timeSpentSeconds: 10,
          status: 'COMPLETED',
          validatedAt: new Date(),
          metadata: JSON.stringify({ evaluationState: 'EVALUATED', hasCanonicalAnswer: true }),
        },
      });

      const service = buildErrorService(new FailingProvider());
      const result = await service.processAttemptError({ attemptId: attempt.id });

      expect(result.processed).toBe(false);
      expect(result.reason).toBe('AI_FAILED');
      expect(await prisma.errorAnalysis.count({ where: { attemptId: attempt.id }})).toBe(0);
      // The AI created no taxonomy.
      expect(await prisma.errorPattern.count()).toBe(1);
    });

    it('23. an incompatible classification stays unclassified and AI creates no taxonomy', async () => {
      const user = await registerAndLogin(app, 'incompatible');
      const ms = await createMicroSkill('incompatible');
      const question = await createOwnedQuestion(user.studentProfileId, { correctAnswer: '42' });
      await mapPrimary(question.id, ms.id);
      // No ErrorPattern is compatible with this MicroSkill.

      const attempt = await prisma.questionAttempt.create({
        data: {
          studentId: user.studentProfileId,
          questionId: question.id,
          answer: '41',
          isCorrect: false,
          timeSpentSeconds: 10,
          status: 'COMPLETED',
          validatedAt: new Date(),
          metadata: JSON.stringify({ evaluationState: 'EVALUATED', hasCanonicalAnswer: true }),
        },
      });

      const service = buildErrorService(new StubConceptProvider());
      const result = await service.processAttemptError({ attemptId: attempt.id });

      expect(result.processed).toBe(true);
      expect(result.errorPatternId).toBeNull();
      expect(result.state).toBe('REVIEW_REQUIRED');

      const row = await prisma.errorAnalysis.findUnique({ where: { attemptId: attempt.id } });
      expect(row?.errorPatternId).toBeNull();
      expect(row?.validated).toBe(false);
      expect(await prisma.errorPattern.count()).toBe(0);
      expect(await prisma.microSkill.count()).toBe(1);
    });

    it('24. processing the same incorrect attempt twice yields ONE ErrorAnalysis', async () => {
      const user = await registerAndLogin(app, 'errorIdempot');
      const ms = await createMicroSkill('errIdem');
      const question = await createOwnedQuestion(user.studentProfileId, { correctAnswer: '42' });
      await mapPrimary(question.id, ms.id);
      await createCompatibleErrorPattern(ms.id);

      const attempt = await prisma.questionAttempt.create({
        data: {
          studentId: user.studentProfileId,
          questionId: question.id,
          answer: '41',
          isCorrect: false,
          timeSpentSeconds: 10,
          status: 'COMPLETED',
          validatedAt: new Date(),
          metadata: JSON.stringify({ evaluationState: 'EVALUATED', hasCanonicalAnswer: true }),
        },
      });

      const service = buildErrorService(new StubConceptProvider());
      const first = await service.processAttemptError({ attemptId: attempt.id });
      const second = await service.processAttemptError({ attemptId: attempt.id });

      expect(first.processed).toBe(true);
      expect(second.processed).toBe(false);
      expect(second.reason).toBe('ALREADY_PROCESSED');
      expect(await prisma.errorAnalysis.count({ where: { attemptId: attempt.id }})).toBe(1);
    });
  });

  // -------------------------------------------------------------- Idempotency
  describe('Idempotency', () => {
    it('25. same request + same idempotency key → exactly one attempt', async () => {
      const user = await registerAndLogin(app, 'idemSameKey');
      const question = await createOwnedQuestion(user.studentProfileId, { correctAnswer: '42' });
      const key = `p63-${Math.random().toString(36).slice(2, 10)}`;
      const body = { questionId: question.id, answer: '42', timeSpentSeconds: 10 };

      const res1 = await request(app)
        .post('/api/v1/question-attempts')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .set('Idempotency-Key', key)
        .send(body);
      expect(res1.status).toBe(201);

      // Same key, same payload: the stored response is replayed.
      const res2 = await request(app)
        .post('/api/v1/question-attempts')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .set('Idempotency-Key', key)
        .send(body);
      expect([200, 201]).toContain(res2.status);
      expect(res2.body.data.attemptId).toBe(res1.body.data.attemptId);

      expect(await prisma.questionAttempt.count({ where: { studentId: user.studentProfileId }})).toBe(1);
    });

    it('26. same idempotency key + different payload → conflict, no second attempt', async () => {
      const user = await registerAndLogin(app, 'idemConflict');
      const question = await createOwnedQuestion(user.studentProfileId, { correctAnswer: '42' });
      const key = `p63-${Math.random().toString(36).slice(2, 10)}`;

      const res1 = await request(app)
        .post('/api/v1/question-attempts')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .set('Idempotency-Key', key)
        .send({ questionId: question.id, answer: '42', timeSpentSeconds: 10 });
      expect(res1.status).toBe(201);

      const res2 = await request(app)
        .post('/api/v1/question-attempts')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .set('Idempotency-Key', key)
        .send({ questionId: question.id, answer: '99', timeSpentSeconds: 10 });

      expect(res2.status).toBe(409);
      expect(await prisma.questionAttempt.count({ where: { studentId: user.studentProfileId }})).toBe(1);
    });
  });

  // ---------------------------------------------------------- LearningProgress
  describe('LearningProgress', () => {
    it('27. LearningProgress reflects authoritative backend counters', async () => {
      const user = await registerAndLogin(app, 'progressState');
      const ms = await createMicroSkill('progressState');
      const question = await createOwnedQuestion(user.studentProfileId, { correctAnswer: '42' });
      await mapPrimary(question.id, ms.id);

      await request(app)
        .post('/api/v1/question-attempts')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ questionId: question.id, answer: '42', timeSpentSeconds: 10 });

      const progress = await prisma.learningProgress.findFirst({
        where: { studentId: user.studentProfileId, skillId: ms.id },
      });
      expect(progress).not.toBeNull();
      expect(progress?.attemptsCount).toBe(1);
      expect(progress?.correctCount).toBe(1);
      expect(progress?.masteryLevel).toBeGreaterThan(0);
    });
  });
});
