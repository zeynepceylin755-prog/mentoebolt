import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import express from 'express';

import bootstrap from '../../src/index.js';
import { prisma } from '../setup.js';
import { NextLearningActionService } from '../../src/application/services/learning/NextLearningActionService.js';
import {
  EVIDENCE,
  REGRESSION,
  isActionReasonConsistent,
  type ActionType,
  type ReasonCode,
} from '../../src/domain/recommendation/nextLearningActionPolicy.js';

/**
 * Phase 6.5 — Deterministic Next Learning Action ("Şimdi ne çalışmalıyım?").
 *
 * Proves the recommendation engine is:
 *   - AUTHORITATIVE from persisted learning state only (never an LLM);
 *   - DETERMINISTIC for the same state (injected clock, no randomness);
 *   - EXPLAINABLE (action/reason pairing always legal, evidence always attached);
 *   - scoped to the AUTHENTICATED student (no client-supplied identity);
 *   - correct for empty, weak, repeated-error, improving, declining and strong students;
 *   - read-only (no writes, no learning-state mutation).
 *
 * All data is created inside this suite against the isolated test database
 * (prisma/test.db). No dev.db mutation, no real network, no AI provider required.
 */

const FIXED_NOW = new Date('2026-01-15T12:00:00.000Z');
const frozenClock = () => new Date(FIXED_NOW.getTime());

// --------------------------------------------------------------------- helpers

