import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

import bootstrap from '../../src/index.js';
import { prisma } from '../setup.js';
import { AIExplanationService } from '../../src/application/services/ai/AIExplanationService.js';
import {
  RealExplanationProvider,
  buildPrompt,
} from '../../src/infrastructure/ai/explanation/RealExplanationProvider.js';
import { createExplanationProviderFromConfig } from '../../src/infrastructure/ai/explanation/ExplanationProviderFactory.js';
import { MockAIProvider } from '../../src/infrastructure/ai/providers/MockAIProvider.js';
import { getExplanationConfig } from '../../src/infrastructure/ai/explanation/config/ExplanationConfig.js';
import { assessAnswerLeakage } from '../../src/domain/ai/explanationPolicy.js';
import { AiAnalysisError } from '../../src/domain/errors/QuestionAnalysisErrors.js';
import type { ExplanationConfig } from '../../src/infrastructure/ai/explanation/config/ExplanationConfig.js';
import type { IAIProvider, AIRequest, AIResponse } from '../../src/domain/interfaces/ai/IAIProvider.js';

/**
 * Phase 5F.9-E — Final AI integration & end-to-end verification.
 *
 * Proves the real student journey is wired to the SAFE explanation layer while the
 * backend stays authoritative for attempt persistence, mastery, progress, error
 * analysis, curriculum identity and recommendation state.
 *
 * Every external boundary is faked: NO real network call is made anywhere. The
 * explanation provider is exercised through an injected fetch stub, and the HTTP
 * surface runs against the isolated test database (prisma/test.db).
 */

const CANONICAL_ANSWER = 'x = 4242';
const SECRET_QUESTION = 'SENSITIVE_QUESTION_P5F9E_551';
const SECRET_STUDENT_ANSWER = 'SENSITIVE_STUDENT_ANSWER_P5F9E_773';
const API_KEY = 'sk-test-secret-p5f9e';

// --------------------------------------------------------------------- helpers

function makeConfig(overrides: Partial<ExplanationConfig> = {}): ExplanationConfig {
  return {
    provider: 'openai',
    model: 'gpt-4o',
    timeoutMs: 5000,
    maxRetries: 2,
    allowExternalProvider: true,
    baseUrl: 'https://api.example.test/v1',
    apiKey: API_KEY,
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200, headers?: Record<string, string>) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (n: string) => headers?.[n.toLowerCase()] ?? null },
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  };
}

function envelope(contentText: string) {
  return { model: 'gpt-4o', choices: [{ message: { content: contentText }, finish_reason: 'stop' }] };
}

function safePayload(overrides: Record<string, unknown> = {}) {
  return {
    explanation:
      'Cevabı aramadan önce sorudaki hangi koşulun doğrudan ilgili kuralı işaret ettiğini belirle.',
    stepByStep: ['İfadeyi hangi işlemin dönüştüreceğini düşün.'],
    examples: [],
    keyPoints: ['Önce gerekli koşulu seç.'],
    practiceSuggestion: 'Benzer bir soruda önce koşulu yaz.',
    ...overrides,
  };
}

function leakyPayload() {
  return safePayload({ explanation: 'İlk adımı doğru yaptın. The answer is x = 4242.' });
}

/** Deterministic IAIProvider for AIExplanationService-level tests. */
class StubProvider implements IAIProvider {
  calls: AIRequest[] = [];
  constructor(private readonly outputs: unknown[]) {}
  getProviderName() { return 'stub'; }
  getModelName() { return 'stub-model'; }
  getVersion() { return 'stub-1'; }
  async isAvailable() { return true; }
  async complete(_r: AIRequest): Promise<AIResponse> {
    return { content: '', model: 'stub-model', version: 'stub-1', tokensUsed: 0, latencyMs: 0, finishReason: 'stop' };
  }
  async completeStructured<T>(r: AIRequest, _s?: unknown): Promise<AIResponse & { structured: T }> {
    this.calls.push(r);
    const value = this.outputs[Math.min(this.calls.length - 1, this.outputs.length - 1)];
    if (value instanceof Error) throw value;
    return {
      content: JSON.stringify(value),
      structured: value as T,
      model: 'stub-model',
      version: 'stub-1',
      tokensUsed: 0,
      latencyMs: 0,
      finishReason: 'stop',
    };
  }
}

