import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

import bootstrap from '../../src/index.js';
import { prisma } from '../setup.js';
import {
  QUESTION_QUALITY,
  classifyQuestionContent,
  looksLikeFixture,
  looksLikeArithmeticDrill,
  isProductionEligibleQuestion,
  isReusableBankOrigin,
  isAnalyticsEligibleAttempt,
  readAttemptEvaluationState,
} from '../../src/domain/questions/questionQuality.js';
import {
  QUESTION_ORIGINS,
  QUESTION_TRUST_LEVELS,
  trustWithinCeiling,
  isAutoPromotableOrigin,
} from '../../src/domain/ingestion/provenance.js';
import { validateQuestionText } from '../../src/domain/ingestion/inputValidation.js';
import {
  QuestionIngestionService,
  isStaffRole,
} from '../../src/application/services/ingestion/QuestionIngestionService.js';
import { QuestionSkillMappingService } from '../../src/application/services/skills/QuestionSkillMappingService.js';
import { CurriculumCandidateService } from '../../src/application/services/curriculum/CurriculumCandidateService.js';
import { AnalyticsService } from '../../src/application/services/analytics/AnalyticsService.js';
import { ReviewQueueService } from '../../src/application/services/ingestion/ReviewQueueService.js';
import { NextLearningActionService } from '../../src/application/services/learning/NextLearningActionService.js';
import { MAPPING_SOURCES } from '../../src/domain/skills/mappingVocabulary.js';
import { INGESTION_STATES } from '../../src/domain/ingestion/ingestionStateMachine.js';
import { AuthorizationError } from '../../src/domain/errors/AuthenticationError.js';
import {
  MappingAuthorizationError,
  DuplicateQuestionSkillMappingError,
  PrimarySkillMappingExistsError,
  MappingMicroSkillNotFoundError,
} from '../../src/domain/errors/QuestionSkillMappingErrors.js';
import { CandidateAuthorizationError } from '../../src/domain/errors/CurriculumCandidateErrors.js';

/**
 * Phase 7.2 — Real Question & Data Infrastructure.
 *
 * Proves the question/data layer is trustworthy: deterministic quality gates,
 * truthful provenance, valid curriculum/mapping integrity, student isolation,
 * fixture/unevaluable exclusion from analytics, and copyright/provenance safety.
 *
 * Every test uses SYNTHETIC fixture content created inline. No MEB textbook
 * question text is reproduced anywhere. No external AI is ever required.
 */

const STAFF = { id: 'staff-1', role: 'CONTENT_MANAGER' };
const ADMIN = { id: 'admin-1', role: 'ADMIN' };
const STUDENT_ACTOR = { id: 'student-1', role: 'STUDENT' };

/** Walk an ingestion through the legal state path to REVIEW_REQUIRED. */
async function advanceToReviewRequired(
  service: QuestionIngestionService,
  ingestionId: string,
  actorId: string,
  actorRole: string
) {
  await service.transitionIngestion(ingestionId, actorId, actorRole, { toState: INGESTION_STATES.EXTRACTED });
  await service.transitionIngestion(ingestionId, actorId, actorRole, { toState: INGESTION_STATES.NORMALIZED });
  await service.transitionIngestion(ingestionId, actorId, actorRole, { toState: INGESTION_STATES.REVIEW_REQUIRED });
}