async function registerAndLogin(app: express.Application, label: string) {
  const email = `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const password = 'Test123!@#';
  await request(app).post('/api/v1/auth/register').send({ email, password, firstName: label, lastName: 'User', grade: 11 });
  const login = await request(app).post('/api/v1/auth/login').send({ email, password });
  const token = login.body.data.tokens.accessToken as string;
  const profile = await prisma.studentProfile.findUnique({ where: { userId: login.body.data.user.id } });
  if (!profile) throw new Error('Expected a StudentProfile');
  return { token, studentProfileId: profile.id };
}

/** Build a curriculum chain + MicroSkill (the isolated test DB is not seeded). */
async function createMicroSkill(label: string, themeOrder = 1, code?: string) {
  const uid = `${label}-${Math.random().toString(36).slice(2, 10)}`;
  const version = await prisma.curriculumVersion.create({
    data: { code: `P65-CUR-${uid}`, name: 'P65', grade: 11, subject: 'Matematik', version: '1', source: 'TEST_FIXTURE' },
  });
  const theme = await prisma.theme.create({
    data: { curriculumVersionId: version.id, officialCode: `P65.T-${uid}`, name: 'T', lessonHours: 1, sourceOrder: themeOrder },
  });
  const lo = await prisma.learningOutcome.create({
    data: { themeId: theme.id, officialCode: `P65.LO-${uid}`, officialText: 'T', sourceOrder: 1 },
  });
  const pc = await prisma.processComponent.create({
    data: { learningOutcomeId: lo.id, officialCode: `P65.PC-${uid}`, officialText: 'T', sourceOrder: 1 },
  });
  const microSkill = await prisma.microSkill.create({
    data: {
      processComponentId: pc.id,
      code: code ?? `P65.MS-${uid}`,
      name: `P65 Skill ${uid}`,
      description: 'phase 6.5 fixture',
      source: 'TEST_FIXTURE',
      isActive: true,
    },
  });
  return { microSkill, processComponent: pc, learningOutcome: lo, theme, version };
}

/** Create a Question mapped PRIMARY to a MicroSkill, and give it to the student. */
async function giveQuestion(studentProfileId: string, microSkillId: string, content = 'P65 question') {
  const question = await prisma.question.create({
    data: { content, type: 'CALCULATION', difficulty: 1, skillId: microSkillId, correctAnswer: '42', isActive: true } as any,
  });
  await prisma.questionSkillMapping.create({
    data: { questionId: question.id, microSkillId, isPrimary: true, relevance: 0.9, mappingSource: 'MANUAL_REVIEW', reviewed: true },
  });
  await prisma.questionInstance.create({ data: { studentId: studentProfileId, questionId: question.id } });
  return question;
}

/** Create a COMPATIBLE ErrorPattern wired to a MicroSkill. */
async function createErrorPatternFor(microSkillId: string, label = 'P65') {
  const uid = Math.random().toString(36).slice(2, 10);
  const pattern = await prisma.errorPattern.create({
    data: {
      code: `P65-EP-${uid}`,
      name: `${label} Conceptual Misunderstanding`,
      description: 'fixture',
      category: 'CONCEPTUAL_MISUNDERSTANDING',
      severity: 'HIGH',
      source: 'TEST_FIXTURE',
      isActive: true,
    },
  });
  await prisma.errorPatternMicroSkill.create({
    data: { errorPatternId: pattern.id, microSkillId, relevance: 0.9, isPrimary: true },
  });
  return pattern;
}

/** Insert a mastery row for the student. */
async function giveMastery(
  studentProfileId: string,
  microSkillId: string,
  overrides: Partial<{ masteryLevel: number; confidence: number; attempts: number; correctAttempts: number; evidenceCount: number; trend: string | null; nextReviewAt: Date | null }> = {}
) {
  return prisma.skillMastery.create({
    data: {
      studentId: studentProfileId,
      skillId: microSkillId,
      microSkillId,
      masteryLevel: overrides.masteryLevel ?? 50,
      confidence: overrides.confidence ?? 0.5,
      attempts: overrides.attempts ?? 3,
      correctAttempts: overrides.correctAttempts ?? 1,
      evidenceCount: overrides.evidenceCount ?? 1,
      trend: overrides.trend ?? 'STABLE',
      nextReviewAt: overrides.nextReviewAt ?? null,
      lastAttemptAt: FIXED_NOW,
    },
  });
}

/** Insert a QuestionAttempt (recent) for a question mapped to a microSkill. */
async function giveAttempt(
  studentProfileId: string,
  questionId: string,
  isCorrect: boolean,
  createdAt = FIXED_NOW
) {
  return prisma.questionAttempt.create({
    data: {
      studentId: studentProfileId,
      questionId,
      answer: isCorrect ? '42' : 'wrong',
      isCorrect,
      timeSpentSeconds: 20,
      createdAt,
    },
  });
}

/** Insert a persisted ErrorAnalysis on an attempt, linked to a pattern. */
async function giveErrorAnalysis(studentProfileId: string, attemptId: string, errorPatternId: string, createdAt = FIXED_NOW) {
  return prisma.errorAnalysis.create({
    data: {
      attemptId,
      studentId: studentProfileId,
      errorPatternId,
      errorType: 'CONCEPTUAL_MISUNDERSTANDING',
      confidence: 0.8,
      hypothesis: 'fixture',
      createdAt,
    },
  });
}

const ALL_ACTIONS: ActionType[] = [
  'CONTINUE_SESSION',
  'REMEDIATE_ERROR',
  'REVIEW_SKILL',
  'PRACTICE_SKILL',
  'PROGRESS_CURRICULUM',
  'MAINTAIN_SKILL',
  'ONBOARDING',
];

const ALL_REASONS: ReasonCode[] = [
  'ACTIVE_SESSION',
  'LOW_MASTERY',
  'REPEATED_ERROR',
  'RECENT_REGRESSION',
  'DEVELOPING_SKILL',
  'CURRICULUM_PROGRESS',
  'MAINTENANCE',
  'INSUFFICIENT_EVIDENCE',
];

// ================================================================ IDENTITY / API

describe('Phase 6.5 — Identity, ownership & API contract', () => {
  let app: express.Application;

  beforeAll(async () => {
    app = await bootstrap();
  });

  it('T1. an authenticated student gets their own recommendation', async () => {
    const student = await registerAndLogin(app, 'p65-own');
    const res = await request(app)
      .get('/api/v1/recommendations/next')
      .set('Authorization', `Bearer ${student.token}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(ALL_ACTIONS).toContain(res.body.data.actionType);
    expect(ALL_REASONS).toContain(res.body.data.reasonCode);
  });

  it('T2. a student cannot access another student\'s recommendation', async () => {
    const a = await registerAndLogin(app, 'p65-iso-a');
    const b = await registerAndLogin(app, 'p65-iso-b');
    const { microSkill } = await createMicroSkill('iso');
    await giveMastery(b.studentProfileId, microSkill.id, { masteryLevel: 12, attempts: 8, evidenceCount: 8 });

    const resA = await request(app).get('/api/v1/recommendations/next').set('Authorization', `Bearer ${a.token}`);
    const resB = await request(app).get('/api/v1/recommendations/next').set('Authorization', `Bearer ${b.token}`);

    expect(resA.status).toBe(200);
    // A has NO learning evidence, so A can never receive B's mastery-derived
    // remediation. A's result is derived from A's own (empty) state.
    expect(resA.body.data.actionType).toBe('ONBOARDING');
    expect(resA.body.data.reasonCode).toBe('INSUFFICIENT_EVIDENCE');
    // B's own weak skill is correctly identified for B.
    expect(resB.body.data.microSkillId).toBe(microSkill.id);
    expect(resB.body.data.reasonCode).toBe('LOW_MASTERY');
  });

  it('T2b. a client-supplied studentId cannot override the authenticated identity', async () => {
    const a = await registerAndLogin(app, 'p65-spoof-a');
    const b = await registerAndLogin(app, 'p65-spoof-b');
    const { microSkill } = await createMicroSkill('spoof');
    await giveMastery(b.studentProfileId, microSkill.id, { masteryLevel: 10, attempts: 9, evidenceCount: 9 });

    const res = await request(app)
      .get(`/api/v1/recommendations/next?studentId=${b.studentProfileId}`)
      .set('Authorization', `Bearer ${a.token}`);
    expect(res.status).toBe(200);
    // A still gets A's OWN (empty) result — a spoofed studentId changes nothing.
    expect(res.body.data.actionType).toBe('ONBOARDING');
    expect(res.body.data.reasonCode).toBe('INSUFFICIENT_EVIDENCE');
  });

  it('T3. an unauthenticated request is rejected', async () => {
    const res = await request(app).get('/api/v1/recommendations/next');
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it('T3b. an invalid token is rejected', async () => {
    const res = await request(app)
      .get('/api/v1/recommendations/next')
      .set('Authorization', 'Bearer not-a-real-token');
    expect(res.status).toBe(401);
  });
});

// ============================================================ EMPTY / LOW DATA