async function registerAndLogin(app: express.Application, label: string) {
  const email = `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const password = 'Test123!@#';
  await request(app).post('/api/v1/auth/register').send({ email, password, firstName: label, lastName: 'User', grade: 11 });
  const login = await request(app).post('/api/v1/auth/login').send({ email, password });
  const accessToken = login.body.data.tokens.accessToken as string;
  const profile = await prisma.studentProfile.findUnique({ where: { userId: login.body.data.user.id } });
  if (!profile) throw new Error('Expected a StudentProfile');
  return { accessToken, studentProfileId: profile.id };
}

/** Build a curriculum + MicroSkill + ErrorPattern fixture and a canonical question. */
async function buildAuthoritativeFixture(options: { withPattern?: boolean } = {}) {
  const uid = Math.random().toString(36).slice(2, 10);
  const version = await prisma.curriculumVersion.create({
    data: { code: 'P5F9E-CUR-' + uid, name: 'P5F9E', grade: 11, subject: 'Matematik', version: '1.0', source: 'TEST_FIXTURE' },
  });
  const theme = await prisma.theme.create({
    data: { curriculumVersionId: version.id, officialCode: 'P5F9E.T-' + uid, name: 'T', lessonHours: 1, sourceOrder: 1 },
  });
  const lo = await prisma.learningOutcome.create({
    data: { themeId: theme.id, officialCode: 'P5F9E.LO-' + uid, officialText: 'T', sourceOrder: 1 },
  });
  const pc = await prisma.processComponent.create({
    data: { learningOutcomeId: lo.id, officialCode: 'P5F9E.PC-' + uid, officialText: 'T', sourceOrder: 1 },
  });
  const microSkill = await prisma.microSkill.create({
    data: {
      processComponentId: pc.id,
      code: 'P5F9E.MS-' + uid,
      name: 'Doğrusal denklem çözme',
      description: 'Bilinmeyeni yalnız bırak.',
      source: 'TEST_FIXTURE',
      isActive: true,
    },
  });

  let errorPattern = null;
  if (options.withPattern) {
    errorPattern = await prisma.errorPattern.create({
      data: {
        code: 'P5F9E-EP-' + uid,
        name: 'Conceptual Misunderstanding',
        description: 'Synthetic fixture pattern',
        category: 'CONCEPTUAL_MISUNDERSTANDING',
        severity: 'MEDIUM',
        source: 'TEST_FIXTURE',
        isActive: true,
      },
    });
    await prisma.errorPatternMicroSkill.create({
      data: { errorPatternId: errorPattern.id, microSkillId: microSkill.id, relevance: 0.9, isPrimary: true },
    });
  }

  const question = await prisma.question.create({
    data: {
      content: '2x + 3 = 11 denklemini çözünüz.',
      type: 'CALCULATION',
      difficulty: 2,
      // The legacy required column. The AUTHORITATIVE skill identity used by the
      // backend is the PRIMARY QuestionSkillMapping below, not this field.
      skillId: microSkill.id,
      correctAnswer: '4',
      isActive: true,
    } as any,
  });

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

  return { microSkill, errorPattern, question, version, theme, lo, pc };
}

/** Give a question to a student via a QuestionInstance (the upload journey relation). */
async function giveQuestionToStudent(questionId: string, studentProfileId: string) {
  return prisma.questionInstance.create({ data: { questionId, studentId: studentProfileId } });
}

// ==================================================== SERVICE-LEVEL SCENARIOS

describe('Phase 5F.9-E — Scenario C: explanation regeneration & leakage policy', () => {
  const serviceRequest = {
    concept: 'Doğrusal denklem çözme',
    question: '2x + 3 = 11 denklemini çözünüz.',
    studentAnswer: 'x = 3',
    skillId: 'ms-1',
    difficulty: 2,
    previousAttempts: 1,
    level: 'intermediate' as const,
    skillName: 'Doğrusal denklem çözme',
    skillDescription: 'Bilinmeyeni yalnız bırak.',
  };

  it('C1. unsafe first output is rejected, exactly one regeneration is attempted', async () => {
    const stub = new StubProvider([leakyPayload(), safePayload()]);
    const result = await new AIExplanationService(stub).generateExplanation({ ...serviceRequest, mode: 'HINT' });
    expect(stub.calls).toHaveLength(2);
    expect(result.metadata.safety).toBe('regenerated');
    expect(result.metadata.source).toBe('provider');
  });

  it('C2. a second unsafe output causes a safe, answer-free fallback', async () => {
    const stub = new StubProvider([leakyPayload(), leakyPayload()]);
    const result = await new AIExplanationService(stub).generateExplanation({ ...serviceRequest, mode: 'HINT' });
    expect(stub.calls).toHaveLength(2);
    expect(result.metadata.source).toBe('fallback');
    expect(result.metadata.model).toBe('safe-fallback');
    expect(JSON.stringify(result)).not.toMatch(/answer is/i);
    // The rejected text never reaches the caller.
    expect(result.explanation).not.toContain('4242');
  });

  it('C3. no unfiltered unsafe output reaches the student across every mode', async () => {
    for (const mode of ['HINT', 'SOCRATIC', 'FORMULA_REMINDER', 'MISTAKE_GUIDANCE', 'NEXT_STEP'] as const) {
      const result = await new AIExplanationService(new StubProvider([leakyPayload()]))
        .generateExplanation({ ...serviceRequest, mode });
      expect(assessAnswerLeakage(result).safe).toBe(true);
    }
  });
});

describe('Phase 5F.9-E — Scenario D: provider failure', () => {
  const serviceRequest = {
    concept: 'Doğrusal denklem çözme',
    skillId: 'ms-1',
    difficulty: 2,
    previousAttempts: 0,
    level: 'intermediate' as const,
  };

  it('D1. a permanent provider failure yields a truthful fallback, never a fabricated explanation', async () => {
    const result = await new AIExplanationService(new StubProvider([new Error('provider down')]))
      .generateExplanation({ ...serviceRequest, mode: 'HINT' });
    expect(result.metadata.source).toBe('fallback');
    expect(result.metadata.model).toBe('safe-fallback');
    expect(result.metadata.tokensUsed).toBe(0);
    expect(assessAnswerLeakage(result).safe).toBe(true);
  });

  it('D2. a permanent 4xx is not retried at the transport boundary', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse('bad request', 400));
    const provider = new RealExplanationProvider(makeConfig({ maxRetries: 3 }), {
      fetchImpl,
      sleepImpl: vi.fn(async () => {}),
    });
    await expect(provider.generateGuidance({ mode: 'HINT', question: 'q' })).rejects.toBeInstanceOf(AiAnalysisError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('D3. malformed JSON never silently becomes a fabricated explanation', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(envelope('this is not json')));
    const provider = new RealExplanationProvider(makeConfig(), { fetchImpl, sleepImpl: vi.fn(async () => {}) });
    await expect(provider.generateGuidance({ mode: 'HINT', question: 'q' })).rejects.toBeInstanceOf(AiAnalysisError);
  });

  it('D4. a provider failure does not mutate authoritative learning state', async () => {
    const before = {
      attempt: await prisma.questionAttempt.count(),
      mastery: await prisma.skillMastery.count(),
      progress: await prisma.learningProgress.count(),
      analysis: await prisma.errorAnalysis.count(),
      pattern: await prisma.errorPattern.count(),
      mapping: await prisma.questionSkillMapping.count(),
    };

    await new AIExplanationService(new StubProvider([new Error('boom')]))
      .generateExplanation({ ...serviceRequest, mode: 'HINT' });

    expect(await prisma.questionAttempt.count()).toBe(before.attempt);
    expect(await prisma.skillMastery.count()).toBe(before.mastery);
    expect(await prisma.learningProgress.count()).toBe(before.progress);
    expect(await prisma.errorAnalysis.count()).toBe(before.analysis);
    expect(await prisma.errorPattern.count()).toBe(before.pattern);
    expect(await prisma.questionSkillMapping.count()).toBe(before.mapping);
  });
});

describe('Phase 5F.9-E — Step 5: correct-answer protection (single end-to-end path)', () => {
  it('P1. correctAnswer is absent from ExplanationModelRequest by construction', async () => {
    const stub = new StubProvider([safePayload()]);
    const service = new AIExplanationService(stub);
    // Simulate a caller that still tries to pass it.
    await service.generateExplanation({
      concept: 'c', skillId: 's', difficulty: 1, previousAttempts: 0, level: 'intermediate',
      correctAnswer: CANONICAL_ANSWER,
    } as any);
    const sent = JSON.stringify(stub.calls[0].messages);
    expect(sent).not.toContain(CANONICAL_ANSWER);
    expect(sent).not.toMatch(/correct\s+answer/i);
  });

  it('P2. correctAnswer is absent from the generated prompt', () => {
    const prompt = buildPrompt({ mode: 'HINT', question: 'q', studentAnswer: 'a' });
    expect(prompt).not.toContain(CANONICAL_ANSWER);
    expect(prompt).not.toMatch(/correct\s+answer\s*:/i);
  });

  it('P3. correctAnswer is absent from the actual HTTP request body to the provider', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(envelope(JSON.stringify(safePayload()))));
    const provider = new RealExplanationProvider(makeConfig(), { fetchImpl, sleepImpl: vi.fn(async () => {}) });
    await provider.generateGuidance({
      mode: 'HINT',
      question: SECRET_QUESTION,
      studentAnswer: SECRET_STUDENT_ANSWER,
      // @ts-expect-error deliberately hostile extra field
      correctAnswer: CANONICAL_ANSWER,
    });

    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, { body: string }];
    expect(init.body).not.toContain(CANONICAL_ANSWER);
    expect(init.body).not.toMatch(/correct\s+answer\s*:/i);
    // The student's own answer IS allowed as evidence.
    expect(init.body).toContain(SECRET_STUDENT_ANSWER);
  });

  it('P4. no hidden server-side transformation reintroduces correctAnswer before invocation', async () => {
    // Walk the whole request in the direction the code does: prompt -> transport.
    const stub = new StubProvider([safePayload()]);
    await new AIExplanationService(stub).generateExplanation({
      concept: 'c', skillId: 's', difficulty: 1, previousAttempts: 0, level: 'intermediate',
      question: SECRET_QUESTION, studentAnswer: SECRET_STUDENT_ANSWER, correctAnswer: CANONICAL_ANSWER,
    } as any);
    const transportMessages = JSON.stringify(stub.calls[0].messages);
    expect(transportMessages).toContain(SECRET_QUESTION);
    expect(transportMessages).toContain(SECRET_STUDENT_ANSWER);
    expect(transportMessages).not.toContain(CANONICAL_ANSWER);
  });
});

// ==================================================== HTTP JOURNEY SCENARIOS

describe('Phase 5F.9-E — Real student journey over HTTP', () => {
  let app: express.Application;

  beforeAll(async () => {
    app = await bootstrap();
  });

  beforeEach(async () => {
    await prisma.masteryAudit.deleteMany({});
    await prisma.skillMastery.deleteMany({});
    await prisma.learningProgress.deleteMany({});
    await prisma.errorAnalysis.deleteMany({});
    await prisma.errorPatternMicroSkill.deleteMany({});
    await prisma.errorPattern.deleteMany({});
    await prisma.questionAttempt.deleteMany({});
    await prisma.questionSkillMapping.deleteMany({});
    await prisma.questionInstance.deleteMany({});
    await prisma.question.deleteMany({});
    await prisma.microSkill.deleteMany({});
    await prisma.processComponent.deleteMany({});
    await prisma.learningOutcome.deleteMany({});
    await prisma.theme.deleteMany({});
    await prisma.curriculumVersion.deleteMany({});
    await prisma.idempotencyRecord.deleteMany({});
    await prisma.studentProfile.deleteMany({});
    await prisma.user.deleteMany({});
    await prisma.auditLog.deleteMany({});
  });

  // ----------------------------------------------------------- Scenario A
  it('A1. a correct answer creates an attempt, applies authoritative mastery and no ErrorAnalysis', async () => {
    const student = await registerAndLogin(app, 'p5f9e-correct');
    const auth = { Authorization: `Bearer ${student.accessToken}` };
    const { question, microSkill } = await buildAuthoritativeFixture();
    await giveQuestionToStudent(question.id, student.studentProfileId);

    const res = await request(app)
      .post('/api/v1/question-attempts')
      .set(auth)
      .set('Idempotency-Key', `p5f9e-a-${Date.now()}`)
      .send({ questionId: question.id, answer: '4', timeSpentSeconds: 20, sessionId: 'standalone' });

    expect(res.status).toBe(201);
    expect(res.body.data.isCorrect).toBe(true);
    const attemptId = res.body.data.attemptId as string;

    // QuestionAttempt persisted.
    const persistedAttempt = await prisma.questionAttempt.findUnique({ where: { id: attemptId } }
    );
    expect(persistedAttempt).toBeTruthy();

    // Mastery applied against the authoritative PRIMARY MicroSkill.
    const mastery = await prisma.skillMastery.findUnique({
      where: { studentId_skillId: { studentId: student.studentProfileId, skillId: microSkill.id } },
    });
    expect(mastery).toBeTruthy();
    expect(mastery!.masteryLevel).toBeGreaterThan(0);

    // No incorrect ErrorAnalysis exists for a correct attempt.
    const correctAnalysis = await prisma.errorAnalysis.findUnique({
      where: { attemptId },
    });
    expect(correctAnalysis).toBeNull();
  });

  it('A2. explanation can be requested safely after a correct answer (attemptId-scoped)', async () => {
    const student = await registerAndLogin(app, 'p5f9e-correct-expl');
    const auth = { Authorization: `Bearer ${student.accessToken}` };
    const { question } = await buildAuthoritativeFixture();
    await giveQuestionToStudent(question.id, student.studentProfileId);

    const attemptRes = await request(app)
      .post('/api/v1/question-attempts')
      .set(auth)
      .send({ questionId: question.id, answer: '4', timeSpentSeconds: 20, sessionId: 'standalone' });
    const attemptId = attemptRes.body.data.attemptId as string;

    const res = await request(app)
      .post('/api/v1/ai/ai/explanation')
      .set(auth)
      .send({ attemptId, mode: 'HINT' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.mode).toBe('HINT');
    // The pedagogical content must not state the canonical answer. The check is
    // scoped to the content fields (a bare digit would otherwise match the ISO
    // timestamp, which is not answer leakage).
    const content = JSON.stringify([
      res.body.data.explanation,
      res.body.data.stepByStep,
      res.body.data.examples,
      res.body.data.keyPoints,
      res.body.data.practiceSuggestion,
    ]);
    expect(content).not.toMatch(/\b4\b/);
    expect(content).not.toMatch(/answer is|cevap/i);
    expect(res.body.data.explanation).toBeTruthy();
    expect(assessAnswerLeakage(res.body.data).safe).toBe(true);
  });

  it('A3. the normalized alias /api/v1/ai/explanation serves the same contract', async () => {
    const student = await registerAndLogin(app, 'p5f9e-alias');
    const auth = { Authorization: `Bearer ${student.accessToken}` };
    const { question } = await buildAuthoritativeFixture();
    await giveQuestionToStudent(question.id, student.studentProfileId);
    const attemptRes = await request(app)
      .post('/api/v1/question-attempts')
      .set(auth)
      .send({ questionId: question.id, answer: '4', timeSpentSeconds: 5, sessionId: 'standalone' });

    const res = await request(app)
      .post('/api/v1/ai/explanation')
      .set(auth)
      .send({ attemptId: attemptRes.body.data.attemptId, mode: 'NEXT_STEP' });
    expect(res.status).toBe(200);
    expect(res.body.data.mode).toBe('NEXT_STEP');
  });

  // ----------------------------------------------------------- Scenario B
  it('B. an incorrect answer runs mastery + error analysis against the authoritative MicroSkill', async () => {
    const student = await registerAndLogin(app, 'p5f9e-incorrect');
    const auth = { Authorization: `Bearer ${student.accessToken}` };
    const { question, microSkill, errorPattern } = await buildAuthoritativeFixture({ withPattern: true });
    await giveQuestionToStudent(question.id, student.studentProfileId);

    const attemptRes = await request(app)
      .post('/api/v1/question-attempts')
      .set(auth)
      .send({ questionId: question.id, answer: 'x = 3', timeSpentSeconds: 45, sessionId: 'standalone' });

    expect(attemptRes.status).toBe(201);
    expect(attemptRes.body.data.isCorrect).toBe(false);
    const attemptId = attemptRes.body.data.attemptId as string;

    // Mastery still applies (an incorrect attempt is a learning signal).
    const mastery = await prisma.skillMastery.findUnique({
      where: { studentId_skillId: { studentId: student.studentProfileId, skillId: microSkill.id } },
    });
    expect(mastery).toBeTruthy();

    // The error analysis is persisted and resolves to the compatible existing pattern.
    const analysis = await prisma.errorAnalysis.findUnique({ where: { attemptId }, include: { errorPattern: true } });
    expect(analysis).toBeTruthy();
    expect(analysis!.studentId).toBe(student.studentProfileId);

    // Explanation accepts and uses the authoritative context. MISTAKE_GUIDANCE is
    // honoured only because a persisted diagnosis exists.
    const res = await request(app)
      .post('/api/v1/ai/ai/explanation')
      .set(auth)
      .send({ attemptId, mode: 'MISTAKE_GUIDANCE' });

    expect(res.status).toBe(200);
    expect(res.body.data.mode).toBe('MISTAKE_GUIDANCE');
    // No AI-created taxonomy: the AI never proposes a database ErrorPattern id.
    expect(JSON.stringify(res.body)).not.toMatch(/P5F9E-EP-/);
    expect(errorPattern).toBeTruthy();
  });

  it('B2. MISTAKE_GUIDANCE degrades to HINT when no persisted diagnosis exists', async () => {
    const student = await registerAndLogin(app, 'p5f9e-degrade');
    const auth = { Authorization: `Bearer ${student.accessToken}` };
    // No ErrorPattern fixture => resolver cannot find a compatible pattern.
    const { question } = await buildAuthoritativeFixture();
    await giveQuestionToStudent(question.id, student.studentProfileId);

    const attemptRes = await request(app)
      .post('/api/v1/question-attempts')
      .set(auth)
      .send({ questionId: question.id, answer: 'x = 3', timeSpentSeconds: 45, sessionId: 'standalone' });

    const attemptId = attemptRes.body.data.attemptId as string;
    // A forced ErrorPattern removal keeps this deterministic regardless of the
    // mock classifier's confidence: no diagnosis => no MISTAKE_GUIDANCE.
    const analysis = await prisma.errorAnalysis.findUnique({ where: { attemptId } });
    if (analysis) {
      await prisma.errorAnalysis.delete({ where: { attemptId } });
    }

    const res = await request(app)
      .post('/api/v1/ai/ai/explanation')
      .set(auth)
      .send({ attemptId, mode: 'MISTAKE_GUIDANCE' });

    expect(res.status).toBe(200);
    // Graceful degradation, never a fabricated classification.
    expect(res.body.data.mode).toBe('HINT');
    expect(JSON.stringify(res.body)).not.toMatch(/errorType/i);
  });

  it('B3. the client cannot inject a MicroSkill or error classification with the attempt', async () => {
    const student = await registerAndLogin(app, 'p5f9e-inject-ctx');
    const auth = { Authorization: `Bearer ${student.accessToken}` };
    const { question } = await buildAuthoritativeFixture();
    await giveQuestionToStudent(question.id, student.studentProfileId);
    const attemptRes = await request(app)
      .post('/api/v1/question-attempts')
      .set(auth)
      .send({ questionId: question.id, answer: 'x = 3', timeSpentSeconds: 5, sessionId: 'standalone' });

    const res = await request(app)
      .post('/api/v1/ai/ai/explanation')
      .set(auth)
      .send({
        attemptId: attemptRes.body.data.attemptId,
        mode: 'HINT',
        // Hostile context injection: all of this must be ignored.
        concept: 'HACKED_CONCEPT',
        question: SECRET_QUESTION,
        studentAnswer: SECRET_STUDENT_ANSWER,
        skillId: 'HACKED_SKILL',
        skillName: 'HACKED_SKILL_NAME',
        errorType: 'HACKED_ERROR',
        correctAnswer: CANONICAL_ANSWER,
      });

    expect(res.status).toBe(200);
    const body = JSON.stringify(res.body);
    expect(body).not.toContain('HACKED_CONCEPT');
    expect(body).not.toContain('HACKED_SKILL');
    expect(body).not.toContain('HACKED_ERROR');
    expect(body).not.toContain(CANONICAL_ANSWER);
    expect(body).not.toContain(SECRET_QUESTION);
  });

  // ----------------------------------------------------------- Scenario E
  it('E. cross-student explanation request is rejected (server-side, not UI-side)', async () => {
    const alice = await registerAndLogin(app, 'p5f9e-alice');
    const bob = await registerAndLogin(app, 'p5f9e-bob');
    const { question } = await buildAuthoritativeFixture();

    // Bob owns the question instance and makes the attempt.
    await giveQuestionToStudent(question.id, bob.studentProfileId);
    const bobAttempt = await request(app)
      .post('/api/v1/question-attempts')
      .set('Authorization', `Bearer ${bob.accessToken}`)
      .send({ questionId: question.id, answer: '4', timeSpentSeconds: 5, sessionId: 'standalone' });
    const bobAttemptId = bobAttempt.body.data.attemptId as string;

    // Alice tries to read Bob's guidance.
    const res = await request(app)
      .post('/api/v1/ai/ai/explanation')
      .set('Authorization', `Bearer ${alice.accessToken}`)
      .send({ attemptId: bobAttemptId, mode: 'HINT' });

    expect([403, 404]).toContain(res.status);
    expect(res.body.success).toBe(false);

    // A client-supplied studentId must not grant access either.
    const spoof = await request(app)
      .post('/api/v1/ai/ai/explanation')
      .set('Authorization', `Bearer ${alice.accessToken}`)
      .send({ attemptId: bobAttemptId, studentId: bob.studentProfileId, mode: 'HINT' });
    expect([403, 404]).toContain(spoof.status);
  });

  it('E2. reading another student\'s attempt over HTTP is likewise rejected', async () => {
    const alice = await registerAndLogin(app, 'p5f9e-alice2');
    const bob = await registerAndLogin(app, 'p5f9e-bob2');
    const { question } = await buildAuthoritativeFixture();
    await giveQuestionToStudent(question.id, bob.studentProfileId);
    const bobAttempt = await request(app)
      .post('/api/v1/question-attempts')
      .set('Authorization', `Bearer ${bob.accessToken}`)
      .send({ questionId: question.id, answer: '4', timeSpentSeconds: 5, sessionId: 'standalone' });

    const res = await request(app)
      .get(`/api/v1/question-attempts/${bobAttempt.body.data.attemptId}`)
      .set('Authorization', `Bearer ${alice.accessToken}`);
    expect(res.status).toBe(403);
  });

  // ----------------------------------------------------------- Scenario F
  it('F. the explanation endpoint rejects a missing or invalid token', async () => {
    const noToken = await request(app)
      .post('/api/v1/ai/ai/explanation')
      .send({ concept: 'x', skillId: 's', difficulty: 1 });
    expect(noToken.status).toBe(401);

    const badToken = await request(app)
      .post('/api/v1/ai/ai/explanation')
      .set('Authorization', 'Bearer not-a-real-token')
      .send({ concept: 'x', skillId: 's', difficulty: 1 });
    expect(badToken.status).toBe(401);
  });

  // ----------------------------------------------------------- Scenario G
  it('G. an unsupported mode (FULL_SOLUTION) is rejected by the route schema', async () => {
    const student = await registerAndLogin(app, 'p5f9e-mode');
    const res = await request(app)
      .post('/api/v1/ai/ai/explanation')
      .set('Authorization', `Bearer ${student.accessToken}`)
      .send({ concept: 'x', skillId: 's', difficulty: 1, mode: 'FULL_SOLUTION' });
    expect(res.status).toBe(400);
  });

  it('G2. every supported mode is accepted and echoed back', async () => {
    const student = await registerAndLogin(app, 'p5f9e-modes');
    const auth = { Authorization: `Bearer ${student.accessToken}` };
    const { question } = await buildAuthoritativeFixture({ withPattern: true });
    await giveQuestionToStudent(question.id, student.studentProfileId);
    const attemptRes = await request(app)
      .post('/api/v1/question-attempts')
      .set(auth)
      .send({ questionId: question.id, answer: 'x = 3', timeSpentSeconds: 5, sessionId: 'standalone' });
    const attemptId = attemptRes.body.data.attemptId as string;

    for (const mode of ['HINT', 'SOCRATIC', 'FORMULA_REMINDER', 'MISTAKE_GUIDANCE', 'NEXT_STEP'] as const) {
      const res = await request(app).post('/api/v1/ai/ai/explanation').set(auth).send({ attemptId, mode });
      expect(res.status).toBe(200);
      expect(res.body.data.mode).toBe(mode);
    }
  });

  // ----------------------------------------------------------- Scenario H
  it('H. a deliberately injected correctAnswer is rejected/ignored and never reaches the provider', async () => {
    const student = await registerAndLogin(app, 'p5f9e-inject-answer');
    const auth = { Authorization: `Bearer ${student.accessToken}` };
    const { question } = await buildAuthoritativeFixture();
    await giveQuestionToStudent(question.id, student.studentProfileId);
    const attemptRes = await request(app)
      .post('/api/v1/question-attempts')
      .set(auth)
      .send({ questionId: question.id, answer: '4', timeSpentSeconds: 5, sessionId: 'standalone' });

    const res = await request(app)
      .post('/api/v1/ai/ai/explanation')
      .set(auth)
      .send({ attemptId: attemptRes.body.data.attemptId, mode: 'HINT', correctAnswer: CANONICAL_ANSWER });

    expect(res.status).toBe(200);
    const body = JSON.stringify(res.body);
    expect(body).not.toContain(CANONICAL_ANSWER);
    expect(body).not.toMatch(/correctAnswer/);
  });
});

// ==================================================== NON-MUTATION (STEP 7)

describe('Phase 5F.9-E — Step 7: non-mutation guarantee', () => {
  let app: express.Application;

  beforeAll(async () => {
    app = await bootstrap();
  });

  beforeEach(async () => {
    await prisma.masteryAudit.deleteMany({});
    await prisma.skillMastery.deleteMany({});
    await prisma.learningProgress.deleteMany({});
    await prisma.errorAnalysis.deleteMany({});
    await prisma.errorPatternMicroSkill.deleteMany({});
    await prisma.errorPattern.deleteMany({});
    await prisma.questionAttempt.deleteMany({});
    await prisma.questionSkillMapping.deleteMany({});
    await prisma.questionInstance.deleteMany({});
    await prisma.question.deleteMany({});
    await prisma.microSkill.deleteMany({});
    await prisma.processComponent.deleteMany({});
    await prisma.learningOutcome.deleteMany({});
    await prisma.theme.deleteMany({});
    await prisma.curriculumVersion.deleteMany({});
    await prisma.idempotencyRecord.deleteMany({});
    await prisma.studentProfile.deleteMany({});
    await prisma.user.deleteMany({});
    await prisma.auditLog.deleteMany({});
  });

  async function snapshot() {
    const [attempts, mastery, progress, analyses, patterns, mappings, microSkills] = await Promise.all([
      prisma.questionAttempt.findMany({ orderBy: { id: 'asc' } }),
      prisma.skillMastery.findMany({ orderBy: { id: 'asc' } }),
      prisma.learningProgress.findMany({ orderBy: { id: 'asc' } }),
      prisma.errorAnalysis.findMany({ orderBy: { id: 'asc' } }),
      prisma.errorPattern.findMany({ orderBy: { id: 'asc' } }),
      prisma.questionSkillMapping.findMany({ orderBy: { id: 'asc' } }),
      prisma.microSkill.findMany({ orderBy: { id: 'asc' } }),
    ]);
    return {
      attempts: JSON.stringify(attempts),
      mastery: JSON.stringify(mastery),
      progress: JSON.stringify(progress),
      analyses: JSON.stringify(analyses),
      patterns: JSON.stringify(patterns),
      mappings: JSON.stringify(mappings),
      microSkills: JSON.stringify(microSkills),
    };
  }

  it('M1. explanation generation cannot mutate any authoritative learning state (HTTP)', async () => {
    const student = await registerAndLogin(app, 'p5f9e-nonmutation');
    const auth = { Authorization: `Bearer ${student.accessToken}` };
    const { question } = await buildAuthoritativeFixture({ withPattern: true });
    await giveQuestionToStudent(question.id, student.studentProfileId);

    const attemptRes = await request(app)
      .post('/api/v1/question-attempts')
      .set(auth)
      .send({ questionId: question.id, answer: 'x = 3', timeSpentSeconds: 5, sessionId: 'standalone' });
    const attemptId = attemptRes.body.data.attemptId as string;

    const before = await snapshot();

    for (const mode of ['HINT', 'SOCRATIC', 'FORMULA_REMINDER', 'MISTAKE_GUIDANCE', 'NEXT_STEP'] as const) {
      const res = await request(app).post('/api/v1/ai/ai/explanation').set(auth).send({ attemptId, mode });
      expect(res.status).toBe(200);
    }

    const after = await snapshot();
    expect(after).toEqual(before);
  });

  it('M2. the unscoped explanation path also leaves authoritative state untouched', async () => {
    const student = await registerAndLogin(app, 'p5f9e-nonmutation2');
    const auth = { Authorization: `Bearer ${student.accessToken}` };
    await buildAuthoritativeFixture();

    const before = await snapshot();
    const res = await request(app)
      .post('/api/v1/ai/ai/explanation')
      .set(auth)
      .send({ concept: 'Doğrusal denklem', skillId: 'ms-1', difficulty: 2, mode: 'HINT', question: '2x + 3 = 11' });
    expect(res.status).toBe(200);

    const after = await snapshot();
    expect(after).toEqual(before);
  });
});

// ==================================================== AUTHORIZATION AUDIT (STEP 3)

describe('Phase 5F.9-E — Step 3: AI endpoint authorization audit', () => {
  let app: express.Application;

  beforeAll(async () => {
    app = await bootstrap();
  });

  it('S1. /ai/analyze-error requires authentication', async () => {
    const res = await request(app).post('/api/v1/ai/ai/analyze-error').send({
      question: 'q', studentAnswer: 'a', correctAnswer: CANONICAL_ANSWER, skillId: 's', difficulty: 1, timeSpentSeconds: 1,
    });
    expect(res.status).toBe(401);
  });

  it('S2. /ai/recommendation requires authentication', async () => {
    const res = await request(app).post('/api/v1/ai/ai/recommendation').send({ studentId: 'other' });
    expect(res.status).toBe(401);
  });

  it('S3. the recommendation read endpoint derives identity server-side (no studentId accepted)', async () => {
    const student = await registerAndLogin(app, 'p5f9e-rec');
    // A hostile client cannot read another student's recommendation state: the
    // identifier is not a request parameter in the first place.
    const res = await request(app)
      .get('/api/v1/recommendations/next?studentId=someone-else')
      .set('Authorization', `Bearer ${student.accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toBeTruthy();
  });
});

