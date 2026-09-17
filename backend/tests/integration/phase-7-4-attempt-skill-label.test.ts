import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

import bootstrap from '../../src/index.js';
import { prisma } from '../setup.js';

/**
 * Phase 7.4 — Final verification: the student attempt view carries the display
 * name of the question's authoritative PRIMARY MicroSkill, resolved server-side.
 *
 * This is the one Phase 7.4 behaviour that had no dedicated test. It exercises
 * the REAL HTTP surface (no service shortcut) so the label the student sees in
 * "Yanlışlarım" is proven to come from the same authoritative mapping the
 * mastery/error-analysis pipeline uses — never invented by the client.
 *
 * Contract under test:
 *   GET /api/v1/question-attempts           → { data: [ view, ... ] }
 *   GET /api/v1/question-attempts/:id       → { data: view }
 *   view.skillName : string | null
 *     - the active PRIMARY MicroSkill NAME when an active mapping exists,
 *     - `null` when no PRIMARY mapping exists or the mapped MicroSkill is inactive,
 *     - the internal microSkillId is NEVER exposed.
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

async function buildMicroSkill(name: string, isActive = true) {
  const uid = Math.random().toString(36).slice(2, 10);
  const version = await prisma.curriculumVersion.create({
    data: { code: 'P74-CUR-' + uid, name: 'P74', grade: 11, subject: 'Matematik', version: '1.0', source: 'TEST_FIXTURE' },
  });
  const theme = await prisma.theme.create({
    data: { curriculumVersionId: version.id, officialCode: 'P74.T-' + uid, name: 'T', lessonHours: 1, sourceOrder: 1 },
  });
  const lo = await prisma.learningOutcome.create({
    data: { themeId: theme.id, officialCode: 'P74.LO-' + uid, officialText: 'T', sourceOrder: 1 },
  });
  const pc = await prisma.processComponent.create({
    data: { learningOutcomeId: lo.id, officialCode: 'P74.PC-' + uid, officialText: 'T', sourceOrder: 1 },
  });
  const microSkill = await prisma.microSkill.create({
    data: {
      processComponentId: pc.id,
      code: 'P74.MS-' + uid,
      name,
      description: 'Synthetic microskill for the phase 7.4 label test',
      source: 'TEST_FIXTURE',
      isActive,
    },
  });
  return { microSkill, pc, lo, theme, version };
}

/**
 * Create a standalone question with a canonical answer (no ingestion needed) and
 * a QuestionInstance owned by the given student. The owned instance is what makes
 * the question "available to this student" for the standalone attempt path.
 */
async function buildQuestion(correctAnswer: string, studentId: string) {
  const uid = Math.random().toString(36).slice(2, 10);
  const source = await prisma.questionSource.create({
    data: {
      code: 'P74-SRC-' + uid,
      name: 'Fixture',
      origin: 'TEST_FIXTURE',
      trustCeiling: 'UNVERIFIED',
      isActive: true,
    },
  });
  const question = await prisma.question.create({
    data: {
      content: 'Synthetic: 3x + 1 = 10 denklemini çözünüz.',
      type: 'CALCULATION',
      correctAnswer,
      // Question.skillId is required by the schema; the authoritative curriculum
      // label under test comes from QuestionSkillMapping, not this legacy field.
      skillId: 'p74-legacy-' + uid,
      origin: 'TEST_FIXTURE',
      trust: 'UNVERIFIED',
      isActive: true,
      sourceId: source.id,
    },
  });
  const instance = await prisma.questionInstance.create({
    data: { questionId: question.id, studentId },
  });
  return { question, source, instance };
}