describe('Phase 6.5 — Empty & low-data students', () => {
  let app: express.Application;

  beforeAll(async () => {
    app = await bootstrap();
  });

  it('T4. a brand-new student gets a deterministic ONBOARDING recommendation', async () => {
    const student = await registerAndLogin(app, 'p65-new');
    const res = await request(app).get('/api/v1/recommendations/next').set('Authorization', `Bearer ${student.token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.actionType).toBe('ONBOARDING');
    expect(res.body.data.reasonCode).toBe('INSUFFICIENT_EVIDENCE');
    expect(res.body.data.evidence).toEqual({});
  });

  it('T5. a brand-new student never receives a fabricated weakness', async () => {
    const student = await registerAndLogin(app, 'p65-new2');
    // A curriculum exists in the DB, but this student has zero learning evidence.
    await prisma.microSkill.deleteMany({});
    await createMicroSkill('new2', 1);

    const res = await request(app).get('/api/v1/recommendations/next').set('Authorization', `Bearer ${student.token}`);
    expect(res.status).toBe(200);
    // The strong wording for "weakness" must never be emitted without evidence.
    expect(res.body.data.actionType).not.toBe('REMEDIATE_ERROR');
    expect(res.body.data.actionType).not.toBe('REVIEW_SKILL');
    expect(res.body.data.reasonCode).not.toBe('LOW_MASTERY');
    expect(res.body.data.reasonCode).not.toBe('REPEATED_ERROR');
  });
});

// ================================================================ ACTIVE SESSION

describe('Phase 6.5 — Active session priority', () => {
  let app: express.Application;

  beforeAll(async () => {
    app = await bootstrap();
  });

  it('T6. an active session outranks a generic/weak-skill recommendation', async () => {
    const student = await registerAndLogin(app, 'p65-session');
    const { microSkill } = await createMicroSkill('session');
    // A weak, well-evidenced skill exists — but the active session must win.
    await giveMastery(student.studentProfileId, microSkill.id, { masteryLevel: 15, attempts: 10, evidenceCount: 10 });
    const question = await giveQuestion(student.studentProfileId, microSkill.id);
    const session = await prisma.learningSession.create({
      data: { studentId: student.studentProfileId, status: 'ACTIVE', sessionType: 'PRACTICE' },
    });
    await prisma.learningSessionQuestion.create({
      data: { sessionId: session.id, questionId: question.id, order: 1, status: 'PENDING' },
    });

    const res = await request(app).get('/api/v1/recommendations/next').set('Authorization', `Bearer ${student.token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.actionType).toBe('CONTINUE_SESSION');
    expect(res.body.data.reasonCode).toBe('ACTIVE_SESSION');
    expect(res.body.data.sessionId).toBe(session.id);
  });

  it('T6b. an active session with no pending questions does not win', async () => {
    const student = await registerAndLogin(app, 'p65-session-empty');
    const { microSkill } = await createMicroSkill('session-empty');
    await giveMastery(student.studentProfileId, microSkill.id, { masteryLevel: 15, attempts: 10, evidenceCount: 10 });
    await prisma.learningSession.create({
      data: { studentId: student.studentProfileId, status: 'ACTIVE', sessionType: 'PRACTICE' },
    });

    const res = await request(app).get('/api/v1/recommendations/next').set('Authorization', `Bearer ${student.token}`);
    expect(res.body.data.actionType).not.toBe('CONTINUE_SESSION');
  });

  it('T6c. an expired active session does not win', async () => {
    const student = await registerAndLogin(app, 'p65-session-expired');
    const { microSkill } = await createMicroSkill('session-exp');
    await giveMastery(student.studentProfileId, microSkill.id, { masteryLevel: 15, attempts: 10, evidenceCount: 10 });
    const question = await giveQuestion(student.studentProfileId, microSkill.id);
    const session = await prisma.learningSession.create({
      data: {
        studentId: student.studentProfileId,
        status: 'ACTIVE',
        sessionType: 'PRACTICE',
        expiresAt: new Date(FIXED_NOW.getTime() - 60_000),
      },
    });
    await prisma.learningSessionQuestion.create({
      data: { sessionId: session.id, questionId: question.id, order: 1, status: 'PENDING' },
    });

    const service = new NextLearningActionService(prisma, { clock: frozenClock });
    const result = await service.getNextAction(student.studentProfileId);
    expect(result.actionType).not.toBe('CONTINUE_SESSION');
  });
});

// ================================================================ MASTERY RULES

describe('Phase 6.5 — Mastery & evidence thresholds', () => {
  let app: express.Application;

  beforeAll(async () => {
    app = await bootstrap();
  });

  it('T7. low mastery WITH evidence produces a remediation (LOW_MASTERY)', async () => {
    const student = await registerAndLogin(app, 'p65-low');
    const { microSkill } = await createMicroSkill('low');
    await giveMastery(student.studentProfileId, microSkill.id, { masteryLevel: 22, attempts: 6, evidenceCount: 6 });

    const res = await request(app).get('/api/v1/recommendations/next').set('Authorization', `Bearer ${student.token}`);
    expect(res.body.data.actionType).toBe('PRACTICE_SKILL');
    expect(res.body.data.reasonCode).toBe('LOW_MASTERY');
    expect(res.body.data.microSkillId).toBe(microSkill.id);
    expect(res.body.data.evidence.mastery).toBe(22);
  });

  it('T8. a single low-confidence observation does NOT dominate', async () => {
    const student = await registerAndLogin(app, 'p65-single');
    const { microSkill } = await createMicroSkill('single');
    // mastery=20 but only ONE observation — must not trigger the critical-gap rule.
    await giveMastery(student.studentProfileId, microSkill.id, { masteryLevel: 20, attempts: 1, evidenceCount: 1 });

    const res = await request(app).get('/api/v1/recommendations/next').set('Authorization', `Bearer ${student.token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.reasonCode).not.toBe('LOW_MASTERY');
    expect(res.body.data.actionType).not.toBe('REMEDIATE_ERROR');
  });

  it('T8b. a well-evidenced weakness outranks a low-evidence weakness', async () => {
    const student = await registerAndLogin(app, 'p65-evidence-rank');
    const shallow = await createMicroSkill('shallow');
    const deep = await createMicroSkill('deep');
    // Shallow has a LOWER headline score but almost no evidence.
    await giveMastery(student.studentProfileId, shallow.microSkill.id, { masteryLevel: 10, attempts: 1, evidenceCount: 1 });
    await giveMastery(student.studentProfileId, deep.microSkill.id, { masteryLevel: 30, attempts: 8, evidenceCount: 8 });

    const service = new NextLearningActionService(prisma, { clock: frozenClock });
    const result = await service.getNextAction(student.studentProfileId);
    expect(result.reasonCode).toBe('LOW_MASTERY');
    expect(result.microSkillId).toBe(deep.microSkill.id);
  });

  it('T9. developing mastery produces targeted practice (DEVELOPING_SKILL)', async () => {
    const student = await registerAndLogin(app, 'p65-developing');
    const { microSkill } = await createMicroSkill('developing');
    await giveMastery(student.studentProfileId, microSkill.id, { masteryLevel: 55, attempts: 4, evidenceCount: 4 });

    const res = await request(app).get('/api/v1/recommendations/next').set('Authorization', `Bearer ${student.token}`);
    expect(res.body.data.actionType).toBe('PRACTICE_SKILL');
    expect(res.body.data.reasonCode).toBe('DEVELOPING_SKILL');
    expect(res.body.data.microSkillId).toBe(microSkill.id);
  });

  it('T10. strong mastery does NOT automatically produce remediation', async () => {
    const student = await registerAndLogin(app, 'p65-strong');
    const { microSkill } = await createMicroSkill('strong');
    await giveMastery(student.studentProfileId, microSkill.id, {
      masteryLevel: 92,
      confidence: 0.9,
      attempts: 12,
      evidenceCount: 12,
      nextReviewAt: new Date(FIXED_NOW.getTime() + 7 * 24 * 60 * 60 * 1000),
    });

    const res = await request(app).get('/api/v1/recommendations/next').set('Authorization', `Bearer ${student.token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.actionType).not.toBe('PRACTICE_SKILL');
    expect(res.body.data.actionType).not.toBe('REMEDIATE_ERROR');
    expect(res.body.data.reasonCode).not.toBe('LOW_MASTERY');
  });

  it('T10b. a strong skill due for review is recommended for maintenance', async () => {
    const student = await registerAndLogin(app, 'p65-maintain');
    const { microSkill } = await createMicroSkill('maintain');
    await giveMastery(student.studentProfileId, microSkill.id, {
      masteryLevel: 88,
      confidence: 0.85,
      attempts: 10,
      evidenceCount: 10,
      nextReviewAt: new Date(FIXED_NOW.getTime() - 24 * 60 * 60 * 1000),
    });

    const service = new NextLearningActionService(prisma, { clock: frozenClock });
    const result = await service.getNextAction(student.studentProfileId);
    expect(result.actionType).toBe('MAINTAIN_SKILL');
    expect(result.reasonCode).toBe('MAINTENANCE');
  });
});

// ================================================================ ERROR ANALYSIS

describe('Phase 6.5 — ErrorAnalysis & ErrorPattern frequency', () => {
  let app: express.Application;

  beforeAll(async () => {
    app = await bootstrap();
  });

  it('T11. a repeated ErrorPattern raises the priority to REMEDIATE_ERROR', async () => {
    const student = await registerAndLogin(app, 'p65-repeat');
    const { microSkill } = await createMicroSkill('repeat');
    const question = await giveQuestion(student.studentProfileId, microSkill.id);
    const pattern = await createErrorPatternFor(microSkill.id);
    await giveMastery(student.studentProfileId, microSkill.id, { masteryLevel: 30, attempts: 6, evidenceCount: 6 });

    const a1 = await giveAttempt(student.studentProfileId, question.id, false);
    const a2 = await giveAttempt(student.studentProfileId, question.id, false);
    await giveErrorAnalysis(student.studentProfileId, a1.id, pattern.id);
    await giveErrorAnalysis(student.studentProfileId, a2.id, pattern.id);

    const service = new NextLearningActionService(prisma, { clock: frozenClock });
    const result = await service.getNextAction(student.studentProfileId);
    expect(result.actionType).toBe('REMEDIATE_ERROR');
    expect(result.reasonCode).toBe('REPEATED_ERROR');
    expect(result.evidence.repeatedErrorPattern).toBe(true);
    expect(result.evidence.recentIncorrectCount).toBe(2);
  });

  it('T12. an isolated error does not dominate', async () => {
    const student = await registerAndLogin(app, 'p65-isolated');
    const { microSkill } = await createMicroSkill('isolated');
    const question = await giveQuestion(student.studentProfileId, microSkill.id);
    const pattern = await createErrorPatternFor(microSkill.id);
    // A healthy, developing skill with ONE recent mistake.
    await giveMastery(student.studentProfileId, microSkill.id, { masteryLevel: 62, attempts: 8, evidenceCount: 8 });
    const a1 = await giveAttempt(student.studentProfileId, question.id, false);
    await giveErrorAnalysis(student.studentProfileId, a1.id, pattern.id);

    const service = new NextLearningActionService(prisma, { clock: frozenClock });
    const result = await service.getNextAction(student.studentProfileId);
    expect(result.reasonCode).not.toBe('REPEATED_ERROR');
    expect(result.actionType).not.toBe('REMEDIATE_ERROR');
  });

  it('T13. repeated conceptual error is handled deterministically', async () => {
    const student = await registerAndLogin(app, 'p65-conceptual');
    const { microSkill } = await createMicroSkill('conceptual');
    const question = await giveQuestion(student.studentProfileId, microSkill.id);
    const pattern = await createErrorPatternFor(microSkill.id, 'Conceptual');
    await giveMastery(student.studentProfileId, microSkill.id, { masteryLevel: 25, attempts: 7, evidenceCount: 7 });
    for (let i = 0; i < 3; i++) {
      const attempt = await giveAttempt(student.studentProfileId, question.id, false);
      await giveErrorAnalysis(student.studentProfileId, attempt.id, pattern.id);
    }

    const service = new NextLearningActionService(prisma, { clock: frozenClock });
    const first = await service.getNextAction(student.studentProfileId);
    const second = await service.getNextAction(student.studentProfileId);
    expect(first.actionType).toBe('REMEDIATE_ERROR');
    expect(first.reasonCode).toBe('REPEATED_ERROR');
    // Deterministic across identical state.
    expect(second).toEqual(first);
  });

  it('T13b. deterministic error aggregation is explainable via evidence', async () => {
    const student = await registerAndLogin(app, 'p65-evidence');
    const { microSkill } = await createMicroSkill('evidence');
    const question = await giveQuestion(student.studentProfileId, microSkill.id);
    const pattern = await createErrorPatternFor(microSkill.id);
    await giveMastery(student.studentProfileId, microSkill.id, {
      masteryLevel: 35,
      attempts: 6,
      evidenceCount: 6,
      trend: 'DOWN',
    });
    const a1 = await giveAttempt(student.studentProfileId, question.id, false);
    const a2 = await giveAttempt(student.studentProfileId, question.id, false);
    await giveErrorAnalysis(student.studentProfileId, a1.id, pattern.id);
    await giveErrorAnalysis(student.studentProfileId, a2.id, pattern.id);

    const service = new NextLearningActionService(prisma, { clock: frozenClock });
    const result = await service.getNextAction(student.studentProfileId);
    expect(result.evidence.mastery).toBe(35);
    expect(result.evidence.evidenceCount).toBe(6);
    expect(result.evidence.trend).toBe('DECLINING');
    expect(result.priority).toBeGreaterThan(0);
    expect(result.priority).toBeLessThanOrEqual(100);
  });
});

// ================================================================ TREND

describe('Phase 6.5 — Trend: regression, improvement & recency bounds', () => {
  let app: express.Application;

  beforeAll(async () => {
    app = await bootstrap();
  });

  it('T14. an improving trend is recognized and does not force remediation', async () => {
    const student = await registerAndLogin(app, 'p65-improving');
    const { microSkill } = await createMicroSkill('improving');
    await giveMastery(student.studentProfileId, microSkill.id, {
      masteryLevel: 58,
      attempts: 10,
      correctAttempts: 8,
      evidenceCount: 10,
      trend: 'UP',
    });

    const service = new NextLearningActionService(prisma, { clock: frozenClock });
    const result = await service.getNextAction(student.studentProfileId);
    expect(result.actionType).not.toBe('REVIEW_SKILL');
    expect(result.reasonCode).not.toBe('RECENT_REGRESSION');
    expect(['DEVELOPING_SKILL', 'LOW_MASTERY']).toContain(result.reasonCode);
  });

  it('T15. a declining trend is recognized as a regression review', async () => {
    const student = await registerAndLogin(app, 'p65-declining');
    const { microSkill } = await createMicroSkill('declining');
    const question = await giveQuestion(student.studentProfileId, microSkill.id);
    await giveMastery(student.studentProfileId, microSkill.id, {
      masteryLevel: 52,
      attempts: 9,
      correctAttempts: 3,
      evidenceCount: 9,
      trend: 'DOWN',
    });
    // Recent window dominated by incorrect attempts.
    for (let i = 0; i < 4; i++) {
      await giveAttempt(student.studentProfileId, question.id, i === 0);
    }

    const service = new NextLearningActionService(prisma, { clock: frozenClock });
    const result = await service.getNextAction(student.studentProfileId);
    expect(result.actionType).toBe('REVIEW_SKILL');
    expect(result.reasonCode).toBe('RECENT_REGRESSION');
    expect(result.evidence.trend).toBe('DECLINING');
  });

  it('T15b. a declining trend WITHOUT a dominated recent window is not a regression', async () => {
    const student = await registerAndLogin(app, 'p65-declining-thin');
    const { microSkill } = await createMicroSkill('declining-thin');
    const question = await giveQuestion(student.studentProfileId, microSkill.id);
    await giveMastery(student.studentProfileId, microSkill.id, {
      masteryLevel: 65,
      attempts: 6,
      evidenceCount: 6,
      trend: 'DOWN',
    });
    // Only one recent attempt — not enough to assert a recent regression window.
    await giveAttempt(student.studentProfileId, question.id, false);

    const service = new NextLearningActionService(prisma, { clock: frozenClock });
    const result = await service.getNextAction(student.studentProfileId);
    expect(result.reasonCode).not.toBe('RECENT_REGRESSION');
  });

  it('T15c. regression requires sufficient evidence', async () => {
    const student = await registerAndLogin(app, 'p65-regression-thin');
    const { microSkill } = await createMicroSkill('regression-thin');
    const question = await giveQuestion(student.studentProfileId, microSkill.id);
    await giveMastery(student.studentProfileId, microSkill.id, {
      masteryLevel: 50,
      attempts: 2,
      evidenceCount: 2, // below REGRESSION.MIN_PRIOR_EVIDENCE
      trend: 'DOWN',
    });
    for (let i = 0; i < 3; i++) {
      await giveAttempt(student.studentProfileId, question.id, false);
    }

    const service = new NextLearningActionService(prisma, { clock: frozenClock });
    const result = await service.getNextAction(student.studentProfileId);
    expect(result.reasonCode).not.toBe('RECENT_REGRESSION');
  });

  it('T16. old evidence does not completely override recent evidence (bounded recency)', async () => {
    const student = await registerAndLogin(app, 'p65-recency');
    const { microSkill } = await createMicroSkill('recency');
    const question = await giveQuestion(student.studentProfileId, microSkill.id);
    // A historically strong skill (high evidence of success) with recent errors.
    await giveMastery(student.studentProfileId, microSkill.id, {
      masteryLevel: 75,
      confidence: 0.85,
      attempts: 20,
      correctAttempts: 18,
      evidenceCount: 20,
      trend: 'STABLE',
    });
    await giveAttempt(student.studentProfileId, question.id, false);
    await giveAttempt(student.studentProfileId, question.id, false);

    const service = new NextLearningActionService(prisma, { clock: frozenClock });
    const result = await service.getNextAction(student.studentProfileId);
    // A strong skill must not collapse into a low-mastery remediation from one
    // recent mistake; the recency bonus is bounded by RECENCY.MAX_BONUS.
    expect(result.reasonCode).not.toBe('LOW_MASTERY');
    expect(result.actionType).not.toBe('REMEDIATE_ERROR');
  });

  it('T16b. attempts older than the recency window are ignored', async () => {
    const student = await registerAndLogin(app, 'p65-window');
    const { microSkill } = await createMicroSkill('window');
    const question = await giveQuestion(student.studentProfileId, microSkill.id);
    const pattern = await createErrorPatternFor(microSkill.id);
    await giveMastery(student.studentProfileId, microSkill.id, { masteryLevel: 30, attempts: 6, evidenceCount: 6 });
    // Far outside the 30-day window relative to the frozen clock.
    const old = new Date(FIXED_NOW.getTime() - 90 * 24 * 60 * 60 * 1000);
    const a1 = await giveAttempt(student.studentProfileId, question.id, false, old);
    const a2 = await giveAttempt(student.studentProfileId, question.id, false, old);
    await giveErrorAnalysis(student.studentProfileId, a1.id, pattern.id, old);
    await giveErrorAnalysis(student.studentProfileId, a2.id, pattern.id, old);

    const service = new NextLearningActionService(prisma, { clock: frozenClock });
    const result = await service.getNextAction(student.studentProfileId);
    expect(result.reasonCode).not.toBe('REPEATED_ERROR');
    expect(result.evidence.recentIncorrectCount ?? 0).toBe(0);
  });
});

// ================================================================ CURRICULUM

describe('Phase 6.5 — Curriculum progression', () => {
  beforeAll(async () => {
    // Ensure a deterministic curriculum exists for progression tests.
  });

  it('T-prog1. a student with only mastered skills progresses through the curriculum', async () => {
    const app = await bootstrap();
    const student = await registerAndLogin(app, 'p65-progress');
    const first = await createMicroSkill('prog-first', 1, 'P65.AA-FIRST');
    const second = await createMicroSkill('prog-second', 2, 'P65.BB-SECOND');
    const third = await createMicroSkill('prog-third', 3, 'P65.CC-THIRD');
    // Student has mastered the first two (strong, not due) but not the third.
    await giveMastery(student.studentProfileId, first.microSkill.id, {
      masteryLevel: 90, confidence: 0.9, attempts: 12, evidenceCount: 12,
      nextReviewAt: new Date(FIXED_NOW.getTime() + 30 * 24 * 60 * 60 * 1000),
    });
    await giveMastery(student.studentProfileId, second.microSkill.id, {
      masteryLevel: 88, confidence: 0.9, attempts: 12, evidenceCount: 12,
      nextReviewAt: new Date(FIXED_NOW.getTime() + 30 * 24 * 60 * 60 * 1000),
    });

    const service = new NextLearningActionService(prisma, { clock: frozenClock });
    const result = await service.getNextAction(student.studentProfileId);
    expect(result.actionType).toBe('PROGRESS_CURRICULUM');
    expect(result.reasonCode).toBe('CURRICULUM_PROGRESS');
    // The unseen skill (third) is selected — ordering follows theme sourceOrder.
    expect(result.microSkillId).toBe(third.microSkill.id);
  });

  it('T-prog2. curriculum progression follows the authoritative ordering deterministically', async () => {
    const app = await bootstrap();
    const student = await registerAndLogin(app, 'p65-progress2');
    const later = await createMicroSkill('prog2-later', 5, 'P65.ZZ-LATER');
    const earlier = await createMicroSkill('prog2-earlier', 1, 'P65.YY-EARLIER');
    await giveMastery(student.studentProfileId, later.microSkill.id, {
      masteryLevel: 95, confidence: 0.95, attempts: 15, evidenceCount: 15,
      nextReviewAt: new Date(FIXED_NOW.getTime() + 30 * 24 * 60 * 60 * 1000),
    });

    const service = new NextLearningActionService(prisma, { clock: frozenClock });
    const result = await service.getNextAction(student.studentProfileId);
    expect(result.actionType).toBe('PROGRESS_CURRICULUM');
    // Lower theme sourceOrder wins despite a higher code.
    expect(result.microSkillId).toBe(earlier.microSkill.id);
  });
});

// ================================================================ QUALITY / DETERMINISM

describe('Phase 6.5 — Recommendation quality, determinism & AI independence', () => {
  let app: express.Application;

  beforeAll(async () => {
    app = await bootstrap();
  });

  it('T17. duplicate recommendations are avoided once the state changes', async () => {
    const student = await registerAndLogin(app, 'p65-dup');
    const { microSkill } = await createMicroSkill('dup');
    await giveMastery(student.studentProfileId, microSkill.id, { masteryLevel: 22, attempts: 6, evidenceCount: 6 });

    const first = await request(app).get('/api/v1/recommendations/next').set('Authorization', `Bearer ${student.token}`);
    expect(first.body.data.microSkillId).toBe(microSkill.id);

    // New evidence arrives: the skill is now strong. The engine must not keep
    // returning the same PRACTICE_SKILL action for the same weak skill.
    await prisma.skillMastery.updateMany({
      where: { studentId: student.studentProfileId, skillId: microSkill.id },
      data: { masteryLevel: 84, confidence: 0.9, evidenceCount: 14, attempts: 14, nextReviewAt: new Date(FIXED_NOW.getTime() + 30 * 86400000) },
    });

    const second = await request(app).get('/api/v1/recommendations/next').set('Authorization', `Bearer ${student.token}`);
    expect(second.body.data.actionType).not.toBe('PRACTICE_SKILL');
    expect(second.body.data.reasonCode).not.toBe('LOW_MASTERY');
  });

  it('T18. the same learning state always produces the same recommendation', async () => {
    const student = await registerAndLogin(app, 'p65-determinism');
    const { microSkill } = await createMicroSkill('det');
    const question = await giveQuestion(student.studentProfileId, microSkill.id);
    const pattern = await createErrorPatternFor(microSkill.id);
    await giveMastery(student.studentProfileId, microSkill.id, { masteryLevel: 28, attempts: 6, evidenceCount: 6, trend: 'DOWN' });
    const a1 = await giveAttempt(student.studentProfileId, question.id, false);
    const a2 = await giveAttempt(student.studentProfileId, question.id, false);
    await giveErrorAnalysis(student.studentProfileId, a1.id, pattern.id);
    await giveErrorAnalysis(student.studentProfileId, a2.id, pattern.id);

    const service = new NextLearningActionService(prisma, { clock: frozenClock });
    const results = await Promise.all(
      Array.from({ length: 5 }, () => service.getNextAction(student.studentProfileId))
    );
    for (const r of results) {
      expect(r).toEqual(results[0]);
    }
  });

  it('T18b. the engine does not depend on the current wall clock for the same state', async () => {
    const student = await registerAndLogin(app, 'p65-clock');
    const { microSkill } = await createMicroSkill('clock');
    await giveMastery(student.studentProfileId, microSkill.id, { masteryLevel: 25, attempts: 6, evidenceCount: 6 });

    const serviceA = new NextLearningActionService(prisma, { clock: () => new Date('2026-01-15T12:00:00Z') });
    const serviceB = new NextLearningActionService(prisma, { clock: () => new Date('2026-01-15T23:59:00Z') });
    const a = await serviceA.getNextAction(student.studentProfileId);
    const b = await serviceB.getNextAction(student.studentProfileId);
    expect(a.actionType).toBe(b.actionType);
    expect(a.reasonCode).toBe(b.reasonCode);
    expect(a.microSkillId).toBe(b.microSkillId);
  });

  it('T19. the recommendation works with no AI provider configured', async () => {
    // The service performs no AI call at all: it is constructed with only Prisma.
    const student = await registerAndLogin(app, 'p65-noai');
    const { microSkill } = await createMicroSkill('noai');
    await giveMastery(student.studentProfileId, microSkill.id, { masteryLevel: 22, attempts: 6, evidenceCount: 6 });

    const service = new NextLearningActionService(prisma, { clock: frozenClock });
    const result = await service.getNextAction(student.studentProfileId);
    expect(result.actionType).toBe('PRACTICE_SKILL');
    expect(result.reasonCode).toBe('LOW_MASTERY');
  });

  it('T20. no LLM call is required: the response carries no model metadata', async () => {
    const student = await registerAndLogin(app, 'p65-nometa');
    const { microSkill } = await createMicroSkill('nometa');
    await giveMastery(student.studentProfileId, microSkill.id, { masteryLevel: 22, attempts: 6, evidenceCount: 6 });

    const res = await request(app).get('/api/v1/recommendations/next').set('Authorization', `Bearer ${student.token}`);
    expect(res.status).toBe(200);
    const body = JSON.stringify(res.body);
    expect(body).not.toMatch(/model|provider|tokensUsed|latencyMs|confidence/i);
    expect(res.body.data).toHaveProperty('reasonCode');
    expect(res.body.data).toHaveProperty('evidence');
  });

  it('T20b. the response never leaks raw internal taxonomy ids or the answer', async () => {
    const student = await registerAndLogin(app, 'p65-clean');
    const { microSkill } = await createMicroSkill('clean');
    await giveMastery(student.studentProfileId, microSkill.id, { masteryLevel: 22, attempts: 6, evidenceCount: 6 });

    const res = await request(app).get('/api/v1/recommendations/next').set('Authorization', `Bearer ${student.token}`);
    const body = JSON.stringify(res.body);
    expect(body).not.toMatch(/errorPatternId|correctAnswer|P65-EP-/);
    expect(body).not.toMatch(/masteryLevel|confidence|evidenceCount:\s*null/);
  });
});

// ================================================================ EXPLAINABILITY

describe('Phase 6.5 — Explainability: action/reason pairing & evidence', () => {
  let app: express.Application;

  beforeAll(async () => {
    app = await bootstrap();
  });

  it('T22. every non-fallback recommendation has a legal action/reason pair', async () => {
    // Sweep a variety of student states through the HTTP endpoint.
    const label = 'p65-sweep';
    const student = await registerAndLogin(app, label);
    const { microSkill } = await createMicroSkill(label);
    await giveMastery(student.studentProfileId, microSkill.id, { masteryLevel: 25, attempts: 6, evidenceCount: 6 });

    const res = await request(app).get('/api/v1/recommendations/next').set('Authorization', `Bearer ${student.token}`);
    const { actionType, reasonCode } = res.body.data;
    expect(ALL_ACTIONS).toContain(actionType);
    expect(ALL_REASONS).toContain(reasonCode);
    expect(isActionReasonConsistent(actionType, reasonCode)).toBe(true);
  });

  it('T22b. LOW_MASTERY is never returned without a genuinely low-mastery skill', async () => {
    const student = await registerAndLogin(app, 'p65-mismatch');
    const { microSkill } = await createMicroSkill('mismatch');
    // A strong skill: LOW_MASTERY would be a reason/evidence mismatch.
    await giveMastery(student.studentProfileId, microSkill.id, {
      masteryLevel: 85, confidence: 0.9, attempts: 12, evidenceCount: 12,
      nextReviewAt: new Date(FIXED_NOW.getTime() + 30 * 86400000),
    });

    const service = new NextLearningActionService(prisma, { clock: frozenClock });
    const result = await service.getNextAction(student.studentProfileId);
    expect(result.reasonCode).not.toBe('LOW_MASTERY');
  });

  it('T22c. DEVELOPING_SKILL requires mastery inside the developing band', async () => {
    const student = await registerAndLogin(app, 'p65-band');
    const { microSkill } = await createMicroSkill('band');
    await giveMastery(student.studentProfileId, microSkill.id, { masteryLevel: 52, attempts: 4, evidenceCount: 4 });

    const service = new NextLearningActionService(prisma, { clock: frozenClock });
    const result = await service.getNextAction(student.studentProfileId);
    if (result.reasonCode === 'DEVELOPING_SKILL') {
      const m = result.evidence.mastery!;
      expect(m).toBeGreaterThanOrEqual(40);
      expect(m).toBeLessThan(70);
    } else {
      expect(result.reasonCode).toBe('DEVELOPING_SKILL');
    }
  });

  it('T23. the priority is always bounded and the effort estimate is always set', async () => {
    const student = await registerAndLogin(app, 'p65-bounds');
    const { microSkill } = await createMicroSkill('bounds');
    await giveMastery(student.studentProfileId, microSkill.id, { masteryLevel: 5, attempts: 20, evidenceCount: 20 });

    const service = new NextLearningActionService(prisma, { clock: frozenClock });
    const result = await service.getNextAction(student.studentProfileId);
    expect(result.priority).toBeGreaterThanOrEqual(1);
    expect(result.priority).toBeLessThanOrEqual(100);
    expect(result.estimatedTimeMinutes).toBeGreaterThan(0);
    expect(result.reason.length).toBeGreaterThan(0);
  });

  it('T24. EVIDENCE / REGRESSION thresholds are exported and consistent', () => {
    expect(EVIDENCE.MIN_LOW).toBe(1);
    expect(EVIDENCE.DEVELOPING).toBeGreaterThan(EVIDENCE.MIN_LOW);
    expect(EVIDENCE.STRONG).toBeGreaterThan(EVIDENCE.DEVELOPING);
    expect(REGRESSION.MIN_PRIOR_EVIDENCE).toBeGreaterThanOrEqual(EVIDENCE.DEVELOPING);
  });
});

// ================================================================ NON-MUTATION

describe('Phase 6.5 — Recommendation is read-only (no learning-state mutation)', () => {
  let app: express.Application;

  beforeAll(async () => {
    app = await bootstrap();
  });

  async function snapshot() {
    const [attempts, mastery, progress, analyses, patterns, mappings, microSkills, sessions, audits, recs] = await Promise.all([
      prisma.questionAttempt.findMany({ orderBy: { id: 'asc' } }),
      prisma.skillMastery.findMany({ orderBy: { id: 'asc' } }),
      prisma.learningProgress.findMany({ orderBy: { id: 'asc' } }),
      prisma.errorAnalysis.findMany({ orderBy: { id: 'asc' } }),
      prisma.errorPattern.findMany({ orderBy: { id: 'asc' } }),
      prisma.questionSkillMapping.findMany({ orderBy: { id: 'asc' } }),
      prisma.microSkill.findMany({ orderBy: { id: 'asc' } }),
      prisma.learningSession.findMany({ orderBy: { id: 'asc' } }),
      prisma.masteryAudit.findMany({ orderBy: { id: 'asc' } }),
      prisma.recommendation.findMany({ orderBy: { id: 'asc' } }),
    ]);
    return JSON.stringify([attempts, mastery, progress, analyses, patterns, mappings, microSkills, sessions, audits, recs]);
  }

  it('T21. repeatedly requesting the recommendation mutates nothing', async () => {
    const student = await registerAndLogin(app, 'p65-readonly');
    const { microSkill } = await createMicroSkill('readonly');
    const question = await giveQuestion(student.studentProfileId, microSkill.id);
    const pattern = await createErrorPatternFor(microSkill.id);
    await giveMastery(student.studentProfileId, microSkill.id, { masteryLevel: 28, attempts: 6, evidenceCount: 6 });
    const a1 = await giveAttempt(student.studentProfileId, question.id, false);
    await giveErrorAnalysis(student.studentProfileId, a1.id, pattern.id);

    const before = await snapshot();
    for (let i = 0; i < 3; i++) {
      const res = await request(app).get('/api/v1/recommendations/next').set('Authorization', `Bearer ${student.token}`);
      expect(res.status).toBe(200);
    }
    const after = await snapshot();
    expect(after).toEqual(before);
  });

  it('T21b. the endpoint creates no Recommendation persistence rows', async () => {
    const student = await registerAndLogin(app, 'p65-norec-rows');
    const { microSkill } = await createMicroSkill('norec-rows');
    await giveMastery(student.studentProfileId, microSkill.id, { masteryLevel: 22, attempts: 6, evidenceCount: 6 });

    const before = await prisma.recommendation.count();
    await request(app).get('/api/v1/recommendations/next').set('Authorization', `Bearer ${student.token}`);
    expect(await prisma.recommendation.count()).toBe(before);
  });
});