// ==================================================== PROVIDER BOUNDARY (STEP 10)

describe('Phase 5F.9-E — Step 10: real provider boundary', () => {
  it('R1. EXPLANATION_PROVIDER defaults to mock (safe default)', () => {
    // getExplanationConfig reads the mocked test environment which does not set
    // EXPLANATION_PROVIDER, so the schema default applies.
    const config = getExplanationConfig();
    expect(config.provider).toBe('mock');
    expect(config.allowExternalProvider).toBe(false);
  });

  it('R2. OpenAI provider requires explicit external-provider enablement', () => {
    expect(() =>
      createExplanationProviderFromConfig(makeConfig({ provider: 'openai', allowExternalProvider: false }))
    ).toThrow(AiAnalysisError);
  });

  it('R3. the API key is environment-only and never appears in a log', async () => {
    const { logger } = await import('../../src/infrastructure/logging/logger.js');
    const infoSpy = vi.mocked(logger.info);
    const errorSpy = vi.mocked(logger.error);
    const warnSpy = vi.mocked(logger.warn);
    infoSpy.mockClear();
    errorSpy.mockClear();
    warnSpy.mockClear();

    const fetchImpl = vi.fn(async () => jsonResponse('nope', 500));
    const provider = new RealExplanationProvider(makeConfig({ maxRetries: 1 }), {
      fetchImpl,
      sleepImpl: vi.fn(async () => {}),
    });
    await provider.generateGuidance({ mode: 'HINT', question: SECRET_QUESTION }).catch(() => undefined);

    const all = JSON.stringify([...infoSpy.mock.calls, ...errorSpy.mock.calls, ...warnSpy.mock.calls]);
    expect(all).not.toContain(API_KEY);
    expect(all).not.toContain('Bearer');
  });

  it('R4. retries are bounded and only applied to transient failures', async () => {
    let call = 0;
    const fetchImpl = vi.fn(async () => {
      call++;
      return jsonResponse('unavailable', 503);
    });
    const provider = new RealExplanationProvider(makeConfig({ maxRetries: 2 }), {
      fetchImpl,
      sleepImpl: vi.fn(async () => {}),
    });
    await expect(provider.generateGuidance({ mode: 'HINT', question: 'q' })).rejects.toBeInstanceOf(AiAnalysisError);
    expect(fetchImpl).toHaveBeenCalledTimes(3); // initial + 2 bounded retries
  });

  it('R5. a configured real provider is never silently replaced by mock', () => {
    expect(() =>
      createExplanationProviderFromConfig(makeConfig({ provider: 'unsupported' as any }))
    ).toThrow(AiAnalysisError);
    // The mock provider is only produced when mock is genuinely configured.
    expect(createExplanationProviderFromConfig(makeConfig({ provider: 'mock' }))).toBeInstanceOf(MockAIProvider);
  });
});