describe('Phase 7.4 — attempt view resolves the PRIMARY MicroSkill display name', () => {
  let app: express.Application;

  beforeAll(async () => {
    app = await bootstrap();
  });

  beforeEach(async () => {
    await prisma.questionAttempt.deleteMany({});
    await prisma.questionSkillMapping.deleteMany({});
    await prisma.masteryAudit.deleteMany({});
    await prisma.skillMastery.deleteMany({});
    await prisma.errorAnalysis.deleteMany({});
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

  it('L1. returns the active PRIMARY MicroSkill name for a mapped question', async () => {
    const student = await registerAndLogin(app, 'p74-mapped');
    const auth = { Authorization: `Bearer ${student.accessToken}` };
    const { microSkill } = await buildMicroSkill('Bileşke fonksiyon');
    const { question, instance } = await buildQuestion('3', student.studentProfileId);

    await prisma.questionSkillMapping.create({
      data: {
        questionId: question.id,
        microSkillId: microSkill.id,
        relevance: 0.9,
        isPrimary: true,
        reviewed: true,
        mappingSource: 'MANUAL_REVIEW',
      },
    });

    const submit = await request(app)
      .post('/api/v1/question-attempts')
      .set(auth)
      .set('Idempotency-Key', `p74-l1-${Date.now()}`)
      .send({ questionId: question.id, answer: '3', timeSpentSeconds: 15, sessionId: 'standalone', instanceId: instance.id });
    expect(submit.status).toBe(201);

    const get = await request(app)
      .get(`/api/v1/question-attempts/${submit.body.data.attemptId}`)
      .set(auth);

    expect(get.status).toBe(200);
    expect(get.body.data.skillName).toBe('Bileşke fonksiyon');
    // The internal identifier never crosses the boundary.
    expect(JSON.stringify(get.body)).not.toContain(microSkill.id);
  });

  it('L2. the list endpoint labels every attempt with the resolved name', async () => {
    const student = await registerAndLogin(app, 'p74-list');
    const auth = { Authorization: `Bearer ${student.accessToken}` };
    const { microSkill } = await buildMicroSkill('İşlem önceliği');
    const { question, instance } = await buildQuestion('3', student.studentProfileId);

    await prisma.questionSkillMapping.create({
      data: {
        questionId: question.id,
        microSkillId: microSkill.id,
        relevance: 0.9,
        isPrimary: true,
        reviewed: true,
        mappingSource: 'MANUAL_REVIEW',
      },
    });

    await request(app)
      .post('/api/v1/question-attempts')
      .set(auth)
      .send({ questionId: question.id, answer: '3', timeSpentSeconds: 10, sessionId: 'standalone', instanceId: instance.id });

    const list = await request(app).get('/api/v1/question-attempts').set(auth);
    expect(list.status).toBe(200);
    expect(Array.isArray(list.body.data)).toBe(true);
    expect(list.body.data.length).toBe(1);
    expect(list.body.data[0].skillName).toBe('İşlem önceliği');
  });

  it('L3. returns null (never a guessed label) when the question has no PRIMARY mapping', async () => {
    const student = await registerAndLogin(app, 'p74-unmapped');
    const auth = { Authorization: `Bearer ${student.accessToken}` };
    const { question, instance } = await buildQuestion('3', student.studentProfileId);

    const submit = await request(app)
      .post('/api/v1/question-attempts')
      .set(auth)
      .send({ questionId: question.id, answer: '3', timeSpentSeconds: 8, sessionId: 'standalone', instanceId: instance.id });

    const get = await request(app)
      .get(`/api/v1/question-attempts/${submit.body.data.attemptId}`)
      .set(auth);

    expect(get.status).toBe(200);
    expect(get.body.data.skillName).toBeNull();
  });

  it('L4. a SECONDARY-only mapping does not masquerade as the PRIMARY label', async () => {
    const student = await registerAndLogin(app, 'p74-secondary');
    const auth = { Authorization: `Bearer ${student.accessToken}` };
    const { microSkill } = await buildMicroSkill('İkincil beceri');
    const { question, instance } = await buildQuestion('3', student.studentProfileId);

    await prisma.questionSkillMapping.create({
      data: {
        questionId: question.id,
        microSkillId: microSkill.id,
        relevance: 0.4,
        isPrimary: false,
        reviewed: true,
        mappingSource: 'MANUAL_REVIEW',
      },
    });

    const submit = await request(app)
      .post('/api/v1/question-attempts')
      .set(auth)
      .send({ questionId: question.id, answer: '3', timeSpentSeconds: 8, sessionId: 'standalone', instanceId: instance.id });

    const get = await request(app)
      .get(`/api/v1/question-attempts/${submit.body.data.attemptId}`)
      .set(auth);

    expect(get.body.data.skillName).toBeNull();
  });

  it('L5. an inactive mapped MicroSkill yields a null label', async () => {
    const student = await registerAndLogin(app, 'p74-inactive');
    const auth = { Authorization: `Bearer ${student.accessToken}` };
    const { microSkill } = await buildMicroSkill('Pasif beceri', false);
    const { question, instance } = await buildQuestion('3', student.studentProfileId);

    await prisma.questionSkillMapping.create({
      data: {
        questionId: question.id,
        microSkillId: microSkill.id,
        relevance: 0.9,
        isPrimary: true,
        reviewed: true,
        mappingSource: 'MANUAL_REVIEW',
      },
    });

    const submit = await request(app)
      .post('/api/v1/question-attempts')
      .set(auth)
      .send({ questionId: question.id, answer: '3', timeSpentSeconds: 8, sessionId: 'standalone', instanceId: instance.id });

    const get = await request(app)
      .get(`/api/v1/question-attempts/${submit.body.data.attemptId}`)
      .set(auth);

    expect(get.body.data.skillName).toBeNull();
  });

  it('L6. a student cannot read another student\'s attempt (no cross-student label leak)', async () => {
    const a = await registerAndLogin(app, 'p74-owner-a');
    const b = await registerAndLogin(app, 'p74-owner-b');
    const { microSkill } = await buildMicroSkill('Gizli beceri');
    const { question, instance } = await buildQuestion('3', a.studentProfileId);

    await prisma.questionSkillMapping.create({
      data: {
        questionId: question.id,
        microSkillId: microSkill.id,
        relevance: 0.9,
        isPrimary: true,
        reviewed: true,
        mappingSource: 'MANUAL_REVIEW',
      },
    });

    const submit = await request(app)
      .post('/api/v1/question-attempts')
      .set({ Authorization: `Bearer ${a.accessToken}` })
      .send({ questionId: question.id, answer: '3', timeSpentSeconds: 8, sessionId: 'standalone', instanceId: instance.id });

    const crossRead = await request(app)
      .get(`/api/v1/question-attempts/${submit.body.data.attemptId}`)
      .set({ Authorization: `Bearer ${b.accessToken}` });

    expect(crossRead.status).toBe(403);
    expect(JSON.stringify(crossRead.body)).not.toContain('Gizli beceri');
  });
});
