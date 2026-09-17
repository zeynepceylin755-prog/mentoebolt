import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { IdempotencyService } from '../../src/infrastructure/idempotency/IdempotencyService.js';
import { CurriculumCandidateService } from '../../src/application/services/curriculum/CurriculumCandidateService.js';
import { QuestionSkillMappingService } from '../../src/application/services/skills/QuestionSkillMappingService.js';
import { QuestionCurriculumMappingService } from '../../src/application/services/ingestion/QuestionCurriculumMappingService.js';

/**
 * Phase 5F.2 — QuestionCurriculumMappingService orchestration boundary.
 *
 * Scope: coordination only. Candidate/mapping persistence is delegated to the
 * existing Phase 5C / Phase 5D services, each owning its own transaction. This
 * suite verifies the orchestration contract, the real-Question-id requirement,
 * the review boundary, I13, provenance and idempotency.
 */
describe('QuestionCurriculumMappingService - Phase 5F.2', () => {
  let prisma: PrismaClient;
  let service: QuestionCurriculumMappingService;

  beforeEach(async () => {
    prisma = new PrismaClient();
    const idempotencyService = new IdempotencyService(prisma);
    service = new QuestionCurriculumMappingService(
      prisma,
      new CurriculumCandidateService(prisma, idempotencyService),
      new QuestionSkillMappingService(prisma, idempotencyService)
    );
    // Curriculum ancestors are not cleared by the global setup; clear them here
    // so each test owns its fixtures.
    await prisma.questionSkillMapping.deleteMany();
    await prisma.curriculumCandidate.deleteMany();
    await prisma.questionIngestion.deleteMany();
    await prisma.question.deleteMany();
    await prisma.microSkill.deleteMany();
    await prisma.processComponent.deleteMany();
    await prisma.learningOutcome.deleteMany();
    await prisma.theme.deleteMany();
    await prisma.curriculumVersion.deleteMany();
    await prisma.user.deleteMany();
  });

  afterEach(async () => {
    await prisma.$disconnect();
  });

  // ---------------------------------------------------------------- fixtures

  async function ensureUser(id: string, role: string) {
    await prisma.user.upsert({
      where: { id },
      update: { role },
      create: { id, email: `${id}@example.com`, firstName: 'P5F2', lastName: 'Actor', role },
    });
    return id;
  }

  async function buildCurriculum() {
    const uid = Math.random().toString(36).slice(2, 10);
    const version = await prisma.curriculumVersion.create({
      data: { code: 'P5F2-CUR-' + uid, name: 'P5F2', grade: 11, subject: 'Matematik', version: '1.0', source: 'TEST_FIXTURE' },
    });
    const theme = await prisma.theme.create({
      data: { curriculumVersionId: version.id, officialCode: 'P5F2.T1-' + uid, name: 'P5F2 theme', lessonHours: 1, sourceOrder: 1 },
    });
    const lo = await prisma.learningOutcome.create({
      data: { themeId: theme.id, officialCode: 'P5F2.LO1-' + uid, officialText: 'P5F2 outcome', sourceOrder: 1 },
    });
    const pc = await prisma.processComponent.create({
      data: { learningOutcomeId: lo.id, officialCode: 'P5F2.PC1-' + uid, officialText: 'P5F2 component', sourceOrder: 1 },
    });
    const microSkill = await prisma.microSkill.create({
      data: { processComponentId: pc.id, code: 'P5F2.MS1-' + uid, name: 'P5F2 skill', description: 'fixture', source: 'TEST_FIXTURE' },
    });
    return { version, theme, lo, pc, microSkill };
  }

  async function createQuestion(overrides: Record<string, unknown> = {}) {
    return prisma.question.create({
      data: {
        content: 'P5F2 canonical question', type: 'OPEN_ENDED', difficulty: 1,
        skillId: 'unmapped', correctAnswer: '', isActive: false, isFixture: true,
        ...overrides,
      },
    });
  }

  const proposalFor = (lo: any, pc: any, microSkill: any) => ({
    curriculumCandidates: [
      { level: 'LEARNING_OUTCOME' as const, targetId: lo.id, confidence: 0.8, rationale: 'lo match' },
      { level: 'PROCESS_COMPONENT' as const, targetId: pc.id, confidence: 0.8, rationale: 'pc match' },
    ],
    microSkillCandidates: [
      { microSkillId: microSkill.id, confidence: 0.7, rationale: 'ms match' },
    ],
  });

  // ============================================================== A. real id

  it('A. a missing canonical Question id is never replaced with a placeholder', async () => {
    await ensureUser('staff-1', 'ADMIN');
    const { lo, pc, microSkill } = await buildCurriculum();

    const result = await service.applyProposal({
      actorUserId: 'staff-1',
      actorRole: 'ADMIN',
      questionId: null,
      proposal: proposalFor(lo, pc, microSkill),
    });

    expect(result.mapped).toBe(false);
    expect(result.skippedReason).toBe('NO_CANONICAL_QUESTION');
    expect(await prisma.curriculumCandidate.count()).toBe(0);
    expect(await prisma.questionSkillMapping.count()).toBe(0);
    // No row anywhere references a fabricated id.
  });

  it('A2. an unknown (non-existent) Question id is treated as missing, not created', async () => {
    await ensureUser('staff-1', 'ADMIN');
    const { lo, pc, microSkill } = await buildCurriculum();

    const result = await service.applyProposal({
      actorUserId: 'staff-1',
      actorRole: 'ADMIN',
      questionId: 'does-not-exist',
      proposal: proposalFor(lo, pc, microSkill),
    });

    expect(result.mapped).toBe(false);
    expect(await prisma.questionSkillMapping.count()).toBe(0);
  });

  // ============================================================= B/D. happy

  it('B/D. a valid proposal creates curriculum candidates and a mapping for a real Question', async () => {
    await ensureUser('staff-1', 'ADMIN');
    const { lo, pc, microSkill } = await buildCurriculum();
    const question = await createQuestion();

    const result = await service.applyProposal({
      actorUserId: 'staff-1',
      actorRole: 'ADMIN',
      questionId: question.id,
      proposal: proposalFor(lo, pc, microSkill),
    });

    expect(result.mapped).toBe(true);
    expect(result.curriculumCandidatesCreated).toBe(2);

    const candidates = await prisma.curriculumCandidate.findMany({ where: { questionId: question.id } });
    expect(candidates.length).toBe(2);
    for (const c of candidates) {
      expect(['LEARNING_OUTCOME', 'PROCESS_COMPONENT']).toContain(c.level);
      expect(c.method).toBe('AI_MAPPED');
    }

    const mappings = await prisma.questionSkillMapping.findMany({ where: { questionId: question.id } });
    expect(mappings.length).toBe(1);
    expect(mappings[0].mappingSource).toBe('AI_MAPPED');
    expect(mappings[0].isPrimary).toBe(false);
    expect(mappings[0].reviewed).toBe(false);
    expect(mappings[0].microSkillId).toBe(microSkill.id);
  });

  // ============================================================== E. invalid

  it('E. invalid curriculum / MicroSkill targets are rejected by the existing validators', async () => {
    await ensureUser('staff-1', 'ADMIN');
    await buildCurriculum();
    const question = await createQuestion();

    const result = await service.applyProposal({
      actorUserId: 'staff-1',
      actorRole: 'ADMIN',
      questionId: question.id,
      proposal: {
        curriculumCandidates: [
          { level: 'LEARNING_OUTCOME' as const, targetId: 'unknown-lo', confidence: 0.8, rationale: 'x' },
        ],
        microSkillCandidates: [
          { microSkillId: 'unknown-ms', confidence: 0.7, rationale: 'y' },
        ],
      },
    });

    // Rejected candidates/mappings are counted as not-created; nothing is written.
    expect(result.curriculumCandidatesCreated).toBe(0);
    expect(result.microSkillMappingsCreated).toBe(0);
    expect(await prisma.curriculumCandidate.count()).toBe(0);
    expect(await prisma.questionSkillMapping.count()).toBe(0);
  });

  // ============================================================ F. review

  it('F. an unreviewed AI proposal never becomes authoritative (no PRIMARY, not reviewed)', async () => {
    await ensureUser('staff-1', 'ADMIN');
    const { lo, pc, microSkill } = await buildCurriculum();
    const question = await createQuestion();

    await service.applyProposal({
      actorUserId: 'staff-1', actorRole: 'ADMIN', questionId: question.id,
      proposal: proposalFor(lo, pc, microSkill),
    });

    const primary = await prisma.questionSkillMapping.count({ where: { questionId: question.id, isPrimary: true } });
    const reviewed = await prisma.questionSkillMapping.count({ where: { questionId: question.id, reviewed: true } });
    expect(primary).toBe(0);
    expect(reviewed).toBe(0);
  });

  // ================================================================= G. I13

  it('G. an existing PRIMARY stays the only PRIMARY; the AI mapping is SECONDARY', async () => {
    await ensureUser('staff-1', 'ADMIN');
    const { lo, pc, microSkill: primarySkill } = await buildCurriculum();
    const { microSkill: aiSkill } = await buildCurriculum();
    const question = await createQuestion();

    const mappingService = new QuestionSkillMappingService(prisma);
    const existingPrimary = await mappingService.createMapping('staff-1', 'ADMIN', {
      questionId: question.id, microSkillId: primarySkill.id,
      relevance: 0.9, isPrimary: true, reviewed: true, mappingSource: 'MANUAL_REVIEW',
    });

    await service.applyProposal({
      actorUserId: 'staff-1', actorRole: 'ADMIN', questionId: question.id,
      proposal: {
        curriculumCandidates: [],
        microSkillCandidates: [{ microSkillId: aiSkill.id, confidence: 0.7, rationale: 'ms' }],
      },
    });

    const primaries = await prisma.questionSkillMapping.findMany({ where: { questionId: question.id, isPrimary: true } });
    expect(primaries.length).toBe(1);
    expect(primaries[0].id).toBe(existingPrimary.id);
    void lo; void pc;
  });

  // =========================================================== H. provenance

  it('H. orchestration never mutates Question provenance (origin/trust)', async () => {
    await ensureUser('staff-1', 'ADMIN');
    const { lo, pc, microSkill } = await buildCurriculum();
    const question = await createQuestion({ origin: 'STUDENT_UPLOADED', trust: 'UNVERIFIED' });

    await service.applyProposal({
      actorUserId: 'staff-1', actorRole: 'ADMIN', questionId: question.id,
      proposal: proposalFor(lo, pc, microSkill),
    });

    const reloaded = await prisma.question.findUnique({ where: { id: question.id } });
    expect(reloaded?.origin).toBe('STUDENT_UPLOADED');
    expect(reloaded?.trust).toBe('UNVERIFIED');
  });

  // ========================================================== I. authoriz.

  it('I. a student caller produces no curriculum/mapping artefacts (no elevation)', async () => {
    await ensureUser('student-1', 'STUDENT');
    const { lo, pc, microSkill } = await buildCurriculum();
    const question = await createQuestion();

    const result = await service.applyProposal({
      actorUserId: 'student-1', actorRole: 'STUDENT', questionId: question.id,
      proposal: proposalFor(lo, pc, microSkill),
    });

    expect(result.mapped).toBe(false);
    expect(result.curriculumCandidatesCreated).toBe(0);
    expect(result.microSkillMappingsCreated).toBe(0);
    expect(await prisma.curriculumCandidate.count()).toBe(0);
    expect(await prisma.questionSkillMapping.count()).toBe(0);
  });

  // ========================================================== J. idempotency

  it('J. replaying the same proposal with an idempotency key creates no duplicates', async () => {
    await ensureUser('staff-1', 'ADMIN');
    const { lo, pc, microSkill } = await buildCurriculum();
    const question = await createQuestion();
    const proposal = proposalFor(lo, pc, microSkill);

    const input = {
      actorUserId: 'staff-1', actorRole: 'ADMIN', questionId: question.id,
      proposal, idempotencyKey: 'p5f2-key-1',
    };
    const r1 = await service.applyProposal(input);
    const countC = await prisma.curriculumCandidate.count({ where: { questionId: question.id } });
    const countM = await prisma.questionSkillMapping.count({ where: { questionId: question.id } });
    const r2 = await service.applyProposal(input);
    const countC2 = await prisma.curriculumCandidate.count({ where: { questionId: question.id } });
    const countM2 = await prisma.questionSkillMapping.count({ where: { questionId: question.id } });

    expect(r1.curriculumCandidatesCreated).toBe(2);
    expect(r2.curriculumCandidatesCreated).toBe(r1.curriculumCandidatesCreated);
    expect(countC2).toBe(countC);
    expect(countM2).toBe(countM);
  });

  it('J2. the same idempotency key with a different payload still conflicts', async () => {
    await ensureUser('staff-1', 'ADMIN');
    const { lo, pc, microSkill } = await buildCurriculum();
    const { microSkill: other } = await buildCurriculum();
    const question = await createQuestion();

    await service.applyProposal({
      actorUserId: 'staff-1', actorRole: 'ADMIN', questionId: question.id,
      proposal: proposalFor(lo, pc, microSkill), idempotencyKey: 'p5f2-key-2',
    });

    await expect(
      service.applyProposal({
        actorUserId: 'staff-1', actorRole: 'ADMIN', questionId: question.id,
        proposal: proposalFor(lo, pc, other), idempotencyKey: 'p5f2-key-2',
      })
    ).rejects.toThrow();
  });

  // =============================================================== K. audit

  it('K. audit rows exist and never contain raw question content', async () => {
    await ensureUser('staff-1', 'ADMIN');
    const { lo, pc, microSkill } = await buildCurriculum();
    const question = await createQuestion({ content: 'SENSITIVE-P5F2-STEM' });

    await service.applyProposal({
      actorUserId: 'staff-1', actorRole: 'ADMIN', questionId: question.id,
      proposal: proposalFor(lo, pc, microSkill),
    });

    const rows = await prisma.auditLog.findMany();
    const actions = rows.map((r) => r.action);
    expect(actions).toContain('CURRICULUM_CANDIDATE_CREATED');
    expect(actions).toContain('QUESTION_SKILL_MAPPING_CREATED');
    for (const row of rows) {
      expect(row.details ?? '').not.toContain('SENSITIVE-P5F2-STEM');
    }
  });
});