// ==================================================== OBSERVABILITY / PRIVACY (STEP 11)

describe('Phase 5F.9-E — Step 11: observability / privacy', () => {
  it('O1. no log contains question text, answer, correctAnswer, prompt, model response, student id or API key', async () => {
    const { logger } = await import('../../src/infrastructure/logging/logger.js');
    const spies = [vi.mocked(logger.info), vi.mocked(logger.error), vi.mocked(logger.warn), vi.mocked(logger.debug)];
    spies.forEach((s) => s.mockClear());

    const SERVICE_REQUEST = {
      concept: 'c', skillId: 'ms-secret-id', difficulty: 1, previousAttempts: 0, level: 'intermediate' as const,
      mode: 'HINT', question: SECRET_QUESTION, studentAnswer: SECRET_STUDENT_ANSWER,
      skillName: 'SECRET_SKILL_NAME', errorHypothesis: 'SECRET_HYPOTHESIS',
    };

    await new AIExplanationService(new StubProvider([safePayload()])).generateExplanation(SERVICE_REQUEST);
    await new AIExplanationService(new StubProvider([leakyPayload(), leakyPayload()])).generateExplanation(SERVICE_REQUEST);
    await new AIExplanationService(new StubProvider([new Error('down')])).generateExplanation(SERVICE_REQUEST);
    await new RealExplanationProvider(makeConfig(), {
      fetchImpl: vi.fn(async () => jsonResponse(envelope(JSON.stringify(safePayload())))),
      sleepImpl: vi.fn(async () => {}),
    })
      .generateGuidance({ mode: 'HINT', question: SECRET_QUESTION, studentAnswer: SECRET_STUDENT_ANSWER })
      .catch(() => undefined);

    const all = JSON.stringify(spies.flatMap((s) => s.mock.calls));
    expect(all).not.toContain(SECRET_QUESTION);
    expect(all).not.toContain(SECRET_STUDENT_ANSWER);
    expect(all).not.toContain(CANONICAL_ANSWER);
    expect(all).not.toContain('SECRET_SKILL_NAME');
    expect(all).not.toContain('SECRET_HYPOTHESIS');
    expect(all).not.toContain(API_KEY);
    expect(all).not.toContain('Bearer');
  });
});
