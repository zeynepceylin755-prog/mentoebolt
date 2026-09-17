import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { QuestionSkillMappingService } from '../../src/application/services/skills/QuestionSkillMappingService.js';
import { IdempotencyService } from '../../src/infrastructure/idempotency/IdempotencyService.js';

/**
 * Phase 5D — QuestionSkillMapping writer + I13 enforcement.
 *
 * Scope: mapping writer, validation, I13, review, authorization, idempotency.
 * No OCR, no AI inference, no keyword classification, no MicroSkill creation.
 */
describe('QuestionSkillMapping Service - Phase 5D', () => {
  let prisma: PrismaClient;
  let idempotencyService: IdempotencyService;
  let service: QuestionSkillMappingService;

  beforeAll(async () => {
    prisma = new PrismaClient({
      datasources: { db: { url: process.env.DATABASE_URL || 'file:./dev.db' } },
    });
    await prisma.$connect();
    await prisma.$executeRawUnsafe('PRAGMA foreign_keys = ON');
    idempotencyService = new IdempotencyService(prisma);
    service = new QuestionSkillMappingService(prisma, idempotencyService);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.auditLog.deleteMany();
    await prisma.idempotencyRecord.deleteMany();
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
    await prisma.studentProfile.deleteMany();
    await prisma.user.deleteMany();

    // Real actor rows are required: AuditLog.userId is a FK to User and the
    // test DB runs with PRAGMA foreign_keys = ON. Created here (after the
    // cleanup above) so they always exist for the test body.
    const staff = await createUser('p5d-staff@example.com', 'ADMIN');
    const student = await createUser('p5d-student@example.com', 'STUDENT');
    STAFF = staff.id;
    STUDENT = student.id;
  });

  // ------------------------------------------------------------- fixtures

  /** Real users: AuditLog.userId is a FK to User and FKs are ON. */
  async function createUser(email: string, role: string) {
    return prisma.user.create({
      data: { email, firstName: 'P5D', lastName: 'User', role, passwordHash: 'hash' },
    });
  }

  async function buildCurriculum() {
    const version = await prisma.curriculumVersion.create({
      data: {
        code: 'P5D-CUR', name: 'Phase 5D Curriculum', grade: 11,
        subject: 'Matematik', version: '1.0', source: 'TEST_FIXTURE',
      },
    });
    const theme = await prisma.theme.create({
      data: {
        curriculumVersionId: version.id, officialCode: 'P5D.T1',
        name: 'Phase 5D Theme', lessonHours: 10, sourceOrder: 1,
      },
    });
    const lo = await prisma.learningOutcome.create({
      data: {
        themeId: theme.id, officialCode: 'P5D.LO1',
        officialText: 'Phase 5D outcome', sourceOrder: 1,
      },
    });
    const pc = await prisma.processComponent.create({
      data: {
        learningOutcomeId: lo.id, officialCode: 'P5D.PC1',
        officialText: 'Phase 5D component', sourceOrder: 1,
      },
    });
    // Two MicroSkills under the valid chain.
    const msA = await prisma.microSkill.create({
      data: {
        processComponentId: pc.id, code: 'MS-P5D-A', name: 'P5D skill A',
        description: 'fixture', source: 'TEST_FIXTURE',
      },
    });
    const msB = await prisma.microSkill.create({
      data: {
        processComponentId: pc.id, code: 'MS-P5D-B', name: 'P5D skill B',
        description: 'fixture', source: 'TEST_FIXTURE',
      },
    });
    return { version, theme, lo, pc, msA, msB };
  }

  async function createQuestion(overrides: Record<string, unknown> = {}) {
    return prisma.question.create({
      data: {
        content: 'Phase 5D test question', type: 'OPEN_ENDED', difficulty: 1,
        skillId: 'unmapped', correctAnswer: '', ...overrides,
      },
    });
  }

  let STAFF = '';
  let STUDENT = '';

  // ==================================================== BASIC CREATION (1-4)

  it('1. a valid PRIMARY mapping is created', async () => {
    const { msA } = await buildCurriculum();
    const question = await createQuestion();

    const created = await service.createMapping(STAFF, 'ADMIN', {
      questionId: question.id, microSkillId: msA.id,
      isPrimary: true, relevance: 0.9,
    });

    expect(created.id).toBeTruthy();
    expect(created.isPrimary).toBe(true);
    expect(created.primaryType).toBe('PRIMARY');
    expect(created.relevance).toBeCloseTo(0.9);
    expect(created.aiConfidence).toBeNull();
    expect(created.mappingSource).toBe('MANUAL_REVIEW');
  });

  it('2. a valid SECONDARY mapping is created', async () => {
    const { msA } = await buildCurriculum();
    const question = await createQuestion();

    const created = await service.createMapping(STAFF, 'ADMIN', {
      questionId: question.id, microSkillId: msA.id,
      isPrimary: false, relevance: 0.4,
    });

    expect(created.isPrimary).toBe(false);
    expect(created.primaryType).toBe('SECONDARY');
  });

  it('3. multiple SECONDARY mappings can exist for one Question', async () => {
    const { msA, msB } = await buildCurriculum();
    const question = await createQuestion();

    await service.createMapping(STAFF, 'ADMIN', {
      questionId: question.id, microSkillId: msA.id, isPrimary: false, relevance: 0.4,
    });
    await service.createMapping(STAFF, 'ADMIN', {
      questionId: question.id, microSkillId: msB.id, isPrimary: false, relevance: 0.5,
    });

    const list = await service.listMappingsForQuestion(question.id);
    expect(list).toHaveLength(2);
    expect(list.every((m) => m.isPrimary === false)).toBe(true);
  });

  it('4. a Question with no mappings returns an empty list', async () => {
    const question = await createQuestion();
    const list = await service.listMappingsForQuestion(question.id);
    expect(list).toEqual([]);
  });

  // ================================================== QUESTION INTEGRITY (5-6)

  it('5. an unknown Question is rejected', async () => {
    const { msA } = await buildCurriculum();

    await expect(
      service.createMapping(STAFF, 'ADMIN', {
        questionId: 'ghost-question', microSkillId: msA.id, relevance: 0.5,
      })
    ).rejects.toThrow(/Question with id/);

    expect(await prisma.questionSkillMapping.count()).toBe(0);
  });

  it('6. an existing Question succeeds', async () => {
    const { msA } = await buildCurriculum();
    const question = await createQuestion();

    await service.createMapping(STAFF, 'ADMIN', {
      questionId: question.id, microSkillId: msA.id, relevance: 0.5,
    });

    expect(await prisma.questionSkillMapping.count()).toBe(1);
  });

  // ================================================= MICROSKILL INTEGRITY (7-9)

  it('7. an unknown MicroSkill is rejected', async () => {
    await buildCurriculum();
    const question = await createQuestion();

    await expect(
      service.createMapping(STAFF, 'ADMIN', {
        questionId: question.id, microSkillId: 'ghost-ms', relevance: 0.5,
      })
    ).rejects.toThrow(/MicroSkill with id/);

    expect(await prisma.questionSkillMapping.count()).toBe(0);
  });

  it('8. an existing MicroSkill succeeds', async () => {
    const { msA } = await buildCurriculum();
    const question = await createQuestion();

    const created = await service.createMapping(STAFF, 'ADMIN', {
      questionId: question.id, microSkillId: msA.id, relevance: 0.5,
    });

    expect(created.microSkillId).toBe(msA.id);
  });

  it('9. a MicroSkill with a broken curriculum chain is rejected', async () => {
    const { theme, pc } = await buildCurriculum();
    const question = await createQuestion();

    const orphanMs = await prisma.microSkill.create({
      data: {
        processComponentId: pc.id, code: 'MS-P5D-ORPHAN', name: 'orphan',
        description: 'fixture', source: 'TEST_FIXTURE',
      },
    });

    // The curriculum chain is fully cascading
    // (Theme -> LearningOutcome -> ProcessComponent -> MicroSkill), so removing
    // the Theme also removes the MicroSkill. The writer must then report the
    // MicroSkill as missing rather than mapping to a stale reference.
    await prisma.theme.delete({ where: { id: theme.id } });

    await expect(
      service.createMapping(STAFF, 'ADMIN', {
        questionId: question.id, microSkillId: orphanMs.id, relevance: 0.5,
      })
    ).rejects.toThrow(/MicroSkill with id .* not found/);

    expect(await prisma.questionSkillMapping.count()).toBe(0);
  });

  it('9b. the curriculum-chain guard rejects a MicroSkill pointing at a missing ProcessComponent', async () => {
    const { pc, msA } = await buildCurriculum();
    const question = await createQuestion();

    // Force a broken soft-ish chain that the cascade rules cannot produce:
    // point the MicroSkill at a ProcessComponent id that does not exist.
    // (SQLite has foreign_keys ON for this connection, so disable FKs for this
    // single probe to simulate historical/drifted data.)
    await prisma.$executeRawUnsafe('PRAGMA foreign_keys = OFF');
    await prisma.$executeRawUnsafe(
      `UPDATE MicroSkill SET processComponentId = 'nonexistent-pc' WHERE id = '${msA.id}'`
    );
    await prisma.$executeRawUnsafe('PRAGMA foreign_keys = ON');

    // Sanity: the row is still present but now dangles. Read it via raw SQL,
    // because the ORM refuses to hydrate an include over a dangling reference.
    const rows = await prisma.$queryRawUnsafe<Array<{ processComponentId: string }>>(
      `SELECT processComponentId FROM MicroSkill WHERE id = '${msA.id}'`
    );
    expect(rows[0]?.processComponentId).toBe('nonexistent-pc');
    expect(pc.id).toBeTruthy();

    await expect(
      service.createMapping(STAFF, 'ADMIN', {
        questionId: question.id, microSkillId: msA.id, relevance: 0.5,
      })
    ).rejects.toThrow(/MICROSKILL_CURRICULUM_INVALID|invalid curriculum chain/i);

    expect(await prisma.questionSkillMapping.count()).toBe(0);

    // Restore so the cleanup hooks and later tests are unaffected.
    await prisma.$executeRawUnsafe('PRAGMA foreign_keys = OFF');
    await prisma.$executeRawUnsafe(
      `UPDATE MicroSkill SET processComponentId = '${pc.id}' WHERE id = '${msA.id}'`
    );
    await prisma.$executeRawUnsafe('PRAGMA foreign_keys = ON');
  });

  // ====================================================== I13 — PRIMARY (10-14)

  it('10. the first PRIMARY mapping succeeds', async () => {
    const { msA } = await buildCurriculum();
    const question = await createQuestion();

    const created = await service.createMapping(STAFF, 'ADMIN', {
      questionId: question.id, microSkillId: msA.id, isPrimary: true, relevance: 0.9,
    });

    expect(created.isPrimary).toBe(true);
  });

  it('11. a second PRIMARY mapping for the same Question is rejected (I13)', async () => {
    const { msA, msB } = await buildCurriculum();
    const question = await createQuestion();

    await service.createMapping(STAFF, 'ADMIN', {
      questionId: question.id, microSkillId: msA.id, isPrimary: true, relevance: 0.9,
    });

    await expect(
      service.createMapping(STAFF, 'ADMIN', {
        questionId: question.id, microSkillId: msB.id, isPrimary: true, relevance: 0.8,
      })
    ).rejects.toThrow(/already has a PRIMARY/);

    const primaries = await prisma.questionSkillMapping.count({
      where: { questionId: question.id, isPrimary: true },
    });
    expect(primaries).toBe(1);
  });

  it('12. a PRIMARY + SECONDARY combination succeeds', async () => {
    const { msA, msB } = await buildCurriculum();
    const question = await createQuestion();

    await service.createMapping(STAFF, 'ADMIN', {
      questionId: question.id, microSkillId: msA.id, isPrimary: true, relevance: 0.9,
    });
    await service.createMapping(STAFF, 'ADMIN', {
      questionId: question.id, microSkillId: msB.id, isPrimary: false, relevance: 0.4,
    });

    const list = await service.listMappingsForQuestion(question.id);
    expect(list).toHaveLength(2);
    expect(list.filter((m) => m.isPrimary)).toHaveLength(1);
  });

  it('13. multiple SECONDARY mappings succeed alongside one PRIMARY', async () => {
    const { pc, msA, msB } = await buildCurriculum();
    const question = await createQuestion();
    const msC = await prisma.microSkill.create({
      data: {
        processComponentId: pc.id,
        code: 'MS-P5D-C', name: 'P5D skill C', description: 'fixture', source: 'TEST_FIXTURE',
      },
    });

    await service.createMapping(STAFF, 'ADMIN', {
      questionId: question.id, microSkillId: msA.id, isPrimary: true, relevance: 0.9,
    });
    await service.createMapping(STAFF, 'ADMIN', {
      questionId: question.id, microSkillId: msB.id, isPrimary: false, relevance: 0.5,
    });
    await service.createMapping(STAFF, 'ADMIN', {
      questionId: question.id, microSkillId: msC.id, isPrimary: false, relevance: 0.3,
    });

    const list = await service.listMappingsForQuestion(question.id);
    expect(list).toHaveLength(3);
    expect(list.filter((m) => m.isPrimary)).toHaveLength(1);
  });

  it('14. the same Question + MicroSkill cannot be inserted twice', async () => {
    const { msA } = await buildCurriculum();
    const question = await createQuestion();

    await service.createMapping(STAFF, 'ADMIN', {
      questionId: question.id, microSkillId: msA.id, relevance: 0.5,
    });

    await expect(
      service.createMapping(STAFF, 'ADMIN', {
        questionId: question.id, microSkillId: msA.id, relevance: 0.6,
      })
    ).rejects.toThrow(/already exists/);

    expect(await prisma.questionSkillMapping.count()).toBe(1);
  });

  // =========================================================== RELEVANCE (15-18)

  it('15. a valid relevance succeeds', async () => {
    const { msA } = await buildCurriculum();
    const question = await createQuestion();

    const created = await service.createMapping(STAFF, 'ADMIN', {
      questionId: question.id, microSkillId: msA.id, relevance: 0.75,
    });
    expect(created.relevance).toBeCloseTo(0.75);
  });

  it('16. NaN relevance is rejected', async () => {
    const { msA } = await buildCurriculum();
    const question = await createQuestion();

    await expect(
      service.createMapping(STAFF, 'ADMIN', {
        questionId: question.id, microSkillId: msA.id, relevance: Number.NaN,
      })
    ).rejects.toThrow(/relevance must be a finite number/);
  });

  it('17. Infinity relevance is rejected', async () => {
    const { msA } = await buildCurriculum();
    const question = await createQuestion();

    await expect(
      service.createMapping(STAFF, 'ADMIN', {
        questionId: question.id, microSkillId: msA.id,
        relevance: Number.POSITIVE_INFINITY,
      })
    ).rejects.toThrow(/relevance must be a finite number/);
  });

  it('18. out-of-range relevance is rejected', async () => {
    const { msA, msB } = await buildCurriculum();
    const question = await createQuestion();

    await expect(
      service.createMapping(STAFF, 'ADMIN', {
        questionId: question.id, microSkillId: msA.id, relevance: 1.2,
      })
    ).rejects.toThrow(/between 0 and 1/);

    await expect(
      service.createMapping(STAFF, 'ADMIN', {
        questionId: question.id, microSkillId: msB.id, relevance: -0.1,
      })
    ).rejects.toThrow(/between 0 and 1/);
  });

  // ========================================================= AI CONFIDENCE (19-23)

  it('19. null aiConfidence succeeds (manual mapping)', async () => {
    const { msA } = await buildCurriculum();
    const question = await createQuestion();

    const created = await service.createMapping(STAFF, 'ADMIN', {
      questionId: question.id, microSkillId: msA.id, relevance: 0.5, aiConfidence: null,
    });
    expect(created.aiConfidence).toBeNull();
  });

  it('20. a valid aiConfidence succeeds', async () => {
    const { msA } = await buildCurriculum();
    const question = await createQuestion();

    const created = await service.createMapping(STAFF, 'ADMIN', {
      questionId: question.id, microSkillId: msA.id, relevance: 0.5, aiConfidence: 0.88,
    });
    expect(created.aiConfidence).toBeCloseTo(0.88);
  });

  it('21. NaN aiConfidence is rejected', async () => {
    const { msA } = await buildCurriculum();
    const question = await createQuestion();

    await expect(
      service.createMapping(STAFF, 'ADMIN', {
        questionId: question.id, microSkillId: msA.id,
        relevance: 0.5, aiConfidence: Number.NaN,
      })
    ).rejects.toThrow(/aiConfidence must be a finite number/);
  });

  it('22. Infinity aiConfidence is rejected', async () => {
    const { msA } = await buildCurriculum();
    const question = await createQuestion();

    await expect(
      service.createMapping(STAFF, 'ADMIN', {
        questionId: question.id, microSkillId: msA.id,
        relevance: 0.5, aiConfidence: Number.POSITIVE_INFINITY,
      })
    ).rejects.toThrow(/aiConfidence must be a finite number/);
  });

  it('23. out-of-range aiConfidence is rejected', async () => {
    const { msA, msB } = await buildCurriculum();
    const question = await createQuestion();

    await expect(
      service.createMapping(STAFF, 'ADMIN', {
        questionId: question.id, microSkillId: msA.id, relevance: 0.5, aiConfidence: 1.4,
      })
    ).rejects.toThrow(/between 0 and 1/);

    await expect(
      service.createMapping(STAFF, 'ADMIN', {
        questionId: question.id, microSkillId: msB.id, relevance: 0.5, aiConfidence: -0.2,
      })
    ).rejects.toThrow(/between 0 and 1/);
  });

  // =================================================== SOURCE / PROVENANCE (24-26)

  it('24. a valid mapping source succeeds', async () => {
    const { msA } = await buildCurriculum();
    const question = await createQuestion();

    for (const source of ['MANUAL_REVIEW', 'AI', 'MEB', 'LICENSED_BANK'] as const) {
      const q = await createQuestion();
      const created = await service.createMapping(STAFF, 'ADMIN', {
        questionId: q.id, microSkillId: msA.id, relevance: 0.5, mappingSource: source,
      });
      expect(created.mappingSource).toBe(source);
    }
    expect(question.id).toBeTruthy();
  });

  it('25. an invalid mapping source is rejected', async () => {
    const { msA } = await buildCurriculum();
    const question = await createQuestion();

    await expect(
      service.createMapping(STAFF, 'ADMIN', {
        questionId: question.id, microSkillId: msA.id,
        relevance: 0.5, mappingSource: 'GUESSED',
      })
    ).rejects.toThrow(/Invalid mapping source/);
  });

  it('25b. AI_MAPPED is an accepted mapping source (Phase 5E bridge)', async () => {
    const { msA } = await buildCurriculum();
    const question = await createQuestion();

    const created = await service.createMapping(STAFF, 'ADMIN', {
      questionId: question.id, microSkillId: msA.id,
      relevance: 0.5, aiConfidence: 0.5, mappingSource: 'AI_MAPPED',
    });

    expect(created.mappingSource).toBe('AI_MAPPED');
    // AI-produced mappings begin as non-primary and non-reviewed.
    expect(created.isPrimary).toBe(false);
    expect(created.reviewed).toBe(false);
  });

  it('26. Question origin and trust are not mutated by mapping creation', async () => {
    const { msA } = await buildCurriculum();
    const question = await createQuestion({ origin: 'STUDENT_UPLOADED', trust: 'UNVERIFIED' });

    await service.createMapping(STAFF, 'ADMIN', {
      questionId: question.id, microSkillId: msA.id, isPrimary: true, relevance: 0.9,
    });

    const reloaded = await prisma.question.findUnique({ where: { id: question.id } });
    expect(reloaded?.origin).toBe('STUDENT_UPLOADED');
    expect(reloaded?.trust).toBe('UNVERIFIED');
  });

  // ============================================================== REVIEW (27-29)

  it('27. an invalid review state is rejected', async () => {
    const { msA } = await buildCurriculum();
    const question = await createQuestion();
    const created = await service.createMapping(STAFF, 'ADMIN', {
      questionId: question.id, microSkillId: msA.id, relevance: 0.5,
    });

    await expect(
      service.reviewMapping(STAFF, 'ADMIN', created.id, {
        reviewed: 'yes' as unknown as boolean,
      })
    ).rejects.toThrow(/reviewed must be a boolean/);
  });

  it('28. an authorized staff review succeeds', async () => {
    const { msA } = await buildCurriculum();
    const question = await createQuestion();
    const created = await service.createMapping(STAFF, 'ADMIN', {
      questionId: question.id, microSkillId: msA.id, relevance: 0.5,
    });

    const reviewed = await service.reviewMapping(STAFF, 'ADMIN', created.id, {
      reviewed: true,
      relevance: 0.85,
    });

    expect(reviewed.reviewed).toBe(true);
    expect(reviewed.relevance).toBeCloseTo(0.85);
  });

  it('29. an unauthorized student review is rejected', async () => {
    const { msA } = await buildCurriculum();
    const question = await createQuestion();
    const created = await service.createMapping(STAFF, 'ADMIN', {
      questionId: question.id, microSkillId: msA.id, relevance: 0.5,
    });

    await expect(
      service.reviewMapping(STUDENT, 'STUDENT', created.id, { reviewed: true })
    ).rejects.toThrow(/Insufficient permissions/);
  });

  // ========================================================= AUTHORIZATION (30-32)

  it('30. an unauthorized student cannot create a trusted mapping', async () => {
    const { msA } = await buildCurriculum();
    const question = await createQuestion();

    await expect(
      service.createMapping(STUDENT, 'STUDENT', {
        questionId: question.id, microSkillId: msA.id,
        isPrimary: true, relevance: 0.9, mappingSource: 'MEB',
      })
    ).rejects.toThrow(/Insufficient permissions/);

    expect(await prisma.questionSkillMapping.count()).toBe(0);
  });

  it('31. authorized staff can create a mapping', async () => {
    const { msA } = await buildCurriculum();

    for (const role of ['ADMIN', 'CONTENT_MANAGER', 'TEACHER'] as const) {
      const actor = await createUser(`p5d-${role}@example.com`, role);
      const q = await createQuestion();
      const created = await service.createMapping(actor.id, role, {
        questionId: q.id, microSkillId: msA.id, relevance: 0.5,
      });
      expect(created.id).toBeTruthy();
    }
  });

  it('32. service-layer authorization holds when the controller is bypassed', async () => {
    const { msA } = await buildCurriculum();
    const question = await createQuestion();

    // Direct service call, no HTTP layer at all.
    await expect(
      service.createMapping(STUDENT, 'STUDENT', {
        questionId: question.id, microSkillId: msA.id, relevance: 0.5,
      })
    ).rejects.toThrow(/QUESTION_SKILL_MAPPING_FORBIDDEN|Insufficient permissions/);
  });

  // ========================================================== IDEMPOTENCY (33-34)

  it('33. the same Idempotency-Key creates exactly one mapping', async () => {
    const { msA } = await buildCurriculum();
    const question = await createQuestion();
    const dto = {
      questionId: question.id, microSkillId: msA.id, relevance: 0.5,
    };

    const first = await service.createMapping(STAFF, 'ADMIN', dto, 'map-key-33');
    const second = await service.createMapping(STAFF, 'ADMIN', dto, 'map-key-33');

    expect(second.id).toBe(first.id);
    expect(await prisma.questionSkillMapping.count()).toBe(1);
  });

  it('34. a repeated idempotent request returns the same business result', async () => {
    const { msA } = await buildCurriculum();
    const question = await createQuestion();
    const dto = {
      questionId: question.id, microSkillId: msA.id, relevance: 0.5, isPrimary: true,
    };

    const first = await service.createMapping(STAFF, 'ADMIN', dto, 'map-key-34');
    const second = await service.createMapping(STAFF, 'ADMIN', dto, 'map-key-34');

    // The idempotency store persists the result as JSON, so Date fields are
    // returned as strings on the replay. Compare the business identity.
    expect(second.id).toBe(first.id);
    expect(second.questionId).toBe(first.questionId);
    expect(second.microSkillId).toBe(first.microSkillId);
    expect(second.isPrimary).toBe(first.isPrimary);
    expect(second.relevance).toBe(first.relevance);
    expect(await prisma.questionSkillMapping.count()).toBe(1);
  });

  // ============================================================ CONCURRENCY (35-36)

  it('35. concurrent identical PRIMARY requests leave at most one PRIMARY', async () => {
    const { msA, msB } = await buildCurriculum();
    const question = await createQuestion();

    await Promise.allSettled([
      service.createMapping(STAFF, 'ADMIN', {
        questionId: question.id, microSkillId: msA.id, isPrimary: true, relevance: 0.9,
      }),
      service.createMapping(STAFF, 'ADMIN', {
        questionId: question.id, microSkillId: msB.id, isPrimary: true, relevance: 0.9,
      }),
    ]);

    // SQLite serialises writers; the loser may receive a lock/timeout error.
    // The invariant that MUST hold regardless is PRIMARY count <= 1.
    const primaries = await prisma.questionSkillMapping.count({
      where: { questionId: question.id, isPrimary: true },
    });
    expect(primaries).toBeLessThanOrEqual(1);
  });

  it('36. concurrent identical Question+MicroSkill requests leave one mapping', async () => {
    const { msA } = await buildCurriculum();
    const question = await createQuestion();
    const dto = {
      questionId: question.id, microSkillId: msA.id, relevance: 0.5,
    };

    await Promise.allSettled([
      service.createMapping(STAFF, 'ADMIN', dto, 'map-key-36'),
      service.createMapping(STAFF, 'ADMIN', dto, 'map-key-36'),
    ]);

    expect(await prisma.questionSkillMapping.count()).toBe(1);
  });

  // ==================================================== CURRICULUM BOUNDARY (37-39)

  it('37. mappings use only existing MicroSkills', async () => {
    const { msA } = await buildCurriculum();
    const question = await createQuestion();
    const before = await prisma.microSkill.count();

    await service.createMapping(STAFF, 'ADMIN', {
      questionId: question.id, microSkillId: msA.id, relevance: 0.5,
    });

    expect(await prisma.microSkill.count()).toBe(before);
  });

  it('38. no new MicroSkill is created by mapping operations', async () => {
    const { msA } = await buildCurriculum();
    const question = await createQuestion();
    const before = await prisma.microSkill.findMany({ select: { code: true } });

    await service.createMapping(STAFF, 'ADMIN', {
      questionId: question.id, microSkillId: msA.id, relevance: 0.5,
    });

    const after = await prisma.microSkill.findMany({ select: { code: true } });
    expect(after.map((m) => m.code).sort()).toEqual(before.map((m) => m.code).sort());
  });

  it('39. existing CurriculumCandidate data is not modified', async () => {
    const { msA, lo } = await buildCurriculum();
    const question = await createQuestion();

    const candidate = await prisma.curriculumCandidate.create({
      data: {
        questionId: question.id, level: 'LEARNING_OUTCOME', targetId: lo.id,
        confidence: 0.7, decision: 'PENDING', method: 'MANUAL',
      },
    });

    await service.createMapping(STAFF, 'ADMIN', {
      questionId: question.id, microSkillId: msA.id, relevance: 0.5,
    });

    const reloaded = await prisma.curriculumCandidate.findUnique({ where: { id: candidate.id } });
    expect(reloaded?.decision).toBe('PENDING');
    expect(reloaded?.confidence).toBeCloseTo(0.7);
  });

  // ============================================================ REGRESSION (40-43)

  it('40. no QuestionSkillMapping leaks outside this suite’s own rows', async () => {
    const { msA } = await buildCurriculum();
    const question = await createQuestion();

    await service.createMapping(STAFF, 'ADMIN', {
      questionId: question.id, microSkillId: msA.id, relevance: 0.5,
    });

    // Exactly the one row this test created.
    expect(await prisma.questionSkillMapping.count()).toBe(1);
  });

  it('41. MicroSkill count reflects only this suite’s fixtures', async () => {
    await buildCurriculum();
    expect(await prisma.microSkill.count()).toBe(2);
  });

  it('42. ErrorPattern data is never touched by mapping operations', async () => {
    const { msA } = await buildCurriculum();
    const question = await createQuestion();
    const before = await prisma.errorPattern.count();

    await service.createMapping(STAFF, 'ADMIN', {
      questionId: question.id, microSkillId: msA.id, relevance: 0.5,
    });

    expect(await prisma.errorPattern.count()).toBe(before);
  });

  it('43. SkillMastery is never modified by mapping operations', async () => {
    const { msA } = await buildCurriculum();
    const question = await createQuestion();
    const before = await prisma.skillMastery.count();

    await service.createMapping(STAFF, 'ADMIN', {
      questionId: question.id, microSkillId: msA.id, relevance: 0.5,
    });

    expect(await prisma.skillMastery.count()).toBe(before);
  });

  // ==================================================== EXTRA: audit safety

  it('44. audit rows are written and contain no question content', async () => {
    const { msA } = await buildCurriculum();
    const question = await createQuestion({ content: 'CONFIDENTIAL-STEM-TEXT' });

    const created = await service.createMapping(STAFF, 'ADMIN', {
      questionId: question.id, microSkillId: msA.id, isPrimary: true, relevance: 0.9,
    });
    await service.reviewMapping(STAFF, 'ADMIN', created.id, { reviewed: true });

    const rows = await prisma.auditLog.findMany();
    const actions = rows.map((r) => r.action);
    expect(actions).toContain('QUESTION_SKILL_MAPPING_CREATED');
    expect(actions).toContain('QUESTION_SKILL_MAPPING_REVIEWED');

    for (const row of rows) {
      expect(row.details ?? '').not.toContain('CONFIDENTIAL-STEM-TEXT');
    }
  });

  it('45. promoting a SECONDARY to PRIMARY is blocked when a PRIMARY exists (I13)', async () => {
    const { msA, msB } = await buildCurriculum();
    const question = await createQuestion();

    await service.createMapping(STAFF, 'ADMIN', {
      questionId: question.id, microSkillId: msA.id, isPrimary: true, relevance: 0.9,
    });
    const secondary = await service.createMapping(STAFF, 'ADMIN', {
      questionId: question.id, microSkillId: msB.id, isPrimary: false, relevance: 0.4,
    });

    await expect(
      service.reviewMapping(STAFF, 'ADMIN', secondary.id, { reviewed: true, isPrimary: true })
    ).rejects.toThrow(/already has a PRIMARY/);

    expect(
      await prisma.questionSkillMapping.count({ where: { questionId: question.id, isPrimary: true } })
    ).toBe(1);
  });

  it('46. listing supports isPrimary and reviewed filters', async () => {
    const { msA, msB } = await buildCurriculum();
    const question = await createQuestion();

    await service.createMapping(STAFF, 'ADMIN', {
      questionId: question.id, microSkillId: msA.id, isPrimary: true, relevance: 0.9, reviewed: true,
    });
    await service.createMapping(STAFF, 'ADMIN', {
      questionId: question.id, microSkillId: msB.id, isPrimary: false, relevance: 0.4,
    });

    expect(await service.listMappingsForQuestion(question.id, { isPrimary: true })).toHaveLength(1);
    expect(await service.listMappingsForQuestion(question.id, { isPrimary: false })).toHaveLength(1);
    expect(await service.listMappingsForQuestion(question.id, { reviewed: false })).toHaveLength(1);
  });
});