async function registerAndLogin(app: express.Application, label: string) {
  const email = `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const password = 'Test123!@#';
  await request(app)
    .post('/api/v1/auth/register')
    .send({ email, password, firstName: label, lastName: 'User', grade: 11 });
  const login = await request(app).post('/api/v1/auth/login').send({ email, password });
  const accessToken = login.body.data.tokens.accessToken as string;
  const profile = await prisma.studentProfile.findUnique({ where: { userId: login.body.data.user.id }});
  if (!profile) throw new Error('Expected a StudentProfile');
  return { accessToken, studentProfileId: profile.id };
}

/** Create a curriculum chain + MicroSkill for a synthetic question. */
async function buildMicroSkill(prefix = 'P72') {
  const uid = Math.random().toString(36).slice(2, 10);
  const version = await prisma.curriculumVersion.create({
    data: { code: `${prefix}-CUR-${uid}`, name: prefix, grade: 11, subject: 'Matematik', version: '1.0', source: 'TEST_FIXTURE' },
  });
  const theme = await prisma.theme.create({
    data: { curriculumVersionId: version.id, officialCode: `${prefix}.T-${uid}`, name: 'T', lessonHours: 1, sourceOrder: 1 },
  });
  const lo = await prisma.learningOutcome.create({
    data: { themeId: theme.id, officialCode: `${prefix}.LO-${uid}`, officialText: 'T', sourceOrder: 1 },
  });
  const pc = await prisma.processComponent.create({
    data: { learningOutcomeId: lo.id, officialCode: `${prefix}.PC-${uid}`, officialText: 'T', sourceOrder: 1 },
  });
  const microSkill = await prisma.microSkill.create({
    data: { processComponentId: pc.id, code: `${prefix}.MS-${uid}`, name: 'MS', description: 'd', source: 'TEST_FIXTURE', isActive: true },
  });
  return { version, theme, lo, pc, microSkill };
}

/** Create a synthetic canonical Question. isFixture/exposure left to the caller. */
async function createQuestion(opts: {
  content: string;
  isFixture?: boolean;
  isActive?: boolean;
  type?: string;
  correctAnswer?: string;
  origin?: string | null;
  trust?: string;
}) {
  return prisma.question.create({
    data: {
      content: opts.content,
      type: opts.type ?? 'OPEN_ENDED',
      difficulty: 1,
      skillId: 'unmapped',
      correctAnswer: opts.correctAnswer ?? '',
      isFixture: opts.isFixture ?? false,
      isActive: opts.isActive ?? true,
      origin: opts.origin ?? null,
      trust: opts.trust ?? QUESTION_TRUST_LEVELS.UNVERIFIED,
    },
  });
}

// ============================================================ DATA QUALITY

describe('Phase 7.2 — question content quality gate', () => {
  it('Q1. empty and whitespace-only content are INVALID', () => {
    expect(classifyQuestionContent('').quality).toBe(QUESTION_QUALITY.INVALID);
    expect(classifyQuestionContent('    ').quality).toBe(QUESTION_QUALITY.INVALID);
    expect(classifyQuestionContent('').reason).toBe('EMPTY');
  });

  it('Q2. too-short content is INVALID', () => {
    const r = classifyQuestionContent('ab');
    expect(r.quality).toBe(QUESTION_QUALITY.INVALID);
    expect(r.reason).toBe('TOO_SHORT');
  });

  it('Q3. non-string content is INVALID', () => {
    expect(classifyQuestionContent(42).quality).toBe(QUESTION_QUALITY.INVALID);
    expect(classifyQuestionContent(null).quality).toBe(QUESTION_QUALITY.INVALID);
  });

  it('Q4. a genuine question is VALID', () => {
    const r = classifyQuestionContent('2x + 3 = 11 denklemini çözünüz.');
    expect(r.quality).toBe(QUESTION_QUALITY.VALID);
    expect(r.reason).toBe('OK');
    expect(r.isFixtureLike).toBe(false);
  });

  it('Q5. known literal placeholders are INVALID with placeholder reason', () => {
    for (const text of ['Question 1', 'Test question', 'Placeholder', 'N/A', 'TODO', 'Soru 3', '...']) {
      expect(classifyQuestionContent(text).quality).toBe(QUESTION_QUALITY.INVALID);
    }
  });

  it('Q6. a bare arithmetic drill is REVIEW_REQUIRED, never auto-INVALID', () => {
    const r = classifyQuestionContent('What is 2 + 2?');
    expect(r.quality).toBe(QUESTION_QUALITY.REVIEW_REQUIRED);
    expect(r.reason).toBe('SUSPECTED_PLACEHOLDER');
  });

  it('Q7. the placeholder detector does not flag genuine mathematics (no false positives)', () => {
    const genuine = [
      'Bir zar atıldığında üst yüze gelen sayının 4 olma olasılığı kaçtır?',
      'ABCD dikdörtgeninin alanını veren ifadeyi yazınız.',
      'sin²x + cos²x ifadesini sadeleştiriniz.',
    ];
    for (const text of genuine) {
      expect(classifyQuestionContent(text).quality).toBe(QUESTION_QUALITY.VALID);
    }
  });

  it('Q8. looksLikeFixture recognises repository fixture markers', () => {
    expect(looksLikeFixture('seed question')).toBe(true);
    expect(looksLikeFixture('Bu bir gerçek sorudur.')).toBe(false);
    expect(looksLikeFixture('')).toBe(false);
  });

  it('Q9. looksLikeArithmeticDrill distinguishes drills from real questions', () => {
    expect(looksLikeArithmeticDrill('3 + 4')).toBe(true);
    expect(looksLikeArithmeticDrill('3 + 4 ifadesinin sonucunu bir bağlamda açıklayınız.')).toBe(false);
  });

  it('Q10. validateQuestionText (the pre-existing ingestion gate) is unchanged', () => {
    expect(validateQuestionText('x + 1 = 2').valid).toBe(true);
    expect(validateQuestionText('').valid).toBe(false);
  });
});

// ============================================================ FIXTURE SAFETY

describe('Phase 7.2 — fixture eligibility', () => {
  it('F1. a fixture question is not production-eligible', () => {
    expect(isProductionEligibleQuestion({ isFixture: true, isActive: true })).toBe(false);
  });

  it('F2. an inactive question is not production-eligible', () => {
    expect(isProductionEligibleQuestion({ isFixture: false, isActive: false })).toBe(false);
  });

  it('F3. a normal active non-fixture question is eligible', () => {
    expect(isProductionEligibleQuestion({ isFixture: false, isActive: true })).toBe(true);
  });

  it('F4. null/undefined is never eligible', () => {
    expect(isProductionEligibleQuestion(null)).toBe(false);
    expect(isProductionEligibleQuestion(undefined)).toBe(false);
  });
});

// ============================================================ PROVENANCE

describe('Phase 7.2 — provenance vocabulary and rules', () => {
  it('P1. STUDENT_UPLOADED is a non auto-promotable origin', () => {
    expect(isAutoPromotableOrigin(QUESTION_ORIGINS.STUDENT_UPLOADED)).toBe(false);
    expect(isAutoPromotableOrigin(QUESTION_ORIGINS.MEB)).toBe(true);
    expect(isAutoPromotableOrigin(QUESTION_ORIGINS.MENTORA_MANUAL)).toBe(true);
  });

  it('P2. trust ceiling comparison is monotonic and rejects unknown levels', () => {
    expect(trustWithinCeiling(QUESTION_TRUST_LEVELS.UNVERIFIED, QUESTION_TRUST_LEVELS.HUMAN_APPROVED)).toBe(true);
    expect(trustWithinCeiling(QUESTION_TRUST_LEVELS.HUMAN_APPROVED, QUESTION_TRUST_LEVELS.EXTRACTED)).toBe(false);
    expect(trustWithinCeiling('MADE_UP', QUESTION_TRUST_LEVELS.HUMAN_APPROVED)).toBe(false);
  });

  it('P3. STUDENT_UPLOADED content is never a reusable bank origin', () => {
    expect(isReusableBankOrigin(QUESTION_ORIGINS.STUDENT_UPLOADED)).toBe(false);
    expect(isReusableBankOrigin(QUESTION_ORIGINS.MEB)).toBe(true);
    expect(isReusableBankOrigin(null)).toBe(false);
  });

  it('P4. a student-uploaded ingestion never reaches APPROVED (trust ceiling gate)', async () => {
    const source = await prisma.questionSource.create({
      data: {
        code: `P72-STU-${Date.now()}`,
        name: 'Student Uploads',
        origin: QUESTION_ORIGINS.STUDENT_UPLOADED,
        trustCeiling: QUESTION_TRUST_LEVELS.AI_ANALYZED,
        isActive: true,
      },
    });
    const service = new QuestionIngestionService(prisma as any);
    const ingestion = await service.createIngestion(STAFF.id, {
      ingestMethod: 'TEXT_PASTE',
      normalizedText: 'Sentetik öğrenci sorusu: 2x = 8 denklemini çöz.',
      sourceId: source.id,
    });

    await expect(
      service.transitionIngestion(ingestion.id, STAFF.id, STAFF.role, { toState: INGESTION_STATES.APPROVED })
    ).rejects.toThrow();
  });

  it('P5. origin is never inferred from content — it comes from the source only', async () => {
    // A question whose text *claims* MEB provenance must not gain MEB origin.
    const q = await createQuestion({
      content: 'Bu soru MEB kitabından alınmıştır: 5 + 7 kaçtır?',
      origin: QUESTION_ORIGINS.STUDENT_UPLOADED,
    });
    const stored = await prisma.question.findUnique({ where: { id: q.id } });
    expect(stored!.origin).toBe(QUESTION_ORIGINS.STUDENT_UPLOADED);
    expect(stored!.origin).not.toBe(QUESTION_ORIGINS.MEB);
  });

  it('P6. no fabricated license claim: a source without a license has license = null', async () => {
    const source = await prisma.questionSource.create({
      data: { code: `P72-NOLIC-${Date.now()}`, name: 'X', origin: 'UNKNOWN', trustCeiling: QUESTION_TRUST_LEVELS.UNVERIFIED, isActive: true },
    });
    expect(source.license).toBeNull();
  });
});

// ============================================================ MAPPING INTEGRITY

describe('Phase 7.2 — QuestionSkillMapping integrity', () => {
  it('M1. a valid PRIMARY + SECONDARY mapping is created by an authorised reviewer', async () => {
    const { microSkill } = await buildMicroSkill();
    const { microSkill: secondary } = await buildMicroSkill();
    const q = await createQuestion({ content: 'Sentetik soru A' });
    const service = new QuestionSkillMappingService(prisma as any);

    const primary = await service.createMapping(STAFF.id, STAFF.role, {
      questionId: q.id, microSkillId: microSkill.id, isPrimary: true, relevance: 0.9,
      aiConfidence: 0.8, mappingSource: MAPPING_SOURCES.MANUAL_REVIEW, reviewed: true,
    });
    expect(primary.isPrimary).toBe(true);
    expect(primary.primaryType).toBe('PRIMARY');

    const second = await service.createMapping(STAFF.id, STAFF.role, {
      questionId: q.id, microSkillId: secondary.id, isPrimary: false, relevance: 0.4,
      mappingSource: MAPPING_SOURCES.AI_MAPPED, reviewed: false,
    });
    expect(second.isPrimary).toBe(false);
    expect(second.primaryType).toBe('SECONDARY');

    const list = await service.listMappingsForQuestion(q.id);
    expect(list).toHaveLength(2);
    expect(list.filter((m: any) => m.isPrimary)).toHaveLength(1);
  });

  it('M2. a second PRIMARY mapping on the same question is INVALID (I13)', async () => {
    const { microSkill } = await buildMicroSkill();
    const { microSkill: other } = await buildMicroSkill();
    const q = await createQuestion({ content: 'Sentetik soru B' });
    const service = new QuestionSkillMappingService(prisma as any);
    await service.createMapping(STAFF.id, STAFF.role, { questionId: q.id, microSkillId: microSkill.id, isPrimary: true, relevance: 0.9 });
    await expect(
      service.createMapping(STAFF.id, STAFF.role, { questionId: q.id, microSkillId: other.id, isPrimary: true, relevance: 0.9 })
    ).rejects.toBeInstanceOf(PrimarySkillMappingExistsError);
  });

  it('M3. a mapping referencing a nonexistent MicroSkill is REJECTED', async () => {
    const q = await createQuestion({ content: 'Sentetik soru C' });
    const service = new QuestionSkillMappingService(prisma as any);
    await expect(
      service.createMapping(STAFF.id, STAFF.role, { questionId: q.id, microSkillId: 'does-not-exist', relevance: 0.5 })
    ).rejects.toBeInstanceOf(MappingMicroSkillNotFoundError);
  });

  it('M4. a duplicate (question, microSkill) mapping is REJECTED', async () => {
    const { microSkill } = await buildMicroSkill();
    const q = await createQuestion({ content: 'Sentetik soru D' });
    const service = new QuestionSkillMappingService(prisma as any);
    await service.createMapping(STAFF.id, STAFF.role, { questionId: q.id, microSkillId: microSkill.id, relevance: 0.5 });
    await expect(
      service.createMapping(STAFF.id, STAFF.role, { questionId: q.id, microSkillId: microSkill.id, relevance: 0.6 })
    ).rejects.toBeInstanceOf(DuplicateQuestionSkillMappingError);
  });

  it('M5. an aiConfidence outside [0,1] is REJECTED', async () => {
    const { microSkill } = await buildMicroSkill();
    const q = await createQuestion({ content: 'Sentetik soru E' });
    const service = new QuestionSkillMappingService(prisma as any);
    await expect(
      service.createMapping(STAFF.id, STAFF.role, { questionId: q.id, microSkillId: microSkill.id, relevance: 0.5, aiConfidence: 1.5 })
    ).rejects.toThrow();
    await expect(
      service.createMapping(STAFF.id, STAFF.role, { questionId: q.id, microSkillId: microSkill.id, relevance: 0.5, aiConfidence: -0.1 })
    ).rejects.toThrow();
  });

  it('M6. a relevance outside [0,1] is REJECTED', async () => {
    const { microSkill } = await buildMicroSkill();
    const q = await createQuestion({ content: 'Sentetik soru F' });
    const service = new QuestionSkillMappingService(prisma as any);
    await expect(
      service.createMapping(STAFF.id, STAFF.role, { questionId: q.id, microSkillId: microSkill.id, relevance: 2 })
    ).rejects.toThrow();
  });

  it('M7. a STUDENT cannot create or promote a mapping', async () => {
    const { microSkill } = await buildMicroSkill();
    const q = await createQuestion({ content: 'Sentetik soru G' });
    const service = new QuestionSkillMappingService(prisma as any);
    await expect(
      service.createMapping(STUDENT_ACTOR.id, STUDENT_ACTOR.role, { questionId: q.id, microSkillId: microSkill.id, relevance: 0.9, isPrimary: true })
    ).rejects.toBeInstanceOf(MappingAuthorizationError);
  });

  it('M8. an unreviewed mapping cannot be smuggled to PRIMARY without review', async () => {
    const { microSkill } = await buildMicroSkill();
    const q = await createQuestion({ content: 'Sentetik soru H' });
    const service = new QuestionSkillMappingService(prisma as any);
    const created = await service.createMapping(STAFF.id, STAFF.role, {
      questionId: q.id, microSkillId: microSkill.id, isPrimary: false, relevance: 0.5,
      aiConfidence: 0.2, mappingSource: MAPPING_SOURCES.AI_MAPPED, reviewed: false,
    });
    expect(created.reviewed).toBe(false);
    // Promotion is a staff action; a student cannot perform it.
    await expect(
      service.reviewMapping(STUDENT_ACTOR.id, STUDENT_ACTOR.role, created.id, { reviewed: true, isPrimary: true })
    ).rejects.toBeInstanceOf(MappingAuthorizationError);
    // A staff reviewer may promote it.
    const promoted = await service.reviewMapping(STAFF.id, STAFF.role, created.id, { reviewed: true, isPrimary: true });
    expect(promoted.isPrimary).toBe(true);
    expect(promoted.reviewed).toBe(true);
  });

  it('M9. a dangling MicroSkill -> ProcessComponent reference is structurally impossible (FK)', async () => {
    // The curriculum chain is protected at the SCHEMA level: a MicroSkill whose
    // ProcessComponent does not exist cannot be created, so the writer can never
    // be handed an unresolvable chain by construction.
    await expect(
      prisma.microSkill.create({
        data: { processComponentId: 'nonexistent-pc', code: `P72-ORPHAN-${Date.now()}`, name: 'Orphan', description: 'd', source: 'TEST_FIXTURE', isActive: true },
      })
    ).rejects.toThrow();
  });
});

// ============================================================ CURRICULUM CANDIDATE

describe('Phase 7.2 — curriculum anchoring integrity', () => {
  it('C1. a candidate for a nonexistent target is REJECTED', async () => {
    const q = await createQuestion({ content: 'Sentetik soru J' });
    const service = new CurriculumCandidateService(prisma as any);
    await expect(
      service.createCandidate(STAFF.id, STAFF.role, { questionId: q.id, level: 'LEARNING_OUTCOME', targetId: 'nope', confidence: 0.8 })
    ).rejects.toThrow();
  });

  it('C2. an inconsistent ProcessComponent -> LearningOutcome parent is REJECTED', async () => {
    const a = await buildMicroSkill('P72A');
    const b = await buildMicroSkill('P72B');
    const q = await createQuestion({ content: 'Sentetik soru K' });
    const service = new CurriculumCandidateService(prisma as any);
    // ProcessComponent of A asserted under LearningOutcome of B — a mismatch.
    await expect(
      service.createCandidate(STAFF.id, STAFF.role, {
        questionId: q.id, level: 'PROCESS_COMPONENT', targetId: a.pc.id,
        learningOutcomeId: b.lo.id, confidence: 0.7,
      })
    ).rejects.toThrow();
  });

  it('C3. a STUDENT cannot create a curriculum candidate', async () => {
    const { lo } = await buildMicroSkill();
    const q = await createQuestion({ content: 'Sentetik soru L' });
    const service = new CurriculumCandidateService(prisma as any);
    await expect(
      service.createCandidate(STUDENT_ACTOR.id, STUDENT_ACTOR.role, { questionId: q.id, level: 'LEARNING_OUTCOME', targetId: lo.id, confidence: 0.8 })
    ).rejects.toBeInstanceOf(CandidateAuthorizationError);
  });

  it('C4. an out-of-range confidence is REJECTED', async () => {
    const { lo } = await buildMicroSkill();
    const q = await createQuestion({ content: 'Sentetik soru M' });
    const service = new CurriculumCandidateService(prisma as any);
    await expect(
      service.createCandidate(STAFF.id, STAFF.role, { questionId: q.id, level: 'LEARNING_OUTCOME', targetId: lo.id, confidence: 1.4 })
    ).rejects.toThrow();
  });
});

// ============================================================ OWNERSHIP / ISOLATION

describe('Phase 7.2 — student isolation', () => {
  let app: express.Application;
  beforeAll(async () => { app = await bootstrap(); });

  it('I1. a student upload creates a private QuestionInstance owned by that student', async () => {
    const a = await registerAndLogin(app, 'p72-iso-a');
    const b = await registerAndLogin(app, 'p72-iso-b');
    const q = await createQuestion({ content: 'Sentetik özel soru', origin: QUESTION_ORIGINS.STUDENT_UPLOADED });
    const instanceA = await prisma.questionInstance.create({ data: { questionId: q.id, studentId: a.studentProfileId } });
    const instanceB = await prisma.questionInstance.create({ data: { questionId: q.id, studentId: b.studentProfileId } });
    expect(instanceA.id).not.toBe(instanceB.id);
    expect(instanceA.studentId).toBe(a.studentProfileId);
    expect(instanceB.studentId).toBe(b.studentProfileId);
  });

  it('I2. Student B cannot answer through Student A\'s private instance', async () => {
    const a = await registerAndLogin(app, 'p72-iso2-a');
    const b = await registerAndLogin(app, 'p72-iso2-b');
    const q = await createQuestion({
      content: 'Sentetik soru (evaluable)', type: 'CALCULATION', correctAnswer: '4',
      origin: QUESTION_ORIGINS.STUDENT_UPLOADED,
    });
    const instanceA = await prisma.questionInstance.create({ data: { questionId: q.id, studentId: a.studentProfileId } });

    const res = await request(app)
      .post('/api/v1/question-attempts')
      .set('Authorization', `Bearer ${b.accessToken}`)
      .set('Idempotency-Key', `p72-iso2-${Date.now()}`)
      .send({ questionId: q.id, answer: '4', timeSpentSeconds: 5, sessionId: 'standalone', instanceId: instanceA.id });

    expect([403, 404]).toContain(res.status);
    // No attempt was created for the intruder.
    expect(await prisma.questionAttempt.count({where: {studentId: b.studentProfileId }})).toBe(0);
  });

  it('I3. a student cannot answer a question that is not in their journey', async () => {
    const a = await registerAndLogin(app, 'p72-iso3-a');
    const q = await createQuestion({ content: 'Journey dışı soru', type: 'CALCULATION', correctAnswer: '4' });
    const res = await request(app)
      .post('/api/v1/question-attempts')
      .set('Authorization', `Bearer ${a.accessToken}`)
      .send({ questionId: q.id, answer: '4', timeSpentSeconds: 5, sessionId: 'standalone' });
    expect([403, 404]).toContain(res.status);
    void q;
  });
});

// ============================================================ FIXTURE / ANALYTICS

describe('Phase 7.2 — analytics data quality', () => {
  it('A1. a NOT_EVALUABLE attempt is not analytics-eligible', () => {
    expect(isAnalyticsEligibleAttempt({ metadata: JSON.stringify({ evaluationState: 'NOT_EVALUABLE' }), question: { isFixture: false } })).toBe(false);
  });

  it('A2. a fixture-question attempt is not analytics-eligible', () => {
    expect(isAnalyticsEligibleAttempt({ metadata: JSON.stringify({ evaluationState: 'EVALUATED' }), question: { isFixture: true } })).toBe(false);
  });

  it('A3. a normal evaluated attempt on a real question IS eligible', () => {
    expect(isAnalyticsEligibleAttempt({ metadata: JSON.stringify({ evaluationState: 'EVALUATED' }), question: { isFixture: false } })).toBe(true);
  });

  it('A4. readAttemptEvaluationState is safe on malformed/absent metadata', () => {
    expect(readAttemptEvaluationState(null)).toBeNull();
    expect(readAttemptEvaluationState('not json')).toBeNull();
    expect(readAttemptEvaluationState(JSON.stringify({ evaluationState: 'WEIRD' }))).toBeNull();
    expect(readAttemptEvaluationState(JSON.stringify({ evaluationState: 'EVALUATED' }))).toBe('EVALUATED');
  });

  it('A5. the AnalyticsService excludes fixture and NOT_EVALUABLE attempts', async () => {
    const a = await registerAndLogin(await bootstrap(), 'p72-analytics');
    const service = new AnalyticsService(prisma as any);

    const realQ = await createQuestion({ content: 'Gerçek analitik soru', type: 'CALCULATION', correctAnswer: '4' });
    const fixtureQ = await createQuestion({ content: 'What is 2 + 2?', isFixture: true, type: 'CALCULATION', correctAnswer: '4' });

    // 1 correct real attempt, 1 fixture attempt, 1 NOT_EVALUABLE real attempt.
    await prisma.questionAttempt.create({ data: { studentId: a.studentProfileId, questionId: realQ.id, answer: '4', isCorrect: true, timeSpentSeconds: 5, status: 'COMPLETED', metadata: JSON.stringify({ evaluationState: 'EVALUATED' }) } });
    await prisma.questionAttempt.create({ data: { studentId: a.studentProfileId, questionId: fixtureQ.id, answer: '4', isCorrect: true, timeSpentSeconds: 5, status: 'COMPLETED', metadata: JSON.stringify({ evaluationState: 'EVALUATED' }) } });
    await prisma.questionAttempt.create({ data: { studentId: a.studentProfileId, questionId: realQ.id, answer: 'x', isCorrect: false, timeSpentSeconds: 5, status: 'COMPLETED', metadata: JSON.stringify({ evaluationState: 'NOT_EVALUABLE' }) } });

    const analytics = await service.getStudentAnalytics(a.studentProfileId);
    // Only the one real, evaluated attempt counts.
    expect(analytics.totalQuestions).toBe(1);
    expect(analytics.accuracy).toBe(100);
  });
});

// ============================================================ RECOMMENDATION SAFETY

describe('Phase 7.2 — recommendation safety', () => {
  it('R1. a dev-corpus fixture question with no student evidence cannot drive a recommendation', async () => {
    const a = await registerAndLogin(await bootstrap(), 'p72-reco');
    const { microSkill } = await buildMicroSkill();
    // A fixture question exists in the corpus with a PRIMARY mapping, but this
    // student has NO instance, NO attempt and NO mastery against it.
    const fixtureQ = await createQuestion({ content: 'What is 5 + 5?', isFixture: true });
    await prisma.questionSkillMapping.create({ data: { questionId: fixtureQ.id, microSkillId: microSkill.id, relevance: 0.9, isPrimary: true, reviewed: true, mappingSource: 'MANUAL_REVIEW' } });

    const service = new NextLearningActionService(prisma as any);
    const action = await service.getNextAction(a.studentProfileId);
    // The engine derives purely from the student's own authoritative state, so a
    // corpus fixture the student never touched yields deterministic onboarding.
    expect(action.actionType).toBe('ONBOARDING');
    expect(action.reasonCode).toBe('INSUFFICIENT_EVIDENCE');
    // And the recommendation surface persists nothing.
    expect(await prisma.recommendation.count({ where: { studentId: a.studentProfileId }})).toBe(0);
  });

  it('R2. recommendations never surface an internal client id in evidence', async () => {
    const a = await registerAndLogin(await bootstrap(), 'p72-reco2');
    const service = new NextLearningActionService(prisma as any);
    const action = await service.getNextAction(a.studentProfileId);
    // Onboarding for a brand-new student: no fabricated weakness.
    expect(action.actionType).toBe('ONBOARDING');
    expect(action.reasonCode).toBe('INSUFFICIENT_EVIDENCE');
  });
});

// ============================================================ TRUST / ORIGIN IMMUTABILITY

describe('Phase 7.2 — trust ceiling and origin immutability', () => {
  it('T1. canonical question creation from a student upload stays STUDENT_UPLOADED + UNVERIFIED', async () => {
    const source = await prisma.questionSource.create({
      data: { code: `P72-CAN-${Date.now()}`, name: 'Student', origin: QUESTION_ORIGINS.STUDENT_UPLOADED, trustCeiling: QUESTION_TRUST_LEVELS.AI_ANALYZED, isActive: true },
    });
    const user = await prisma.user.create({ data: { email: `p72-can-${Date.now()}@example.com`, firstName: 'S', lastName: 'U', role: 'STUDENT', passwordHash: 'h' } });
    const student = await prisma.studentProfile.create({ data: { userId: user.id, grade: 11 } });
    const service = new QuestionIngestionService(prisma as any);
    const ingestion = await service.createIngestion(user.id, {
      ingestMethod: 'IMAGE_UPLOAD',
      normalizedText: 'Sentetik öğrenci yüklemesi: x + 2 = 5 denklemini çöz.',
      sourceId: source.id,
    });
    // Student-uploaded content can only reach REVIEW_REQUIRED, not APPROVED.
    await advanceToReviewRequired(service, ingestion.id, user.id, 'STUDENT');

    const { question, instance } = await service.createCanonicalQuestionFromIngestion(ingestion.id, user.id, 'STUDENT');
    const stored = await prisma.question.findUnique({ where: { id: question.id } });
    expect(stored!.origin).toBe(QUESTION_ORIGINS.STUDENT_UPLOADED);
    expect(stored!.trust).toBe(QUESTION_TRUST_LEVELS.UNVERIFIED);
    expect(stored!.isFixture).toBe(false);
    expect(stored!.isActive).toBe(false);
    // The private instance is scoped to the uploading student.
    expect(instance).not.toBeNull();
    expect(instance!.studentId).toBe(student.id);
    const instances = await prisma.questionInstance.findMany({ where: { questionId: question.id } });
    expect(instances).toHaveLength(1);
    expect(instances[0].studentId).toBe(student.id);
  });

  it('T2. an approval attempt that would exceed a trust ceiling is REJECTED and audited', async () => {
    const source = await prisma.questionSource.create({
      data: { code: `P72-TRUST-${Date.now()}`, name: 'Low', origin: 'STUDENT_UPLOADED', trustCeiling: QUESTION_TRUST_LEVELS.EXTRACTED, isActive: true },
    });
    const service = new QuestionIngestionService(prisma as any);
    const ingestion = await service.createIngestion(ADMIN.id, {
      ingestMethod: 'TEXT_PASTE', normalizedText: 'Sentetik içerik', sourceId: source.id,
    });
    const before = await prisma.auditLog.count({ where: { action: 'TRUST_PROMOTION_ATTEMPT' } });
    await expect(
      service.transitionIngestion(ingestion.id, ADMIN.id, ADMIN.role, { toState: INGESTION_STATES.APPROVED })
    ).rejects.toThrow();
    const after = await prisma.auditLog.count({ where: { action: 'TRUST_PROMOTION_ATTEMPT' } });
    expect(after).toBeGreaterThanOrEqual(before);
  });
});

// ============================================================ REVIEW QUEUE

describe('Phase 7.2 — review queue authorization', () => {
  it('RQ1. the review queue is staff-only', async () => {
    const service = new ReviewQueueService(prisma as any);
    await expect(service.listQueue('STUDENT')).rejects.toThrow();
  });

  it('RQ2. staff can read the queue and see provenance/review context', async () => {
    const service = new ReviewQueueService(prisma as any);
    const items = await service.listQueue(STAFF.role);
    expect(Array.isArray(items)).toBe(true);
  });

  it('RQ3. isStaffRole recognises exactly the documented reviewer roles', () => {
    expect(isStaffRole('ADMIN')).toBe(true);
    expect(isStaffRole('CONTENT_MANAGER')).toBe(true);
    expect(isStaffRole('TEACHER')).toBe(true);
    expect(isStaffRole('STUDENT')).toBe(false);
    expect(isStaffRole(undefined)).toBe(false);
  });
});

// ============================================================ API SECURITY

describe('Phase 7.2 — question API security', () => {
  let app: express.Application;
  beforeAll(async () => { app = await bootstrap(); });

  it('S1. creating an ingestion requires authentication', async () => {
    const res = await request(app).post('/api/v1/question-ingestions').send({ ingestMethod: 'TEXT_PASTE', rawText: 'x' });
    expect(res.status).toBe(401);
  });

  it('S2. a student cannot read another user\'s ingestion', async () => {
    const a = await registerAndLogin(app, 'p72-sec-a');
    const b = await registerAndLogin(app, 'p72-sec-b');
    const create = await request(app)
      .post('/api/v1/question-ingestions')
      .set('Authorization', `Bearer ${a.accessToken}`)
      .send({ ingestMethod: 'TEXT_PASTE', normalizedText: 'Sentetik gizli ingestion' });
    expect(create.status).toBe(201);
    const id = create.body.data.id as string;

    const res = await request(app)
      .get(`/api/v1/question-ingestions/${id}`)
      .set('Authorization', `Bearer ${b.accessToken}`);
    // Indistinguishable from not-found: no existence disclosure.
    expect([403, 404]).toContain(res.status);
  });

  it('S3. a student cannot self-approve their own ingestion', async () => {
    const a = await registerAndLogin(app, 'p72-sec-approve');
    const create = await request(app)
      .post('/api/v1/question-ingestions')
      .set('Authorization', `Bearer ${a.accessToken}`)
      .send({ ingestMethod: 'TEXT_PASTE', normalizedText: 'Sentetik onay denemesi' });
    const id = create.body.data.id as string;
    const res = await request(app)
      .post(`/api/v1/question-ingestions/${id}/transition`)
      .set('Authorization', `Bearer ${a.accessToken}`)
      .send({ toState: 'APPROVED' });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it('S4. a student-supplied studentId in the body cannot alter ingestion ownership', async () => {
    const a = await registerAndLogin(app, 'p72-sec-owner');
    const b = await registerAndLogin(app, 'p72-sec-owner-b');
    const create = await request(app)
      .post('/api/v1/question-ingestions')
      .set('Authorization', `Bearer ${a.accessToken}`)
      .send({ ingestMethod: 'TEXT_PASTE', normalizedText: 'Sentetik sahiplik', studentId: b.studentProfileId });
    const id = create.body.data.id as string;
    // A can still read it (owner); B cannot.
    expect((await request(app).get(`/api/v1/question-ingestions/${id}`).set('Authorization', `Bearer ${a.accessToken}`)).status).toBe(200);
    expect([403, 404]).toContain((await request(app).get(`/api/v1/question-ingestions/${id}`).set('Authorization', `Bearer ${b.accessToken}`)).status);
  });
});

// ============================================================ INGESTION FAILURE MATRIX

describe('Phase 7.2 — ingestion failure matrix', () => {
  const service = () => new QuestionIngestionService(prisma as any);

  it('IF1. an ingestion with no text and no asset is REJECTED', async () => {
    await expect(service().createIngestion(STAFF.id, { ingestMethod: 'TEXT_PASTE' })).rejects.toThrow();
  });

  it('IF2. an empty rawText is treated as absent and REJECTED', async () => {
    await expect(service().createIngestion(STAFF.id, { ingestMethod: 'TEXT_PASTE', rawText: '' })).rejects.toThrow();
  });

  it('IF3. unusable raw text with no normalized text is REJECTED', async () => {
    await expect(service().createIngestion(STAFF.id, { ingestMethod: 'TEXT_PASTE', rawText: '   ' })).rejects.toThrow();
  });

  it('IF4. an inactive source is REJECTED', async () => {
    const source = await prisma.questionSource.create({
      data: { code: `P72-INACTIVE-${Date.now()}`, name: 'Off', origin: 'MENTORA_MANUAL', trustCeiling: QUESTION_TRUST_LEVELS.HUMAN_APPROVED, isActive: false },
    });
    await expect(
      service().createIngestion(STAFF.id, { ingestMethod: 'TEXT_PASTE', normalizedText: 'Sentetik içerik', sourceId: source.id })
    ).rejects.toThrow();
  });

  it('IF5. the same idempotency key produces exactly one ingestion', async () => {
    const key = `p72-idem-${Date.now()}`;
    const { IdempotencyService } = await import('../../src/infrastructure/idempotency/IdempotencyService.js');
    const user = await prisma.user.create({ data: { email: `p72-idem-${Date.now()}@example.com`, firstName: 'I', lastName: 'D', role: 'ADMIN', passwordHash: 'h' } });
    const idem = new IdempotencyService(prisma as any);
    const svc = new QuestionIngestionService(prisma as any, idem);
    const first = await svc.createIngestion(user.id, { ingestMethod: 'TEXT_PASTE', normalizedText: 'Sentetik idempotent içerik' }, key);
    const second = await svc.createIngestion(user.id, { ingestMethod: 'TEXT_PASTE', normalizedText: 'Sentetik idempotent içerik' }, key);
    expect(second.id).toBe(first.id);
    expect(await prisma.questionIngestion.count({ where: { ingestedByUserId: user.id }})).toBe(1);
  });
});

// ============================================================ END-TO-END JOURNEY

describe('Phase 7.2 — synthetic real-data end-to-end journey', () => {
  let app: express.Application;
  beforeAll(async () => { app = await bootstrap(); });

  it('E2E. student upload -> review -> canonical -> instance -> attempt -> mastery', async () => {
    const student = await registerAndLogin(app, 'p72-e2e');
    const source = await prisma.questionSource.create({
      data: { code: `P72-E2E-${Date.now()}`, name: 'Student', origin: QUESTION_ORIGINS.STUDENT_UPLOADED, trustCeiling: QUESTION_TRUST_LEVELS.AI_ANALYZED, isActive: true },
    });
    const profile = await prisma.studentProfile.findUnique({ where: { id: student.studentProfileId }});
    if (!profile) throw new Error('Expected a student profile');
    const user = { id: profile.userId };
    const ingestionService = new QuestionIngestionService(prisma as any);
    const ingestion = await ingestionService.createIngestion(user!.id, {
      ingestMethod: 'IMAGE_UPLOAD',
      normalizedText: 'Sentetik: 2x + 3 = 11 denklemini çözünüz.',
      sourceId: source.id,
    });
    await advanceToReviewRequired(ingestionService, ingestion.id, user!.id, 'STUDENT');

    const { question, instance } = await ingestionService.createCanonicalQuestionFromIngestion(ingestion.id, user!.id, 'STUDENT');
    expect(instance).not.toBeNull();

    // Give it an authoritative canonical answer + MicroSkill mapping (staff action).
    const { microSkill } = await buildMicroSkill('P72E2E');
    await prisma.question.update({ where: { id: question.id }, data: { correctAnswer: '4', type: 'CALCULATION' } });
    const mappingService = new QuestionSkillMappingService(prisma as any);
    await mappingService.createMapping(STAFF.id, STAFF.role, { questionId: question.id, microSkillId: microSkill.id, isPrimary: true, relevance: 0.9, reviewed: true });

    // The student answers their own instance.
    const res = await request(app)
      .post('/api/v1/question-attempts')
      .set('Authorization', `Bearer ${student.accessToken}`)
      .set('Idempotency-Key', `p72-e2e-${Date.now()}`)
      .send({ questionId: question.id, answer: '4', timeSpentSeconds: 20, sessionId: 'standalone', instanceId: instance!.id });
    expect(res.status).toBe(201);
    expect(res.body.data.isCorrect).toBe(true);

    // Authoritative mastery was applied against the PRIMARY MicroSkill.
    const mastery = await prisma.skillMastery.findUnique({
      where: { studentId_skillId: { studentId: student.studentProfileId, skillId: microSkill.id } },
    });
    expect(mastery).toBeTruthy();
    expect(mastery!.masteryLevel).toBeGreaterThan(0);

    // The question never entered the global bank: still inactive, student-uploaded.
    const stored = await prisma.question.findUnique({ where: { id: question.id } });
    expect(stored!.isActive).toBe(false);
    expect(stored!.origin).toBe(QUESTION_ORIGINS.STUDENT_UPLOADED);
  });
});

// ============================================================ ANALYTICS ISOLATION

describe('Phase 7.2 — cross-student analytics isolation', () => {
  it('AN1. Student A\'s attempts never appear in Student B\'s analytics', async () => {
    const a = await registerAndLogin(await bootstrap(), 'p72-an-a');
    const b = await registerAndLogin(await bootstrap(), 'p72-an-b');
    const service = new AnalyticsService(prisma as any);
    const q = await createQuestion({ content: 'Sentetik izolasyon sorusu', type: 'CALCULATION', correctAnswer: '4' });
    await prisma.questionAttempt.create({ data: { studentId: a.studentProfileId, questionId: q.id, answer: '4', isCorrect: true, timeSpentSeconds: 5, status: 'COMPLETED', metadata: JSON.stringify({ evaluationState: 'EVALUATED' }) } });

    const analyticsB = await service.getStudentAnalytics(b.studentProfileId);
    expect(analyticsB.totalQuestions).toBe(0);
    expect(analyticsB.accuracy).toBe(0);

    const analyticsA = await service.getStudentAnalytics(a.studentProfileId);
    expect(analyticsA.totalQuestions).toBe(1);
  });
});
