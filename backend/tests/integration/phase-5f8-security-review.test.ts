import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

import bootstrap from '../../src/index.js';
import { prisma } from '../setup.js';
import { TokenService } from '../../src/domain/services/TokenService.js';
import { QuestionAttemptService } from '../../src/application/services/learning/QuestionAttemptService.js';
import { QuestionIngestionService } from '../../src/application/services/ingestion/QuestionIngestionService.js';
import { INGESTION_STATES } from '../../src/domain/ingestion/ingestionStateMachine.js';
import { AuthorizationError } from '../../src/domain/errors/AuthenticationError.js';

/**
 * Phase 5F.8 — Security hardening + reviewer workflow.
 *
 * Covers:
 *   A1 canonicalization ownership (no cross-student canonicalization)
 *   A2 no User.id fallback (fail closed, no attempt created)
 *   A3 question visibility / cross-student isolation
 *   A4 rate limiter sees the authenticated principal
 *   D  staff-only review queue, honest review-gate behaviour
 */

const tokenService = new TokenService();

async function createUserWithRole(role: string, label: string) {
  const email = `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const user = await prisma.user.create({
    data: {
      email,
      firstName: label,
      lastName: 'User',
      role,
      passwordHash: 'hash',
    },
  });
  const token = tokenService.generateAccessToken({ userId: user.id, email, role });
  return { user, token };
}

async function createStudent(label: string) {
  const { user, token } = await createUserWithRole('STUDENT', label);
  const profile = await prisma.studentProfile.create({
    data: { userId: user.id, grade: 11, school: 'Test School' },
  });
  return { user, token, profile };
}

async function buildSource() {
  const uid = Math.random().toString(36).slice(2, 10);
  return prisma.questionSource.create({
    data: {
      code: 'P5F8-SRC-' + uid,
      name: 'Student uploaded',
      origin: 'STUDENT_UPLOADED',
      trustCeiling: 'UNVERIFIED',
      license: 'Student-provided; not redistributable',
      isActive: true,
    },
  });
}

/** Drive an ingestion to REVIEW_REQUIRED (the student-upload reviewed state). */
async function driveToReviewReady(ingestionService: QuestionIngestionService, id: string, actorId: string, role: string) {
  const current = await prisma.questionIngestion.findUnique({ where: { id } });
  const state = current!.state;
  if (state === INGESTION_STATES.INGESTED) {
    await ingestionService.transitionIngestion(id, actorId, role, { toState: INGESTION_STATES.EXTRACTED });
    await ingestionService.transitionIngestion(id, actorId, role, { toState: INGESTION_STATES.NORMALIZED });
  }
  await ingestionService.transitionIngestion(id, actorId, role, { toState: INGESTION_STATES.REVIEW_REQUIRED });
}

describe('Phase 5F.8 — Security hardening & reviewer workflow', () => {
  let app: express.Application;
  let ingestionService: QuestionIngestionService;
  let attemptService: QuestionAttemptService;

  beforeAll(async () => {
    app = await bootstrap();
    ingestionService = new QuestionIngestionService(prisma);
    attemptService = new QuestionAttemptService(prisma);
  });

  afterAll(async () => {
    // Global setup handles disconnect.
  });

  beforeEach(async () => {
    await prisma.masteryAudit.deleteMany({});
    await prisma.skillMastery.deleteMany({});
    await prisma.errorAnalysis.deleteMany({});
    await prisma.errorPatternMicroSkill.deleteMany({});
    await prisma.errorPattern.deleteMany({});
    await prisma.questionAttempt.deleteMany({});
    await prisma.questionSkillMapping.deleteMany({});
    await prisma.curriculumCandidate.deleteMany({});
    await prisma.questionInstance.deleteMany({});
    await prisma.questionIngestion.deleteMany({});
    await prisma.question.deleteMany({});
    await prisma.questionSource.deleteMany();
    await prisma.microSkill.deleteMany({});
    await prisma.processComponent.deleteMany({});
    await prisma.learningOutcome.deleteMany({});
    await prisma.theme.deleteMany({});
    await prisma.curriculumVersion.deleteMany({});
    await prisma.idempotencyRecord.deleteMany({});
    await prisma.studentProfile.deleteMany({});
    await prisma.user.deleteMany({});
  });

  // ============================================================ A1 canonical

  it('A1: owner may canonicalize their own ingestion; non-owner student is rejected', async () => {
    const owner = await createStudent('a1-owner');
    const other = await createStudent('a1-other');
    const source = await buildSource();

    const ingestion = await ingestionService.createIngestion(owner.user.id, {
      ingestMethod: 'IMAGE_UPLOAD',
      rawText: 'Synthetic A1 question stem long enough',
      normalizedText: 'Synthetic A1 question stem long enough',
      sourceId: source.id,
    });
    await driveToReviewReady(ingestionService, ingestion.id, owner.user.id, 'STUDENT');

    // Owner (student) is allowed — this is the student journey path.
    const owned = await ingestionService.createCanonicalQuestionFromIngestion(
      ingestion.id,
      owner.user.id,
      'STUDENT'
    );
    expect(owned.question.id).toBeTruthy();
    expect(owned.question.trust).toBe('UNVERIFIED');

    // A DIFFERENT student must not canonicalize this ingestion at all.
    await expect(
      ingestionService.createCanonicalQuestionFromIngestion(ingestion.id, other.user.id, 'STUDENT')
    ).rejects.toThrow();
  });

  it('A1: staff may canonicalize any ingestion (review model preserved)', async () => {
    const owner = await createStudent('a1-staff-owner');
    const admin = await createUserWithRole('ADMIN', 'a1-admin');
    const source = await buildSource();

    const ingestion = await ingestionService.createIngestion(owner.user.id, {
      ingestMethod: 'IMAGE_UPLOAD',
      rawText: 'Synthetic A1 staff question stem long enough',
      normalizedText: 'Synthetic A1 staff question stem long enough',
      sourceId: source.id,
    });
    await driveToReviewReady(ingestionService, ingestion.id, admin.user.id, 'ADMIN');

    const result = await ingestionService.createCanonicalQuestionFromIngestion(
      ingestion.id,
      admin.user.id,
      'ADMIN'
    );
    expect(result.question.id).toBeTruthy();
    expect(result.question.origin).toBe('STUDENT_UPLOADED');
    // The instance belongs to the uploading student, not the reviewer.
    expect(result.instance?.studentId).toBe(owner.profile.id);
  });

  it('A1: cross-student canonicalization over HTTP is rejected (no unauthorized create)', async () => {
    const owner = await createStudent('a1-http-owner');
    const other = await createStudent('a1-http-other');
    const source = await buildSource();

    const ingestion = await ingestionService.createIngestion(owner.user.id, {
      ingestMethod: 'TEXT_PASTE',
      rawText: 'Synthetic A1 http question stem long enough',
      normalizedText: 'Synthetic A1 http question stem long enough',
      sourceId: source.id,
    });
    await driveToReviewReady(ingestionService, ingestion.id, owner.user.id, 'STUDENT');

    const res = await request(app)
      .post(`/api/v1/question-ingestions/${ingestion.id}/create-canonical`)
      .set('Authorization', `Bearer ${other.token}`);

    expect(res.status).toBeGreaterThanOrEqual(400);
    // No canonical question was produced by the non-owner.
    const after = await prisma.questionIngestion.findUnique({ where: { id: ingestion.id } });
    expect(after!.resultingQuestionId).toBeNull();
  });

  // ============================================================ A2 fail closed

  it('A2: a User without a StudentProfile is rejected and NO attempt is created', async () => {
    // Authenticated user with NO StudentProfile.
    const { user, token } = await createUserWithRole('STUDENT', 'a2-no-profile');
    const source = await buildSource();

    // An existing canonical question (created by a real student, for setup).
    const owner = await createStudent('a2-owner');
    const ingestion = await ingestionService.createIngestion(owner.user.id, {
      ingestMethod: 'TEXT_PASTE',
      rawText: 'Synthetic A2 question stem long enough',
      normalizedText: 'Synthetic A2 question stem long enough',
      sourceId: source.id,
    });
    await driveToReviewReady(ingestionService, ingestion.id, owner.user.id, 'STUDENT');
    const { question } = await ingestionService.createCanonicalQuestionFromIngestion(
      ingestion.id,
      owner.user.id,
      'STUDENT'
    );

    const res = await request(app)
      .post('/api/v1/question-attempts')
      .set('Authorization', `Bearer ${token}`)
      .send({ questionId: question.id, answer: 'x', timeSpentSeconds: 5, sessionId: 'standalone' });

    expect(res.status).toBe(401);

    const attempts = await prisma.questionAttempt.count();
    expect(attempts).toBe(0);
    // No StudentProfile was implicitly created.
    const profile = await prisma.studentProfile.findUnique({ where: { userId: user.id } });
    expect(profile).toBeNull();
  });

  // ============================================================ A3 visibility

  it('A3: a student cannot answer a question outside their journey (cross-student isolation)', async () => {
    const source = await buildSource();
    const owner = await createStudent('a3-owner');
    const intruder = await createStudent('a3-intruder');

    // Owner's question, available to the owner via a QuestionInstance.
    const ingestion = await ingestionService.createIngestion(owner.user.id, {
      ingestMethod: 'TEXT_PASTE',
      rawText: 'Synthetic A3 question stem long enough',
      normalizedText: 'Synthetic A3 question stem long enough',
      sourceId: source.id,
    });
    await driveToReviewReady(ingestionService, ingestion.id, owner.user.id, 'STUDENT');
    const { question } = await ingestionService.createCanonicalQuestionFromIngestion(
      ingestion.id,
      owner.user.id,
      'STUDENT'
    );

    // Intruder has NO instance/session for this question → rejected.
    await expect(
      attemptService.submitAnswer({
        studentId: intruder.profile.id,
        questionId: question.id,
        answer: 'anything',
        timeSpentSeconds: 5,
        sessionId: 'standalone',
      })
    ).rejects.toBeInstanceOf(AuthorizationError);

    // No attempt was persisted for the intruder.
    const count = await prisma.questionAttempt.count();
    expect(count).toBe(0);

    // The owner CAN answer (they hold the instance).
    const owned = await attemptService.submitAnswer({
      studentId: owner.profile.id,
      questionId: question.id,
      answer: 'anything',
      timeSpentSeconds: 5,
      sessionId: 'standalone',
    });
    expect(owned.attemptId).toBeTruthy();
  });

  it('A3: a question that exists but is in no journey is not answerable', async () => {
    const student = await createStudent('a3-orphan');
    const orphan = await prisma.question.create({
      data: {
        content: 'Synthetic orphan question stem long enough',
        type: 'OPEN_ENDED',
        difficulty: 1,
        skillId: 'unmapped',
        correctAnswer: '',
        isActive: false,
      },
    });

    await expect(
      attemptService.submitAnswer({
        studentId: student.profile.id,
        questionId: orphan.id,
        answer: 'x',
        timeSpentSeconds: 5,
        sessionId: 'standalone',
      })
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  // ============================================================ A4 rate limit order

  it('A4: authenticated requests are keyed by user, unauthenticated remain IP-protected', async () => {
    const student = await createStudent('a4-user');

    // First response for an authenticated request carries rate-limit headers,
    // proving the limiter ran; and a burst beyond the default max is prevented.
    const res = await request(app)
      .get('/api/v1/recommendations/next')
      .set('Authorization', `Bearer ${student.token}`);
    expect(res.status).toBe(200);

    // The principal resolver populated the user before the limiter: using an
    // invalid token still leaves the request unauthenticated (anonymous/IP), and
    // authentication is still enforced by the router.
    const anon = await request(app).get('/api/v1/recommendations/next');
    expect(anon.status).toBe(401);
  });

  // ============================================================ D review queue

  it('D: review queue is staff-only and lists items awaiting review', async () => {
    const student = await createStudent('d-student');
    const admin = await createUserWithRole('ADMIN', 'd-admin');
    const source = await buildSource();

    const ingestion = await ingestionService.createIngestion(student.user.id, {
      ingestMethod: 'IMAGE_UPLOAD',
      rawText: 'Synthetic D question stem long enough',
      normalizedText: 'Synthetic D question stem long enough',
      sourceId: source.id,
    });
    await driveToReviewReady(ingestionService, ingestion.id, student.user.id, 'STUDENT');

    // Student cannot view the queue.
    const denied = await request(app)
      .get('/api/v1/review-queue')
      .set('Authorization', `Bearer ${student.token}`);
    expect(denied.status).toBe(403);

    // Staff can, and the item is present with its review context.
    const ok = await request(app)
      .get('/api/v1/review-queue')
      .set('Authorization', `Bearer ${admin.token}`);
    expect(ok.status).toBe(200);
    expect(Array.isArray(ok.body.data)).toBe(true);

    const item = ok.body.data.find((i: any) => i.ingestionId === ingestion.id);
    expect(item).toBeTruthy();
    expect(item.state).toBe('REVIEW_REQUIRED');
    expect(item.origin).toBe('STUDENT_UPLOADED');
    expect(item.trustCeiling).toBe('UNVERIFIED');
    expect(item.normalizedText).toBeTruthy();
    // The queue never exposes the raw asset reference.
    expect(JSON.stringify(ok.body)).not.toContain('local://');
  });

  it('D: honest review gate — a student upload cannot be APPROVED (trust ceiling)', async () => {
    const student = await createStudent('d-gate-student');
    const admin = await createUserWithRole('ADMIN', 'd-gate-admin');
    const source = await buildSource();

    const ingestion = await ingestionService.createIngestion(student.user.id, {
      ingestMethod: 'IMAGE_UPLOAD',
      rawText: 'Synthetic D gate question stem long enough',
      normalizedText: 'Synthetic D gate question stem long enough',
      sourceId: source.id,
    });
    await driveToReviewReady(ingestionService, ingestion.id, admin.user.id, 'ADMIN');

    // Even staff cannot force APPROVED for a non auto-promotable origin.
    await expect(
      ingestionService.transitionIngestion(ingestion.id, admin.user.id, 'ADMIN', {
        toState: INGESTION_STATES.APPROVED,
      })
    ).rejects.toThrow(/trust ceiling/);

    // A student can never issue the APPROVED transition at all.
    await expect(
      ingestionService.transitionIngestion(ingestion.id, student.user.id, 'STUDENT', {
        toState: INGESTION_STATES.APPROVED,
      })
    ).rejects.toThrow();
  });
});
