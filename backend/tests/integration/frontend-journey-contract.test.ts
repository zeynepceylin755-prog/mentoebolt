import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

import bootstrap from '../../src/index.js';
import { prisma } from '../setup.js';

/**
 * Phase 5F.7 (C) — Frontend-facing API contract.
 *
 * Proves the exact request/response contract the browser journey relies on,
 * using the real HTTP surface (no internal service shortcut):
 *   create ingestion → analyze → drive to review → create canonical →
 *   submit attempt → read mastery/recommendation.
 *
 * The frontend is never authoritative: correctness comes from the backend.
 */

async function registerAndLogin(app: express.Application, label: string) {
  const email = `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const password = 'Test123!@#';

  await request(app)
    .post('/api/v1/auth/register')
    .send({ email, password, firstName: label, lastName: 'User', grade: 11 });

  const login = await request(app).post('/api/v1/auth/login').send({ email, password });
  const accessToken = login.body.data.tokens.accessToken as string;
  const profile = await prisma.studentProfile.findUnique({
    where: { userId: login.body.data.user.id },
  });
  if (!profile) throw new Error('Expected a StudentProfile');
  return { accessToken, studentProfileId: profile.id };
}

async function buildCurriculumAndSource() {
  const uid = Math.random().toString(36).slice(2, 10);
  const version = await prisma.curriculumVersion.create({
    data: { code: 'P5F7-CUR-' + uid, name: 'P5F7', grade: 11, subject: 'Matematik', version: '1.0', source: 'TEST_FIXTURE' },
  });
  const theme = await prisma.theme.create({
    data: { curriculumVersionId: version.id, officialCode: 'P5F7.T-' + uid, name: 'T', lessonHours: 1, sourceOrder: 1 },
  });
  const lo = await prisma.learningOutcome.create({
    data: { themeId: theme.id, officialCode: 'P5F7.LO-' + uid, officialText: 'T', sourceOrder: 1 },
  });
  const pc = await prisma.processComponent.create({
    data: { learningOutcomeId: lo.id, officialCode: 'P5F7.PC-' + uid, officialText: 'T', sourceOrder: 1 },
  });
  const microSkill = await prisma.microSkill.create({
    data: {
      processComponentId: pc.id,
      code: 'P5F7.MS-' + uid,
      name: 'MS',
      description: 'Synthetic microskill for the p5f7 contract test',
      source: 'TEST_FIXTURE',
      isActive: true,
    },
  });
  const source = await prisma.questionSource.create({
    data: {
      code: 'P5F7-SRC-' + uid,
      name: 'Student uploaded',
      origin: 'STUDENT_UPLOADED',
      trustCeiling: 'UNVERIFIED',
      license: 'Student-provided; not redistributable',
      isActive: true,
    },
  });
  return { microSkill, source };
}

describe('Phase 5F.7 (C) — Frontend journey HTTP contract', () => {
  let app: express.Application;

  beforeAll(async () => {
    app = await bootstrap();
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
    await prisma.questionSource.deleteMany({});
    await prisma.microSkill.deleteMany({});
    await prisma.processComponent.deleteMany({});
    await prisma.learningOutcome.deleteMany({});
    await prisma.theme.deleteMany({});
    await prisma.curriculumVersion.deleteMany({});
    await prisma.idempotencyRecord.deleteMany({});
    await prisma.studentProfile.deleteMany({});
    await prisma.user.deleteMany({});
  });

  it('drives the full browser journey over real HTTP and returns backend-owned results', async () => {
    const student = await registerAndLogin(app, 'journey');
    const auth = { Authorization: `Bearer ${student.accessToken}` };
    const { microSkill, source } = await buildCurriculumAndSource();

    // 1. Create ingestion (what the panel's first call does).
    const createRes = await request(app)
      .post('/api/v1/question-ingestions')
      .set(auth)
      .set('Idempotency-Key', `p5f7-c-${Date.now()}`)
      .send({
        ingestMethod: 'TEXT_PASTE',
        rawText: 'Synthetic: f(x) = 2x + 3 fonksiyonu için f(5) değeri kaçtır?',
        sourceId: source.id,
      });

    expect(createRes.status).toBe(201);
    expect(createRes.body.success).toBe(true);
    const ingestionId = createRes.body.data.id as string;
    expect(createRes.body.data.state).toBe('INGESTED');

    // 2. Analyze (development/mock pipeline backing).
    const analyzeRes = await request(app)
      .post(`/api/v1/question-ingestions/${ingestionId}/analyze`)
      .set(auth)
      .send({ skipOcr: true, normalizedText: 'Synthetic: f(x) = 2x + 3 fonksiyonu için f(5) değeri kaçtır?' });

    expect(analyzeRes.status).toBe(200);
    expect(analyzeRes.body.success).toBe(true);

    // 3. Drive to a reviewed state along the real state machine.
    const afterAnalyze = await request(app)
      .get(`/api/v1/question-ingestions/${ingestionId}`)
      .set(auth);
    const analyzedState = afterAnalyze.body.data.state as string;

    if (analyzedState === 'ANALYZED') {
      const toMapped = await request(app)
        .post(`/api/v1/question-ingestions/${ingestionId}/transition`)
        .set(auth)
        .send({ toState: 'MAPPED' });
      expect(toMapped.status).toBe(200);

      const toReview = await request(app)
        .post(`/api/v1/question-ingestions/${ingestionId}/transition`)
        .set(auth)
        .send({ toState: 'REVIEW_REQUIRED' });
      expect(toReview.status).toBe(200);
    } else {
      expect(analyzedState).toBe('REVIEW_REQUIRED');
    }

    // 4. Create the canonical question + student instance.
    const canonicalRes = await request(app)
      .post(`/api/v1/question-ingestions/${ingestionId}/create-canonical`)
      .set(auth);

    expect(canonicalRes.status).toBe(201);
    expect(canonicalRes.body.data.question.id).toBeTruthy();
    expect(canonicalRes.body.data.instance).toBeTruthy();
    const questionId = canonicalRes.body.data.question.id as string;

    // Define an answer key (the panel's flow needs a real correct answer).
    await prisma.question.update({ where: { id: questionId }, data: { correctAnswer: '13' } });

    // PRIMARY mapping so mastery/error analysis have an authoritative MicroSkill.
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

    // 5. Submit an answer over HTTP — backend is authoritative.
    const attemptRes = await request(app)
      .post('/api/v1/question-attempts')
      .set(auth)
      .set('Idempotency-Key', `p5f7-ca-${Date.now()}`)
      .send({ questionId, answer: '13', timeSpentSeconds: 30, sessionId: 'standalone' });

    expect(attemptRes.status).toBe(201);
    expect(attemptRes.body.data.isCorrect).toBe(true);
    expect(attemptRes.body.data.attemptId).toBeTruthy();

    // 6. Mastery + recommendation are read back from the backend.
    const skillsRes = await request(app).get('/api/v1/analytics/me/skills').set(auth);
    expect(skillsRes.status).toBe(200);
    expect(Array.isArray(skillsRes.body.data)).toBe(true);
    expect(skillsRes.body.data.length).toBeGreaterThan(0);

    const recRes = await request(app).get('/api/v1/recommendations/next').set(auth);
    expect(recRes.status).toBe(200);
    expect(recRes.body.data.actionType).toBeTruthy();
  });

  it('rejects a wrong answer without the frontend ever computing correctness', async () => {
    const student = await registerAndLogin(app, 'wrongans');
    const auth = { Authorization: `Bearer ${student.accessToken}` };
    const { source } = await buildCurriculumAndSource();

    const createRes = await request(app)
      .post('/api/v1/question-ingestions')
      .set(auth)
      .send({
        ingestMethod: 'TEXT_PASTE',
        rawText: 'Synthetic: 2 + 2 kaçtır?',
        sourceId: source.id,
      });
    const ingestionId = createRes.body.data.id as string;

    await request(app)
      .post(`/api/v1/question-ingestions/${ingestionId}/analyze`)
      .set(auth)
      .send({ skipOcr: true, normalizedText: 'Synthetic: 2 + 2 kaçtır?' });

    const state = (await request(app).get(`/api/v1/question-ingestions/${ingestionId}`).set(auth)).body.data.state;
    if (state === 'ANALYZED') {
      await request(app).post(`/api/v1/question-ingestions/${ingestionId}/transition`).set(auth).send({ toState: 'MAPPED' });
      await request(app).post(`/api/v1/question-ingestions/${ingestionId}/transition`).set(auth).send({ toState: 'REVIEW_REQUIRED' });
    }

    const canonicalRes = await request(app)
      .post(`/api/v1/question-ingestions/${ingestionId}/create-canonical`)
      .set(auth);
    const questionId = canonicalRes.body.data.question.id as string;
    await prisma.question.update({ where: { id: questionId }, data: { correctAnswer: '4' } });

    const attemptRes = await request(app)
      .post('/api/v1/question-attempts')
      .set(auth)
      .send({ questionId, answer: '5', timeSpentSeconds: 12, sessionId: 'standalone' });

    expect(attemptRes.status).toBe(201);
    // The backend decides correctness; the client only displays it.
    expect(attemptRes.body.data.isCorrect).toBe(false);
  });

  it('does not expose asset references or raw OCR text in the ingestion projection', async () => {
    const student = await registerAndLogin(app, 'projection');
    const auth = { Authorization: `Bearer ${student.accessToken}` };
    const { source } = await buildCurriculumAndSource();

    const createRes = await request(app)
      .post('/api/v1/question-ingestions')
      .set(auth)
      .send({
        ingestMethod: 'IMAGE_UPLOAD',
        originalAssetRef: 's3://student-uploads/p5f7-contract.png',
        rawText: 'Synthetic projection check',
        sourceId: source.id,
      });

    const ingestionId = createRes.body.data.id as string;
    const getRes = await request(app).get(`/api/v1/question-ingestions/${ingestionId}`).set(auth);

    expect(getRes.status).toBe(200);
    const body = JSON.stringify(getRes.body);
    expect(body).not.toContain('s3://student-uploads/p5f7-contract.png');
    expect(body).not.toContain('rawExtractedText');
  });
});
