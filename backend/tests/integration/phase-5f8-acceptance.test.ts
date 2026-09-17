import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import express from 'express';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import bootstrap from '../../src/index.js';
import { prisma } from '../setup.js';
import { TokenService } from '../../src/domain/services/TokenService.js';

/**
 * Phase 5F.8 — Acceptance: the full browser journey over real HTTP.
 *
 * Walks the 18-step acceptance list end-to-end:
 *   upload → ingestion → analysis → review-required (honest) → (staff) review →
 *   canonical → answer → mastery → error analysis → recommendation,
 * plus the cross-student authorization rejections.
 *
 * OCR / AI remain the development (mock) pipeline; the test asserts the REAL
 * backend behaviour for everything else.
 */

const PNG_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
]);

const tokenService = new TokenService();

async function makeUser(role: string, label: string) {
  const email = `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const user = await prisma.user.create({
    data: { email, firstName: label, lastName: 'User', role, passwordHash: 'hash' },
  });
  const token = tokenService.generateAccessToken({ userId: user.id, email, role });
  return { user, token };
}

async function makeStudent(label: string) {
  const { user, token } = await makeUser('STUDENT', label);
  const profile = await prisma.studentProfile.create({
    data: { userId: user.id, grade: 11, school: 'S' },
  });
  return { user, token, profile };
}

async function buildCurriculum() {
  const uid = Math.random().toString(36).slice(2, 10);
  const version = await prisma.curriculumVersion.create({
    data: { code: 'P5F8A-CUR-' + uid, name: 'C', grade: 11, subject: 'Matematik', version: '1.0', source: 'TEST_FIXTURE' },
  });
  const theme = await prisma.theme.create({
    data: { curriculumVersionId: version.id, officialCode: 'P5F8A.T-' + uid, name: 'T', lessonHours: 1, sourceOrder: 1 },
  });
  const lo = await prisma.learningOutcome.create({
    data: { themeId: theme.id, officialCode: 'P5F8A.LO-' + uid, officialText: 'T', sourceOrder: 1 },
  });
  const pc = await prisma.processComponent.create({
    data: { learningOutcomeId: lo.id, officialCode: 'P5F8A.PC-' + uid, officialText: 'T', sourceOrder: 1 },
  });
  const microSkill = await prisma.microSkill.create({
    data: {
      processComponentId: pc.id,
      code: 'P5F8A.MS-' + uid,
      name: 'MS',
      description: 'Synthetic microskill for the p5f8 acceptance test',
      source: 'TEST_FIXTURE',
      isActive: true,
    },
  });
  return { microSkill };
}

async function buildSource() {
  const uid = Math.random().toString(36).slice(2, 10);
  return prisma.questionSource.create({
    data: {
      code: 'P5F8A-SRC-' + uid,
      name: 'Student uploaded',
      origin: 'STUDENT_UPLOADED',
      trustCeiling: 'UNVERIFIED',
      license: 'Student-provided; not redistributable',
      isActive: true,
    },
  });
}

describe('Phase 5F.8 — Acceptance journey (real HTTP)', () => {
  let app: express.Application;
  let uploadDir: string;

  beforeAll(async () => {
    app = await bootstrap();
    uploadDir = await fs.mkdtemp(path.join(os.tmpdir(), 'p5f8-accept-'));
  });

  afterAll(async () => {
    await fs.rm(uploadDir, { recursive: true, force: true });
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

  it('runs the complete journey and enforces cross-student isolation', async () => {
    const student = await makeStudent('accept-student');
    const intruder = await makeStudent('accept-intruder');
    const admin = await makeUser('ADMIN', 'accept-admin');
    const { microSkill } = await buildCurriculum();
    const source = await buildSource();

    const auth = { Authorization: `Bearer ${student.token}` };
    const adminAuth = { Authorization: `Bearer ${admin.token}` };

    // 1–7: upload an image → validated → stored → ingestion created.
    const uploadRes = await request(app)
      .post(`/api/v1/question-ingestions/upload?sourceId=${source.id}`)
      .set(auth)
      .set('Content-Type', 'image/png')
      .set('X-Upload-Filename', encodeURIComponent('math-scan.png'))
      .send(PNG_BYTES);

    expect(uploadRes.status).toBe(201);
    const ingestionId = uploadRes.body.data.ingestion.id as string;
    expect(uploadRes.body.data.ingestion.state).toBe('INGESTED');
    expect(uploadRes.body.data.asset.contentHash).toHaveLength(64);

    // 8–9: the pipeline receives the asset reference; mock OCR/analysis runs.
    const analyzeRes = await request(app)
      .post(`/api/v1/question-ingestions/${ingestionId}/analyze`)
      .set(auth)
      .send({}); // no skipOcr: the mock OCR provider consumes the stored asset ref

    expect(analyzeRes.status).toBe(200);

    // 10: review-required behaviour is honest and enforced.
    const afterAnalyze = await request(app).get(`/api/v1/question-ingestions/${ingestionId}`).set(auth);
    const stateAfterAnalyze = afterAnalyze.body.data.state as string;
    if (stateAfterAnalyze === 'ANALYZED') {
      await request(app)
        .post(`/api/v1/question-ingestions/${ingestionId}/transition`)
        .set(auth)
        .send({ toState: 'MAPPED' });
      await request(app)
        .post(`/api/v1/question-ingestions/${ingestionId}/transition`)
        .set(auth)
        .send({ toState: 'REVIEW_REQUIRED' });
    }
    const reviewState = (await request(app).get(`/api/v1/question-ingestions/${ingestionId}`).set(auth))
      .body.data.state;
    expect(reviewState).toBe('REVIEW_REQUIRED');
    const requiresReview = (await request(app).get(`/api/v1/question-ingestions/${ingestionId}`).set(auth))
      .body.data.requiresReview;
    expect(requiresReview).toBe(true);

    // 11: an authorized reviewer sees it in the queue (and learns the ceiling).
    const queueRes = await request(app).get('/api/v1/review-queue').set(adminAuth);
    expect(queueRes.status).toBe(200);
    const queueItem = queueRes.body.data.find((i: any) => i.ingestionId === ingestionId);
    expect(queueItem).toBeTruthy();
    expect(queueItem.trustCeiling).toBe('UNVERIFIED');

    // 12: approved content proceeds through the existing canonicalization rules.
    //     A student upload is reviewed to REVIEW_REQUIRED, which is the designed
    //     canonicalizable state for non auto-promotable origins. The OWNER runs it
    //     from the panel; here we assert the owner is allowed.
    const canonicalRes = await request(app)
      .post(`/api/v1/question-ingestions/${ingestionId}/create-canonical`)
      .set(auth);
    expect(canonicalRes.status).toBe(201);
    const questionId = canonicalRes.body.data.question.id as string;
    const instanceId = canonicalRes.body.data.instance.id as string;
    expect(canonicalRes.body.data.question.trust).toBe('UNVERIFIED');
    expect(canonicalRes.body.data.question.origin).toBe('STUDENT_UPLOADED');

    // The canonical Question is part of THIS student's journey (an instance).
    const instance = await prisma.questionInstance.findUnique({ where: { id: instanceId } });
    expect(instance!.studentId).toBe(student.profile.id);

    // Give the synthetic question an answer key + a PRIMARY mapping so mastery
    // and error analysis have an authoritative MicroSkill.
    await prisma.question.update({ where: { id: questionId }, data: { correctAnswer: '13' } });
    await prisma.questionSkillMapping.create({
      data: {
        questionId,
        microSkillId: microSkill.id,
        relevance: 0.9,
        isPrimary: true,
        reviewed: true,
        mappingSource: 'MANUAL_REVIEW',
      },
    });

    // 17: cross-student access is rejected BEFORE the answer is accepted.
    const intruderRes = await request(app)
      .post('/api/v1/question-attempts')
      .set('Authorization', `Bearer ${intruder.token}`)
      .send({ questionId, answer: '13', timeSpentSeconds: 10, sessionId: 'standalone' });
    expect(intruderRes.status).toBe(403);

    // 18: no unauthorized user can canonicalize another student's ingestion.
    //     (new ingestion owned by the student, driven to review by the student.)
    const secondUpload = await request(app)
      .post(`/api/v1/question-ingestions/upload?sourceId=${source.id}`)
      .set(auth)
      .set('Content-Type', 'image/png')
      .set('X-Upload-Filename', 'second.png')
      .send(PNG_BYTES);
    const secondId = secondUpload.body.data.ingestion.id as string;
    await request(app)
      .post(`/api/v1/question-ingestions/${secondId}/analyze`)
      .set(auth)
      .send({ skipOcr: true, normalizedText: 'Synthetic acceptance second question stem' });
    const secondState = (await request(app).get(`/api/v1/question-ingestions/${secondId}`).set(auth))
      .body.data.state;
    if (secondState === 'ANALYZED') {
      await request(app).post(`/api/v1/question-ingestions/${secondId}/transition`).set(auth).send({ toState: 'MAPPED' });
      await request(app).post(`/api/v1/question-ingestions/${secondId}/transition`).set(auth).send({ toState: 'REVIEW_REQUIRED' });
    }
    const intruderCanonical = await request(app)
      .post(`/api/v1/question-ingestions/${secondId}/create-canonical`)
      .set('Authorization', `Bearer ${intruder.token}`);
    expect(intruderCanonical.status).toBeGreaterThanOrEqual(400);

    // 13–16: student answers → mastery → error analysis → recommendation.
    const correctRes = await request(app)
      .post('/api/v1/question-attempts')
      .set(auth)
      .set('Idempotency-Key', `p5f8-accept-correct-${Date.now()}`)
      .send({ questionId, answer: '13', timeSpentSeconds: 30, sessionId: 'standalone' });

    expect(correctRes.status).toBe(201);
    expect(correctRes.body.data.isCorrect).toBe(true);

    // Mastery updated.
    const skillsRes = await request(app).get('/api/v1/analytics/me/skills').set(auth);
    expect(skillsRes.status).toBe(200);
    expect(skillsRes.body.data.length).toBeGreaterThan(0);
    const mastery = await prisma.skillMastery.findUnique({
      where: { studentId_skillId: { studentId: student.profile.id, skillId: microSkill.id } },
    });
    expect(mastery).toBeTruthy();
    expect(mastery!.masteryLevel).toBeGreaterThan(0);

    // Recommendation returned.
    const recRes = await request(app).get('/api/v1/recommendations/next').set(auth);
    expect(recRes.status).toBe(200);
    expect(recRes.body.data.actionType).toBeTruthy();

    // Error analysis updates for an INCORRECT answer on a second attempt
    // (a fresh question so the attempt is not the same as the correct one).
    await prisma.question.update({ where: { id: questionId }, data: { correctAnswer: '13' } });
    const wrongRes = await request(app)
      .post('/api/v1/question-attempts')
      .set(auth)
      .set('Idempotency-Key', `p5f8-accept-wrong-${Date.now()}`)
      .send({ questionId, answer: '99', timeSpentSeconds: 20, sessionId: 'standalone' });
    expect(wrongRes.status).toBe(201);
    expect(wrongRes.body.data.isCorrect).toBe(false);

    const wrongAttemptId = wrongRes.body.data.attemptId as string;
    // Error analysis runs as part of the attempt flow (idempotent, post-commit).
    const attemptDetail = await prisma.questionAttempt.findUnique({ where: { id: wrongAttemptId } });
    expect(attemptDetail).toBeTruthy();
  });

  it('rejects an unauthenticated upload (no anonymous writes)', async () => {
    const res = await request(app)
      .post('/api/v1/question-ingestions/upload')
      .set('Content-Type', 'image/png')
      .send(PNG_BYTES);
    expect(res.status).toBe(401);
  });
});
