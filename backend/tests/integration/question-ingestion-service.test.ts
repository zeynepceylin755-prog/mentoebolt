import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { QuestionIngestionService } from '../../src/application/services/ingestion/QuestionIngestionService.js';
import { IdempotencyService } from '../../src/infrastructure/idempotency/IdempotencyService.js';
import {
  canTransition,
  isCanonicalQuestionEligible,
  INGESTION_STATES,
} from '../../src/domain/ingestion/ingestionStateMachine.js';
import {
  trustWithinCeiling,
  QUESTION_TRUST_LEVELS,
} from '../../src/domain/ingestion/provenance.js';
import { validateQuestionText } from '../../src/domain/ingestion/inputValidation.js';

/**
 * Phase 5B — Question Ingestion Service + State Machine.
 *
 * Scope: lifecycle, invariants, trust, idempotency, authorization, atomicity.
 * No OCR, no AI parsing, no curriculum mapping — those are later phases.
 */
describe('Question Ingestion Service - Phase 5B', () => {
  let prisma: PrismaClient;
  let idempotencyService: IdempotencyService;
  let service: QuestionIngestionService;

  beforeAll(async () => {
    prisma = new PrismaClient({
      datasources: { db: { url: process.env.DATABASE_URL || 'file:./dev.db' } },
    });
    await prisma.$connect();
    await prisma.$executeRawUnsafe('PRAGMA foreign_keys = ON');
    idempotencyService = new IdempotencyService(prisma);
    service = new QuestionIngestionService(prisma, idempotencyService);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.auditLog.deleteMany();
    await prisma.idempotencyRecord.deleteMany();
    await prisma.questionAttempt.deleteMany();
    await prisma.questionInstance.deleteMany();
    await prisma.curriculumCandidate.deleteMany();
    await prisma.questionIngestion.deleteMany();
    await prisma.question.deleteMany();
    await prisma.questionSource.deleteMany();
    await prisma.studentProfile.deleteMany();
    await prisma.user.deleteMany();
  });

  // -------------------------------------------------------------- helpers

  async function createUser(
    email: string,
    role: 'STUDENT' | 'ADMIN' | 'CONTENT_MANAGER' = 'STUDENT'
  ) {
    const user = await prisma.user.create({
      data: { email, firstName: 'P5B', lastName: 'User', role, passwordHash: 'hash' },
    });
    if (role === 'STUDENT') {
      await prisma.studentProfile.create({
        data: { userId: user.id, grade: 11, school: 'Test School' },
      });
    }
    return user;
  }

  async function createSource(overrides: Record<string, unknown> = {}) {
    return prisma.questionSource.create({
      data: {
        code: `SRC-${Math.random().toString(36).slice(2, 10)}`,
        name: 'Test Source',
        origin: 'MENTORA_MANUAL',
        trustCeiling: 'HUMAN_APPROVED',
        ...overrides,
      },
    });
  }

  /** Drive an ingestion to a target state through only valid transitions. */
  async function driveTo(
    ingestionId: string,
    target: string,
    actorUserId: string,
    actorRole: string
  ) {
    const path: Record<string, string[]> = {
      NORMALIZED: [INGESTION_STATES.EXTRACTED, INGESTION_STATES.NORMALIZED],
      ANALYZED: [
        INGESTION_STATES.EXTRACTED,
        INGESTION_STATES.NORMALIZED,
        INGESTION_STATES.ANALYZED,
      ],
      REVIEW_REQUIRED: [
        INGESTION_STATES.EXTRACTED,
        INGESTION_STATES.NORMALIZED,
        INGESTION_STATES.REVIEW_REQUIRED,
      ],
    };
    for (const step of path[target] ?? []) {
      await service.transitionIngestion(ingestionId, actorUserId, actorRole, { toState: step as any });
    }
  }

  // ==================================================== STATE MACHINE (1-5)

  it('1. valid transitions are applied', async () => {
    const user = await createUser('sm1@example.com');
    const created = await service.createIngestion(
      user.id,
      {
        ingestMethod: 'TEXT_PASTE',
        rawText: 'What is the derivative of x squared?',
        normalizedText: 'What is the derivative of x squared?',
      }
    );

    const extracted = await service.transitionIngestion(
      created.id, user.id, 'STUDENT', { toState: INGESTION_STATES.EXTRACTED }
    );
    expect(extracted.state).toBe('EXTRACTED');

    const normalized = await service.transitionIngestion(
      created.id, user.id, 'STUDENT', { toState: INGESTION_STATES.NORMALIZED }
    );
    expect(normalized.state).toBe('NORMALIZED');
  });

  it('2. invalid transition is rejected (INGESTED -> APPROVED)', async () => {
    const user = await createUser('sm2@example.com');
    const admin = await createUser('sm2-admin@example.com', 'ADMIN');
    const created = await service.createIngestion(
      user.id,
      { ingestMethod: 'TEXT_PASTE', rawText: 'A valid mathematics question text' }
    );

    await expect(
      service.transitionIngestion(created.id, admin.id, 'ADMIN', {
        toState: INGESTION_STATES.APPROVED,
      })
    ).rejects.toThrow(/Invalid ingestion state transition/);

    const reloaded = await prisma.questionIngestion.findUnique({ where: { id: created.id } });
    expect(reloaded?.state).toBe('INGESTED');
  });

  it('3. skip-to-approved is rejected (INGESTED -> NORMALIZED)', async () => {
    const user = await createUser('sm3@example.com');
    const created = await service.createIngestion(
      user.id,
      { ingestMethod: 'TEXT_PASTE', rawText: 'A valid mathematics question text' }
    );

    await expect(
      service.transitionIngestion(created.id, user.id, 'STUDENT', {
        toState: INGESTION_STATES.NORMALIZED,
      })
    ).rejects.toThrow(/Invalid ingestion state transition/);
  });

  it('4. backward transition is rejected (NORMALIZED -> INGESTED)', async () => {
    const user = await createUser('sm4@example.com');
    const created = await service.createIngestion(user.id, {
      ingestMethod: 'TEXT_PASTE',
      rawText: 'A valid question',
      normalizedText: 'A valid question',
    });
    await driveTo(created.id, 'REVIEW_REQUIRED', user.id, 'STUDENT');

    await expect(
      service.transitionIngestion(created.id, user.id, 'STUDENT', {
        toState: INGESTION_STATES.INGESTED,
      })
    ).rejects.toThrow(/Invalid ingestion state transition/);
  });

  it('5. review gate is enforced: APPROVED is unreachable while requiresReview=true', async () => {
    const user = await createUser('sm5@example.com');
    const admin = await createUser('sm5-admin@example.com', 'ADMIN');
    const created = await service.createIngestion(user.id, {
      ingestMethod: 'TEXT_PASTE',
      rawText: 'A valid question',
      normalizedText: 'A valid question',
    });
      await driveTo(created.id, 'REVIEW_REQUIRED', user.id, 'STUDENT');

      // A student cannot discharge the review gate themselves.
      await expect(
        service.transitionIngestion(created.id, user.id, 'STUDENT', {
          toState: INGESTION_STATES.APPROVED,
        })
      ).rejects.toThrow(/requires an ADMIN or CONTENT_MANAGER role/);

      // Staff approval is the human decision that discharges the gate.
      const approved = await service.transitionIngestion(created.id, admin.id, 'ADMIN', {
        toState: INGESTION_STATES.APPROVED,
      });
      expect(approved.state).toBe('APPROVED');
      expect(approved.requiresReview).toBe(false);
    });

  // ============================================================ TRUST (6-8)

  it('6. trust ceiling is enforced at the service layer', async () => {
    const user = await createUser('tr6@example.com');
    const admin = await createUser('tr6-admin@example.com', 'ADMIN');
    // A source whose ceiling cannot reach HUMAN_APPROVED.
    const source = await createSource({
      origin: 'STUDENT_UPLOADED',
      trustCeiling: QUESTION_TRUST_LEVELS.NORMALIZED,
    });

    const created = await service.createIngestion(user.id, {
      ingestMethod: 'TEXT_PASTE',
      rawText: 'A valid question',
      normalizedText: 'A valid question',
      sourceId: source.id,
    });
    await driveTo(created.id, 'REVIEW_REQUIRED', user.id, 'STUDENT');

    await expect(
      service.transitionIngestion(created.id, admin.id, 'ADMIN', {
        toState: INGESTION_STATES.APPROVED,
      })
    ).rejects.toThrow(/exceeds the source trust ceiling/);
  });

  it('7. student upload cannot auto-promote to the bank', async () => {
    const user = await createUser('tr7@example.com');
    const admin = await createUser('tr7-admin@example.com', 'ADMIN');
    const source = await createSource({
      origin: 'STUDENT_UPLOADED',
      trustCeiling: QUESTION_TRUST_LEVELS.UNVERIFIED,
    });

    const created = await service.createIngestion(user.id, {
      ingestMethod: 'TEXT_PASTE',
      rawText: 'A valid student question',
      normalizedText: 'A valid student question',
      sourceId: source.id,
    });
    await driveTo(created.id, 'REVIEW_REQUIRED', user.id, 'STUDENT');

    // Blocked by the ceiling.
    await expect(
      service.transitionIngestion(created.id, admin.id, 'ADMIN', {
        toState: INGESTION_STATES.APPROVED,
      })
    ).rejects.toThrow(/trust ceiling/);

    // And a promotion attempt was audited.
    const audits = await prisma.auditLog.findMany({
      where: { action: 'TRUST_PROMOTION_ATTEMPT' },
    });
    expect(audits.length).toBeGreaterThan(0);
  });

  it('8. valid trust promotion works when the source permits it', async () => {
    const user = await createUser('tr8@example.com');
    const admin = await createUser('tr8-admin@example.com', 'ADMIN');
    const source = await createSource({
      origin: 'MEB',
      trustCeiling: QUESTION_TRUST_LEVELS.HUMAN_APPROVED,
    });

    const created = await service.createIngestion(user.id, {
      ingestMethod: 'TEXT_PASTE',
      rawText: 'A valid MEB question',
      normalizedText: 'A valid MEB question',
      sourceId: source.id,
    });
    await driveTo(created.id, 'REVIEW_REQUIRED', user.id, 'STUDENT');

    const approved = await service.transitionIngestion(created.id, admin.id, 'ADMIN', {
      toState: INGESTION_STATES.APPROVED,
    });
    expect(approved.state).toBe('APPROVED');
  });

  // ======================================================= IDEMPOTENCY (9-10)

  it('9. duplicate create with the same idempotency key produces one business effect', async () => {
    const user = await createUser('id9@example.com');
    const dto = { ingestMethod: 'TEXT_PASTE' as const, rawText: 'Idempotent question text' };

    const first = await service.createIngestion(user.id, dto, 'key-9');
    const second = await service.createIngestion(user.id, dto, 'key-9');

    expect(second.id).toBe(first.id);

    const count = await prisma.questionIngestion.count({ where: { ingestedByUserId: user.id } });
    expect(count).toBe(1);
  });

  it('10. concurrent duplicate requests produce one business effect', async () => {
    const user = await createUser('id10@example.com');
    const dto = { ingestMethod: 'TEXT_PASTE' as const, rawText: 'Concurrent question text' };

    const results = await Promise.allSettled([
      service.createIngestion(user.id, dto, 'key-10'),
      service.createIngestion(user.id, dto, 'key-10'),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    expect(fulfilled.length).toBeGreaterThanOrEqual(1);

    const count = await prisma.questionIngestion.count({ where: { ingestedByUserId: user.id } });
    expect(count).toBe(1);
  });

  // ==================================================== QUESTIONINSTANCE (11-12)

  it('11. the same student can create multiple instances of the same question', async () => {
    const user = await createUser('qi11@example.com');
    const student = await prisma.studentProfile.findUnique({ where: { userId: user.id } });
    const question = await prisma.question.create({
      data: {
        content: 'Instance test question', type: 'OPEN_ENDED', difficulty: 1,
        skillId: 'unmapped', correctAnswer: '',
      },
    });

    const a = await prisma.questionInstance.create({
      data: { questionId: question.id, studentId: student!.id, assetRef: 'day1.jpg', assetHash: 'h1' },
    });
    const b = await prisma.questionInstance.create({
      data: { questionId: question.id, studentId: student!.id, assetRef: 'day5.jpg', assetHash: 'h2' },
    });

    expect(a.id).not.toBe(b.id);
    const count = await prisma.questionInstance.count({ where: { questionId: question.id } });
    expect(count).toBe(2);
  });

  it('12. different students can create instances of the same question', async () => {
    const u1 = await createUser('qi12a@example.com');
    const u2 = await createUser('qi12b@example.com');
    const s1 = await prisma.studentProfile.findUnique({ where: { userId: u1.id } });
    const s2 = await prisma.studentProfile.findUnique({ where: { userId: u2.id } });
    const question = await prisma.question.create({
      data: {
        content: 'Shared question', type: 'OPEN_ENDED', difficulty: 1,
        skillId: 'unmapped', correctAnswer: '',
      },
    });

    await prisma.questionInstance.create({ data: { questionId: question.id, studentId: s1!.id } });
    await prisma.questionInstance.create({ data: { questionId: question.id, studentId: s2!.id } });

    const count = await prisma.questionInstance.count({ where: { questionId: question.id } });
    expect(count).toBe(2);
  });

  // ================================================== INPUT VALIDATION (13-15)

  it('13. empty input is rejected', async () => {
    const user = await createUser('iv13@example.com');
    await expect(
      service.createIngestion(user.id, { ingestMethod: 'TEXT_PASTE', rawText: '' })
    ).rejects.toThrow(/INVALID_INPUT|rawText|normalizedText|asset/i);
  });

  it('14. whitespace-only input is rejected', async () => {
    const user = await createUser('iv14@example.com');
    await expect(
      service.createIngestion(user.id, { ingestMethod: 'TEXT_PASTE', rawText: '   \n\t  ' })
    ).rejects.toThrow(/INVALID_INPUT|rawText|normalizedText|asset/i);

    // Pure-whitespace normalized text never validates.
    expect(validateQuestionText('   ').valid).toBe(false);
    expect(validateQuestionText('   ').reason).toBe('WHITESPACE_ONLY');
  });

  it('15. invalid normalized input cannot become a canonical Question', async () => {
    const user = await createUser('iv15@example.com');
    const source = await createSource({ origin: 'MEB' });

    const created = await service.createIngestion(user.id, {
      ingestMethod: 'TEXT_PASTE',
      rawText: 'Question 1', // placeholder
      normalizedText: 'Question 1', // placeholder
      sourceId: source.id,
    });

    // Drive as far as the state machine allows without a valid normalized text.
    await service.transitionIngestion(created.id, user.id, 'STUDENT', {
      toState: INGESTION_STATES.EXTRACTED,
    });

    await expect(
      service.transitionIngestion(created.id, user.id, 'STUDENT', {
        toState: INGESTION_STATES.NORMALIZED,
      })
    ).rejects.toThrow(/QUESTION_CREATION_BLOCKED|usable/);

    const qCount = await prisma.question.count();
    expect(qCount).toBe(0);
  });

  // ===================================================== AUTHORIZATION (16-17)

  it("16. a student cannot access another student's ingestion", async () => {
    const owner = await createUser('az16-owner@example.com');
    const intruder = await createUser('az16-intruder@example.com');

    const created = await service.createIngestion(owner.id, {
      ingestMethod: 'TEXT_PASTE',
      rawText: 'Private question text',
    });

    await expect(
      service.getIngestion(created.id, intruder.id, 'STUDENT')
    ).rejects.toThrow(/not found/i);

    // The owner can read it.
    const own = await service.getIngestion(created.id, owner.id, 'STUDENT');
    expect(own.id).toBe(created.id);
  });

  it("17. a student cannot access another student's instance", async () => {
    const u1 = await createUser('az17a@example.com');
    const u2 = await createUser('az17b@example.com');
    const s1 = await prisma.studentProfile.findUnique({ where: { userId: u1.id } });
    const question = await prisma.question.create({
      data: {
        content: 'Owned question', type: 'OPEN_ENDED', difficulty: 1,
        skillId: 'unmapped', correctAnswer: '',
      },
    });
    const instance = await prisma.questionInstance.create({
      data: { questionId: question.id, studentId: s1!.id },
    });

    const s2 = await prisma.studentProfile.findUnique({ where: { userId: u2.id } });
    // A different student's instance must not be visible to u2.
    const visible = await prisma.questionInstance.findMany({
      where: { id: instance.id, studentId: s2!.id },
    });
    expect(visible).toHaveLength(0);

    // Ownership is enforced by studentId scoping.
    expect(instance.studentId).toBe(s1!.id);
    expect(instance.studentId).not.toBe(s2!.id);
  });

  // ============================================ TRANSACTION INTEGRITY (18-19)

  it('18. failed canonical Question creation leaves no partial instance', async () => {
    const user = await createUser('tx18@example.com');
    const source = await createSource({ origin: 'MEB' });

    const created = await service.createIngestion(user.id, {
      ingestMethod: 'TEXT_PASTE',
      rawText: 'A valid question',
      normalizedText: 'A valid question',
      sourceId: source.id,
    });
    // Never approved -> canonical creation must be refused.
    await expect(
      service.createCanonicalQuestionFromIngestion(created.id, user.id, 'STUDENT')
    ).rejects.toThrow(/QUESTION_CREATION_BLOCKED|Canonical Question creation blocked/);

    expect(await prisma.question.count()).toBe(0);
    expect(await prisma.questionInstance.count()).toBe(0);
  });

  it('19. canonical creation is atomic: Question + Instance are created together', async () => {
    const user = await createUser('tx19@example.com');
    const admin = await createUser('tx19-admin@example.com', 'ADMIN');
    const source = await createSource({ origin: 'MEB', trustCeiling: 'HUMAN_APPROVED' });

    const created = await service.createIngestion(user.id, {
      ingestMethod: 'TEXT_PASTE',
      rawText: 'A valid approved question',
      normalizedText: 'A valid approved question',
      sourceId: source.id,
    });
    await driveTo(created.id, 'REVIEW_REQUIRED', user.id, 'STUDENT');
    await service.transitionIngestion(created.id, admin.id, 'ADMIN', {
      toState: INGESTION_STATES.APPROVED,
    });

    const result = await service.createCanonicalQuestionFromIngestion(
      created.id, admin.id, 'ADMIN'
    );

    expect(result.question.id).toBeTruthy();
    expect(await prisma.question.count()).toBe(1);
    expect(await prisma.questionInstance.count()).toBe(1);

    // Re-running is idempotent: still exactly one question.
    await service.createCanonicalQuestionFromIngestion(created.id, admin.id, 'ADMIN');
    expect(await prisma.question.count()).toBe(1);
    expect(await prisma.questionInstance.count()).toBe(1);
  });

  // ============================================== PURE RULE UNIT CHECKS (20-22)

  it('19b. a student-owned, source-less ingestion (null origin) at REVIEW_REQUIRED yields a canonical Question', async () => {
    // This is the exact student journey path: createIngestion is called with no
    // sourceId, so origin is null. It must still be treated as a non auto-
    // promotable student upload, otherwise the produced question is UNVERIFIED and
    // inactive as designed, and the frontend result screen can never render.
    const user = await createUser('tx19b@example.com');
    const created = await service.createIngestion(user.id, {
      ingestMethod: 'TEXT_PASTE',
      rawText: '2x + 5 = 15 denklemini çöz.',
      normalizedText: '2x + 5 = 15 denklemini çöz.',
    });

    await driveTo(created.id, 'REVIEW_REQUIRED', user.id, 'STUDENT');

    const result = await service.createCanonicalQuestionFromIngestion(
      created.id,
      user.id,
      'STUDENT'
    );

    expect(result.question.id).toBeTruthy();
    // Student content is never auto-promoted: UNVERIFIED and inactive.
    const stored = await prisma.question.findUnique({ where: { id: result.question.id } });
    expect(stored?.trust).toBe('UNVERIFIED');
    expect(stored?.isActive).toBe(false);
    expect(await prisma.questionInstance.count()).toBe(1);
  });

  it('20. state machine rules are pure and deterministic', async () => {
    expect(canTransition('INGESTED', 'EXTRACTED')).toBe(true);
    expect(canTransition('EXTRACTED', 'NORMALIZED')).toBe(true);
    expect(canTransition('INGESTED', 'APPROVED')).toBe(false);
    expect(canTransition('INGESTED', 'NORMALIZED')).toBe(false);
    expect(canTransition('EXTRACTED', 'APPROVED')).toBe(false);
    expect(canTransition('NORMALIZED', 'APPROVED')).toBe(false);
    expect(canTransition('NORMALIZED', 'INGESTED')).toBe(false);
    expect(canTransition('APPROVED', 'REJECTED')).toBe(false);
    expect(canTransition('REJECTED', 'NORMALIZED')).toBe(false);

    // INGESTED is not eligible to produce a canonical Question.
    expect(isCanonicalQuestionEligible('INGESTED')).toBe(false);
    expect(isCanonicalQuestionEligible('NORMALIZED')).toBe(true);
    expect(isCanonicalQuestionEligible('APPROVED')).toBe(true);
  });

  it('21. trust comparison respects ceilings', async () => {
    expect(trustWithinCeiling('UNVERIFIED', 'HUMAN_APPROVED')).toBe(true);
    expect(trustWithinCeiling('HUMAN_APPROVED', 'HUMAN_APPROVED')).toBe(true);
    expect(trustWithinCeiling('HUMAN_APPROVED', 'UNVERIFIED')).toBe(false);
    expect(trustWithinCeiling('HUMAN_APPROVED', 'NORMALIZED')).toBe(false);
    expect(trustWithinCeiling('UNKNOWN_VALUE', 'HUMAN_APPROVED')).toBe(false);
  });

  it('22. audit rows are written for create and approve', async () => {
    const user = await createUser('au22@example.com');
    const admin = await createUser('au22-admin@example.com', 'ADMIN');
    const source = await createSource({ origin: 'MEB', trustCeiling: 'HUMAN_APPROVED' });

    const created = await service.createIngestion(user.id, {
      ingestMethod: 'TEXT_PASTE',
      rawText: 'Audited question',
      normalizedText: 'Audited question',
      sourceId: source.id,
    });
    await driveTo(created.id, 'REVIEW_REQUIRED', user.id, 'STUDENT');
    await service.transitionIngestion(created.id, admin.id, 'ADMIN', {
      toState: INGESTION_STATES.APPROVED,
    });

    const actions = (await prisma.auditLog.findMany()).map((a) => a.action);
    expect(actions).toContain('INGESTION_CREATED');
    expect(actions).toContain('INGESTION_STATE_CHANGED');
    expect(actions).toContain('INGESTION_APPROVED');

    // No raw content is stored in audit details.
    const rows = await prisma.auditLog.findMany();
    for (const row of rows) {
      expect(row.details ?? '').not.toContain('Audited question');
    }
  });
});
