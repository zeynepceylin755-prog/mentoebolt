import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { CurriculumCandidateService } from '../../src/application/services/curriculum/CurriculumCandidateService.js';
import { IdempotencyService } from '../../src/infrastructure/idempotency/IdempotencyService.js';

/**
 * Phase 5C — CurriculumCandidateService.
 *
 * Scope: candidate management + validation only. No OCR, no AI inference, no
 * MicroSkill target, no QuestionSkillMapping.
 */
describe('CurriculumCandidate Service - Phase 5C', () => {
  let prisma: PrismaClient;
  let idempotencyService: IdempotencyService;
  let service: CurriculumCandidateService;

  beforeAll(async () => {
    prisma = new PrismaClient({
      datasources: { db: { url: process.env.DATABASE_URL || 'file:./dev.db' } },
    });
    await prisma.$connect();
    await prisma.$executeRawUnsafe('PRAGMA foreign_keys = ON');
    idempotencyService = new IdempotencyService(prisma);
    service = new CurriculumCandidateService(prisma, idempotencyService);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.auditLog.deleteMany();
    await prisma.idempotencyRecord.deleteMany();
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
    await prisma.user.deleteMany();

    // Real User rows for the actor ids. IdempotencyRecord.userId and
    // AuditLog.userId are foreign keys to User, so an actor id that does not
    // exist would fail the FK at the persistence layer. Creating the actors
    // (rather than loosening the FK) keeps production semantics intact.
    await prisma.user.create({
      data: { id: ADMIN, email: 'p5c-admin@example.com', firstName: 'Phase5C', lastName: 'Admin', role: 'ADMIN' },
    });
    await prisma.user.create({
      data: { id: STUDENT, email: 'p5c-student@example.com', firstName: 'Phase5C', lastName: 'Student', role: 'STUDENT' },
    });
  });

  // ------------------------------------------------------------- fixtures

  async function buildCurriculum() {
    const version = await prisma.curriculumVersion.create({
      data: {
        code: 'P5C-CUR', name: 'Phase 5C Curriculum', grade: 11,
        subject: 'Matematik', version: '1.0', source: 'TEST_FIXTURE',
      },
    });
    const theme = await prisma.theme.create({
      data: {
        curriculumVersionId: version.id, officialCode: 'P5C.T1',
        name: 'Phase 5C Theme', lessonHours: 10, sourceOrder: 1,
      },
    });
    // Two LearningOutcomes, so parent-mismatch can be tested.
    const loA = await prisma.learningOutcome.create({
      data: {
        themeId: theme.id, officialCode: 'P5C.LO-A',
        officialText: 'Phase 5C outcome A', sourceOrder: 1,
      },
    });
    const loB = await prisma.learningOutcome.create({
      data: {
        themeId: theme.id, officialCode: 'P5C.LO-B',
        officialText: 'Phase 5C outcome B', sourceOrder: 2,
      },
    });
    const pcA = await prisma.processComponent.create({
      data: {
        learningOutcomeId: loA.id, officialCode: 'P5C.PC-A',
        officialText: 'Phase 5C component A', sourceOrder: 1,
      },
    });
    const pcB = await prisma.processComponent.create({
      data: {
        learningOutcomeId: loB.id, officialCode: 'P5C.PC-B',
        officialText: 'Phase 5C component B', sourceOrder: 1,
      },
    });
    return { version, theme, loA, loB, pcA, pcB };
  }

  async function createQuestion(overrides: Record<string, unknown> = {}) {
    return prisma.question.create({
      data: {
        content: 'Phase 5C test question', type: 'OPEN_ENDED', difficulty: 1,
        skillId: 'unmapped', correctAnswer: '', ...overrides,
      },
    });
  }

  const ADMIN = 'admin-user';
  const STUDENT = 'student-user';

  // ================================================ BASIC CREATION (1-4)

  it('1. a valid LearningOutcome candidate is created', async () => {
    const { loA } = await buildCurriculum();
    const question = await createQuestion();

    const created = await service.createCandidate(ADMIN, 'ADMIN', {
      questionId: question.id,
      level: 'LEARNING_OUTCOME',
      targetId: loA.id,
      confidence: 0.8,
    });

    expect(created.id).toBeTruthy();
    expect(created.level).toBe('LEARNING_OUTCOME');
    expect(created.targetId).toBe(loA.id);
    expect(created.decision).toBe('PENDING');
    expect(created.reviewed).toBe(false);
  });

  it('2. a valid ProcessComponent candidate is created', async () => {
    const { pcA } = await buildCurriculum();
    const question = await createQuestion();

    const created = await service.createCandidate(ADMIN, 'CONTENT_MANAGER', {
      questionId: question.id,
      level: 'PROCESS_COMPONENT',
      targetId: pcA.id,
      confidence: 0.65,
    });

    expect(created.level).toBe('PROCESS_COMPONENT');
    expect(created.targetId).toBe(pcA.id);
  });

  it('3. multiple candidates can exist for one Question', async () => {
    const { loA, pcA } = await buildCurriculum();
    const question = await createQuestion();

    await service.createCandidate(ADMIN, 'ADMIN', {
      questionId: question.id, level: 'LEARNING_OUTCOME',
      targetId: loA.id, confidence: 0.9,
    });
    await service.createCandidate(ADMIN, 'ADMIN', {
      questionId: question.id, level: 'PROCESS_COMPONENT',
      targetId: pcA.id, confidence: 0.5,
    });

    const list = await service.listCandidatesForQuestion(question.id);
    expect(list).toHaveLength(2);
  });

  it('4. a duplicate candidate is rejected', async () => {
    const { loA } = await buildCurriculum();
    const question = await createQuestion();

    await service.createCandidate(ADMIN, 'ADMIN', {
      questionId: question.id, level: 'LEARNING_OUTCOME',
      targetId: loA.id, confidence: 0.8,
    });

    await expect(
      service.createCandidate(ADMIN, 'ADMIN', {
        questionId: question.id, level: 'LEARNING_OUTCOME',
        targetId: loA.id, confidence: 0.7,
      })
    ).rejects.toThrow(/already exists/);

    expect(await prisma.curriculumCandidate.count()).toBe(1);
  });

  // ============================================== QUESTION INTEGRITY (5-6)

  it('5. an unknown Question is rejected', async () => {
    const { loA } = await buildCurriculum();

    await expect(
      service.createCandidate(ADMIN, 'ADMIN', {
        questionId: 'no-such-question', level: 'LEARNING_OUTCOME',
        targetId: loA.id, confidence: 0.8,
      })
    ).rejects.toThrow(/Question with id/);

    expect(await prisma.curriculumCandidate.count()).toBe(0);
  });

  it('6. an existing Question can receive a candidate', async () => {
    const { loA } = await buildCurriculum();
    const question = await createQuestion();

    await service.createCandidate(ADMIN, 'ADMIN', {
      questionId: question.id, level: 'LEARNING_OUTCOME',
      targetId: loA.id, confidence: 0.8,
    });

    const list = await service.listCandidatesForQuestion(question.id);
    expect(list).toHaveLength(1);
  });

  // ============================================ CURRICULUM INTEGRITY (7-10)

  it('7. an unknown LearningOutcome is rejected', async () => {
    await buildCurriculum();
    const question = await createQuestion();

    await expect(
      service.createCandidate(ADMIN, 'ADMIN', {
        questionId: question.id, level: 'LEARNING_OUTCOME',
        targetId: 'ghost-lo', confidence: 0.8,
      })
    ).rejects.toThrow(/not found/);

    expect(await prisma.curriculumCandidate.count()).toBe(0);
  });

  it('8. an unknown ProcessComponent is rejected', async () => {
    await buildCurriculum();
    const question = await createQuestion();

    await expect(
      service.createCandidate(ADMIN, 'ADMIN', {
        questionId: question.id, level: 'PROCESS_COMPONENT',
        targetId: 'ghost-pc', confidence: 0.8,
      })
    ).rejects.toThrow(/not found/);
  });

  it('9. a ProcessComponent belonging to another LearningOutcome is rejected', async () => {
    const { loA, pcB } = await buildCurriculum();
    const question = await createQuestion();

    // pcB really belongs to loB, not loA.
    await expect(
      service.createCandidate(ADMIN, 'ADMIN', {
        questionId: question.id,
        level: 'PROCESS_COMPONENT',
        targetId: pcB.id,
        confidence: 0.8,
        learningOutcomeId: loA.id,
      })
    ).rejects.toThrow(/does not belong to/);

    expect(await prisma.curriculumCandidate.count()).toBe(0);
  });

  it('10. a valid ProcessComponent with the correct parent succeeds', async () => {
    const { loA, pcA } = await buildCurriculum();
    const question = await createQuestion();

    const created = await service.createCandidate(ADMIN, 'ADMIN', {
      questionId: question.id,
      level: 'PROCESS_COMPONENT',
      targetId: pcA.id,
      confidence: 0.75,
      learningOutcomeId: loA.id,
    });

    expect(created.targetId).toBe(pcA.id);
  });

  // ================================================== LEVEL VALIDATION (11-12)

  it('11. an invalid curriculum level is rejected', async () => {
    const { loA } = await buildCurriculum();
    const question = await createQuestion();

    await expect(
      service.createCandidate(ADMIN, 'ADMIN', {
        questionId: question.id, level: 'THEME',
        targetId: loA.id, confidence: 0.8,
      })
    ).rejects.toThrow(/Invalid curriculum candidate level/);
  });

  it('12. MicroSkill cannot be used as a candidate level', async () => {
    const { pcA } = await buildCurriculum();
    const question = await createQuestion();
    const microSkill = await prisma.microSkill.create({
      data: {
        processComponentId: pcA.id, code: 'MS-P5C-001', name: 'P5C skill',
        description: 'fixture', source: 'TEST_FIXTURE',
      },
    });

    await expect(
      service.createCandidate(ADMIN, 'ADMIN', {
        questionId: question.id, level: 'MICRO_SKILL',
        targetId: microSkill.id, confidence: 0.8,
      })
    ).rejects.toThrow(/Invalid curriculum candidate level/);

    // And no QuestionSkillMapping was created anywhere.
    expect(await prisma.questionSkillMapping.count()).toBe(0);
  });

  // ================================================== DECISION / REVIEW (13-15)

  it('13. an invalid decision is rejected', async () => {
    const { loA } = await buildCurriculum();
    const question = await createQuestion();

    await expect(
      service.createCandidate(ADMIN, 'ADMIN', {
        questionId: question.id, level: 'LEARNING_OUTCOME',
        targetId: loA.id, confidence: 0.8, decision: 'ACCEPTED',
      })
    ).rejects.toThrow(/Invalid curriculum candidate decision/);
  });

  it('14. an invalid review state is rejected (settled decision without review)', async () => {
    const { loA } = await buildCurriculum();
    const question = await createQuestion();

    await expect(
      service.createCandidate(ADMIN, 'ADMIN', {
        questionId: question.id, level: 'LEARNING_OUTCOME',
        targetId: loA.id, confidence: 0.8,
        decision: 'PRIMARY', reviewed: false,
      })
    ).rejects.toThrow(/requires reviewed = true/);

    expect(await prisma.curriculumCandidate.count()).toBe(0);
  });

  it('15. a valid review operation succeeds', async () => {
    const { loA } = await buildCurriculum();
    const question = await createQuestion();

    const created = await service.createCandidate(ADMIN, 'ADMIN', {
      questionId: question.id, level: 'LEARNING_OUTCOME',
      targetId: loA.id, confidence: 0.8,
    });

    const reviewed = await service.reviewCandidate(ADMIN, 'ADMIN', created.id, {
      decision: 'PRIMARY',
      reviewed: true,
      rationale: 'Confirmed by staff review.',
    });

    expect(reviewed.decision).toBe('PRIMARY');
    expect(reviewed.reviewed).toBe(true);
    expect(reviewed.reviewedByUserId).toBe(ADMIN);
  });

  // ========================================================= CONFIDENCE (16-18)

  it('16. a non-numeric confidence is rejected', async () => {
    const { loA } = await buildCurriculum();
    const question = await createQuestion();

    await expect(
      service.createCandidate(ADMIN, 'ADMIN', {
        questionId: question.id, level: 'LEARNING_OUTCOME',
        targetId: loA.id, confidence: Number.NaN,
      })
    ).rejects.toThrow(/confidence must be a finite number/);

    await expect(
      service.createCandidate(ADMIN, 'ADMIN', {
        questionId: question.id, level: 'LEARNING_OUTCOME',
        targetId: loA.id, confidence: Number.POSITIVE_INFINITY,
      })
    ).rejects.toThrow(/confidence must be a finite number/);
  });

  it('17. an out-of-range confidence is rejected', async () => {
    const { loA, loB } = await buildCurriculum();
    const question = await createQuestion();

    await expect(
      service.createCandidate(ADMIN, 'ADMIN', {
        questionId: question.id, level: 'LEARNING_OUTCOME',
        targetId: loA.id, confidence: 1.5,
      })
    ).rejects.toThrow(/between 0 and 1/);

    await expect(
      service.createCandidate(ADMIN, 'ADMIN', {
        questionId: question.id, level: 'LEARNING_OUTCOME',
        targetId: loB.id, confidence: -0.1,
      })
    ).rejects.toThrow(/between 0 and 1/);
  });

  it('18. a valid confidence succeeds', async () => {
    const { loA } = await buildCurriculum();
    const question = await createQuestion();

    const created = await service.createCandidate(ADMIN, 'ADMIN', {
      questionId: question.id, level: 'LEARNING_OUTCOME',
      targetId: loA.id, confidence: 0.95,
    });

    expect(created.confidence).toBeCloseTo(0.95);
  });

  // ====================================================== AUTHORIZATION (19-20)

  it('19. an unauthorized student mutation is rejected', async () => {
    const { loA } = await buildCurriculum();
    const question = await createQuestion();

    await expect(
      service.createCandidate(STUDENT, 'STUDENT', {
        questionId: question.id, level: 'LEARNING_OUTCOME',
        targetId: loA.id, confidence: 0.8,
      })
    ).rejects.toThrow(/Insufficient permissions/);

    expect(await prisma.curriculumCandidate.count()).toBe(0);
  });

  it('20. an authorized staff operation succeeds', async () => {
    const { loA } = await buildCurriculum();
    const question = await createQuestion();

    for (const role of ['ADMIN', 'CONTENT_MANAGER', 'TEACHER'] as const) {
      const q = await createQuestion();
      const created = await service.createCandidate(`${role}-user`, role, {
        questionId: q.id, level: 'LEARNING_OUTCOME',
        targetId: loA.id, confidence: 0.5,
      });
      expect(created.id).toBeTruthy();
    }
  });

  // ============================================ IDEMPOTENCY / CONCURRENCY (21-22)

  it('21. the same Idempotency-Key produces one business effect', async () => {
    const { loA } = await buildCurriculum();
    const question = await createQuestion();
    const dto = {
      questionId: question.id, level: 'LEARNING_OUTCOME' as const,
      targetId: loA.id, confidence: 0.8,
    };

    const first = await service.createCandidate(ADMIN, 'ADMIN', dto, 'cand-key-21');
    const second = await service.createCandidate(ADMIN, 'ADMIN', dto, 'cand-key-21');

    expect(second.id).toBe(first.id);
    expect(await prisma.curriculumCandidate.count()).toBe(1);
  });

  it('22. concurrent identical requests do not create duplicates', async () => {
    const { loA } = await buildCurriculum();
    const question = await createQuestion();
    const dto = {
      questionId: question.id, level: 'LEARNING_OUTCOME' as const,
      targetId: loA.id, confidence: 0.8,
    };

    const results = await Promise.allSettled([
      service.createCandidate(ADMIN, 'ADMIN', dto, 'cand-key-22'),
      service.createCandidate(ADMIN, 'ADMIN', dto, 'cand-key-22'),
    ]);

    expect(results.some((r) => r.status === 'fulfilled')).toBe(true);
    expect(await prisma.curriculumCandidate.count()).toBe(1);
  });

  // ====================================================== REGRESSION (23-27)

  it('23. the curriculum chain in this suite is internally consistent', async () => {
    const { loA, pcA } = await buildCurriculum();
    const pc = await prisma.processComponent.findUnique({
      where: { id: pcA.id },
      include: {
        learningOutcome: {
          include: {
            theme: { include: { curriculumVersion: true } },
          },
        },
      },
    });
    expect(pc?.learningOutcome.id).toBe(loA.id);
    expect(pc?.learningOutcome.theme.curriculumVersion.id).toBeTruthy();
  });

  it('24. curriculum counts in the test DB reflect only this suite’s fixtures', async () => {
    await buildCurriculum();
    expect(await prisma.curriculumVersion.count()).toBe(1);
    expect(await prisma.theme.count()).toBe(1);
    expect(await prisma.learningOutcome.count()).toBe(2);
    expect(await prisma.processComponent.count()).toBe(2);
  });

  it('25. no MicroSkill is created outside this suite’s own fixtures', async () => {
    await buildCurriculum();
    expect(await prisma.microSkill.count()).toBe(0);
  });

  it('26. ErrorPattern is never touched by candidate operations', async () => {
    const { loA } = await buildCurriculum();
    const question = await createQuestion();
    const before = await prisma.errorPattern.count();

    await service.createCandidate(ADMIN, 'ADMIN', {
      questionId: question.id, level: 'LEARNING_OUTCOME',
      targetId: loA.id, confidence: 0.8,
    });

    expect(await prisma.errorPattern.count()).toBe(before);
  });

  it('27. QuestionSkillMapping is never created by candidate operations', async () => {
    const { loA } = await buildCurriculum();
    const question = await createQuestion();

    await service.createCandidate(ADMIN, 'ADMIN', {
      questionId: question.id, level: 'LEARNING_OUTCOME',
      targetId: loA.id, confidence: 0.8,
    });

    expect(await prisma.questionSkillMapping.count()).toBe(0);
  });

  // ================================================= EXTRA: audit + safety

  it('28. audit rows are written and contain no question content', async () => {
    const { loA } = await buildCurriculum();
    const question = await createQuestion({ content: 'SENSITIVE-STEM-TEXT' });

    const created = await service.createCandidate(ADMIN, 'ADMIN', {
      questionId: question.id, level: 'LEARNING_OUTCOME',
      targetId: loA.id, confidence: 0.8,
    });
    await service.reviewCandidate(ADMIN, 'ADMIN', created.id, {
      decision: 'REJECTED', reviewed: true,
    });

    const rows = await prisma.auditLog.findMany();
    const actions = rows.map((r) => r.action);
    expect(actions).toContain('CURRICULUM_CANDIDATE_CREATED');
    expect(actions).toContain('CURRICULUM_CANDIDATE_REJECTED');

    for (const row of rows) {
      expect(row.details ?? '').not.toContain('SENSITIVE-STEM-TEXT');
    }
  });

  it('29. candidate creation never mutates Question origin or trust', async () => {
    const { loA } = await buildCurriculum();
    const question = await createQuestion({ origin: 'STUDENT_UPLOADED', trust: 'UNVERIFIED' });

    await service.createCandidate(ADMIN, 'ADMIN', {
      questionId: question.id, level: 'LEARNING_OUTCOME',
      targetId: loA.id, confidence: 0.9, decision: 'PRIMARY', reviewed: true,
    });

    const reloaded = await prisma.question.findUnique({ where: { id: question.id } });
    expect(reloaded?.origin).toBe('STUDENT_UPLOADED');
    expect(reloaded?.trust).toBe('UNVERIFIED');
  });

  it('30. listing with an invalid filter is rejected', async () => {
    const question = await createQuestion();

    await expect(
      service.listCandidatesForQuestion(question.id, { level: 'MICRO_SKILL' })
    ).rejects.toThrow(/Invalid curriculum candidate level/);
  });
});
