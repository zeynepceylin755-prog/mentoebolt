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
import {
  assessAnswerLeakage,
  type ExplanationMode,
} from '../../src/domain/ai/explanationPolicy.js';
import type { ExplanationConfig } from '../../src/infrastructure/ai/explanation/config/ExplanationConfig.js';
import type { IAIProvider, AIRequest, AIResponse } from '../../src/domain/interfaces/ai/IAIProvider.js';

/**
 * Phase 6.4 — Safe Explanation & Guidance Integration.
 *
 * Proves the existing, already-built safe explanation infrastructure is connected
 * to the REAL student learning flow, and that:
 *
 *   - the client sends only `{ attemptId, mode }`; every piece of learning context
 *     (student, question, submitted answer, correctness, MicroSkill, ErrorAnalysis)
 *     is derived server-side from the authenticated attempt;
 *   - the canonical answer NEVER reaches the provider (prompt, transport, response);
 *   - every safe mode is supported and none of them leaks an answer;
 *   - leakage is rejected → ONE bounded regeneration → deterministic fallback;
 *   - provider timeout / malformed output / failure never fabricate an explanation;
 *   - an absent ErrorAnalysis is never replaced by an invented taxonomy;
 *   - a correct attempt is never described as an error;
 *   - guidance generation mutates NO authoritative learning state.
 *
 * All data is created inside this suite against the isolated test database
 * (prisma/test.db, forced by tests/setup.ts). No dev.db mutation, no dependency on
 * the 159 placeholder questions, no real network call.
 */

const CANONICAL_ANSWER = 'x = 4242';
const SECRET_QUESTION = 'SECRET_P64_QUESTION_TEXT';
const SECRET_STUDENT_ANSWER = 'SECRET_P64_STUDENT_ANSWER';

// --------------------------------------------------------------------- helpers

function makeConfig(overrides: Partial<ExplanationConfig> = {}): ExplanationConfig {
  return {
    provider: 'openai',
    model: 'gpt-4o',
    timeoutMs: 5000,
    maxRetries: 2,
    allowExternalProvider: true,
    baseUrl: 'https://api.example.test/v1',
    apiKey: 'sk-test-p64',
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

/** Deterministic IAIProvider: records every request, replays a scripted output list. */
class StubProvider implements IAIProvider {
  calls: AIRequest[] = [];
  constructor(private readonly outputs: unknown[]) { }
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

/**
 * Build a self-contained curriculum chain + MicroSkill + an optional compatible
 * ErrorPattern, a canonical Question with a PRIMARY QuestionSkillMapping, and give
 * it to the student via a QuestionInstance.
 */
async function buildFixture(
  studentProfileId: string,
  options: { withPattern?: boolean; correctAnswer?: string; isActiveSkill?: boolean } = {}
) {
  const uid = Math.random().toString(36).slice(2, 10);
  const version = await prisma.curriculumVersion.create({
    data: { code: `P64-CUR-${uid}`, name: 'P64', grade: 11, subject: 'Matematik', version: '1.0', source: 'TEST_FIXTURE' },
  });
  const theme = await prisma.theme.create({
    data: { curriculumVersionId: version.id, officialCode: `P64.T-${uid}`, name: 'T', lessonHours: 1, sourceOrder: 1 },
  });
  const lo = await prisma.learningOutcome.create({
    data: { themeId: theme.id, officialCode: `P64.LO-${uid}`, officialText: 'T', sourceOrder: 1 },
  });
  const pc = await prisma.processComponent.create({
    data: { learningOutcomeId: lo.id, officialCode: `P64.PC-${uid}`, officialText: 'T', sourceOrder: 1 },
  });
  const microSkill = await prisma.microSkill.create({
    data: {
      processComponentId: pc.id,
      code: `P64.MS-${uid}`,
      name: `P64 Skill ${uid}`,
      description: 'Phase 6.4 fixture skill',
      source: 'TEST_FIXTURE',
      isActive: options.isActiveSkill ?? true,
    },
  });

  let errorPattern = null;
  if (options.withPattern) {
    errorPattern = await prisma.errorPattern.create({
      data: {
        code: `P64-EP-${uid}`,
        name: 'Conceptual Misunderstanding',
        description: 'Synthetic Phase 6.4 fixture pattern',
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
      skillId: microSkill.id,
      correctAnswer: options.correctAnswer ?? '4',
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

  // The student owns a QuestionInstance for this question.
  await prisma.questionInstance.create({ data: { questionId: question.id, studentId: studentProfileId } });

  return { microSkill, errorPattern, question };
}

async function submitAnswer(
  app: express.Application,
  token: string,
  questionId: string,
  answer: string
) {
  const res = await request(app)
    .post('/api/v1/question-attempts')
    .set('Authorization', `Bearer ${token}`)
    .send({ questionId, answer, timeSpentSeconds: 20, sessionId: 'standalone' });
  return res;
}

function contentFields(body: any): string {
  const data = body?.data ?? body;
  return JSON.stringify([
    data.explanation,
    data.stepByStep,
    data.examples,
    data.keyPoints,
    data.practiceSuggestion,
  ]);
}

// ======================================================== SERVICE-LEVEL (modes)

describe('Phase 6.4 — Explanation modes produce safe guidance', () => {
  const serviceRequest = {
    concept: 'Doğrusal denklem çözme',
    question: '2x + 3 = 11 denklemini çözünüz.',
    studentAnswer: 'x = 3',
    skillId: 'ms-1',
    difficulty: 2,
    previousAttempts: 0,
    level: 'intermediate' as const,
  };

  it('T8. HINT mode returns provider guidance (clear, non-fallback)', async () => {
    const stub = new StubProvider([safePayload()]);
    const result = await new AIExplanationService(stub).generateExplanation({ ...serviceRequest, mode: 'HINT' });
    expect(result.mode).toBe('HINT');
    expect(result.metadata.source).toBe('provider');
    expect(result.metadata.safety).toBe('clear');
    expect(assessAnswerLeakage(result).safe).toBe(true);
  });

  it('T9. SOCRATIC mode returns a guiding question, not a solution', async () => {
    const stub = new StubProvider([
      safePayload({ explanation: 'Kendine sor: Verilen koşullardan hangisi gerekli kuralı işaret ediyor?' }),
    ]);
    const result = await new AIExplanationService(stub).generateExplanation({ ...serviceRequest, mode: 'SOCRATIC' });
    expect(result.mode).toBe('SOCRATIC');
    expect(result.explanation).toContain('?');
    expect(assessAnswerLeakage(result).safe).toBe(true);
  });

  it('T10. FORMULA_REMINDER mode reminds the rule without applying it to a result', async () => {
    const stub = new StubProvider([
      safePayload({ explanation: 'İlgili kuralı hatırla: iki tarafa da aynı işlemi uygulamalısın.' }),
    ]);
    const result = await new AIExplanationService(stub).generateExplanation({
      ...serviceRequest,
      mode: 'FORMULA_REMINDER',
    });
    expect(result.mode).toBe('FORMULA_REMINDER');
    expect(assessAnswerLeakage(result).safe).toBe(true);
  });

  it('T11. MISTAKE_GUIDANCE mode uses the authoritative ErrorAnalysis signal (never invents one)', async () => {
    const stub = new StubProvider([safePayload()]);
    await new AIExplanationService(stub).generateExplanation({
      ...serviceRequest,
      mode: 'MISTAKE_GUIDANCE',
      errorType: 'CONCEPTUAL_MISUNDERSTANDING',
      errorHypothesis: 'İşlem sırası karıştırılıyor.',
    });
    const prompt = stub.calls[0].messages.map((m) => m.content).join('\n');
    expect(prompt).toContain('MISTAKE_GUIDANCE');
    expect(prompt).toContain('CONCEPTUAL_MISUNDERSTANDING');
    // The prompt must not ask the model to classify the error itself.
    expect(prompt).toMatch(/Previously diagnosed/i);
  });

  it('T12. NEXT_STEP mode points forward without completing the problem', async () => {
    const stub = new StubProvider([
      safePayload({ explanation: 'Sıradaki adımda bilinmeyeni yalnız bırakmayı dene, sonucu hesaplama.' }),
    ]);
    const result = await new AIExplanationService(stub).generateExplanation({ ...serviceRequest, mode: 'NEXT_STEP' });
    expect(result.mode).toBe('NEXT_STEP');
    expect(assessAnswerLeakage(result).safe).toBe(true);
  });

  it('T12b. the correct-attempt signal is forwarded as a BOOLEAN and never as an answer', async () => {
    const stub = new StubProvider([safePayload()]);
    await new AIExplanationService(stub).generateExplanation({
      ...serviceRequest,
      mode: 'NEXT_STEP',
      studentAnsweredCorrectly: true,
    });
    const prompt = stub.calls[0].messages.map((m) => m.content).join('\n');
    expect(prompt).toContain('CORRECT');
    expect(prompt).not.toContain(CANONICAL_ANSWER);
  });
});

// ======================================================== SERVICE-LEVEL (safety)

describe('Phase 6.4 — Leakage protection & failure behaviour', () => {
  const serviceRequest = {
    concept: 'Doğrusal denklem çözme',
    question: '2x + 3 = 11 denklemini çözünüz.',
    studentAnswer: 'x = 3',
    skillId: 'ms-1',
    difficulty: 2,
    previousAttempts: 0,
    level: 'intermediate' as const,
  };

  it('T13. leaked output is rejected and never returned', async () => {
    const result = await new AIExplanationService(new StubProvider([leakyPayload()]))
      .generateExplanation({ ...serviceRequest, mode: 'HINT' });
    expect(result.metadata.source).toBe('fallback');
    expect(JSON.stringify(result)).not.toMatch(/answer is/i);
    expect(result.explanation).not.toContain('4242');
  });

  it('T14. an unsafe regeneration falls back safely (exactly one regeneration)', async () => {
    const stub = new StubProvider([leakyPayload(), leakyPayload()]);
    const result = await new AIExplanationService(stub).generateExplanation({ ...serviceRequest, mode: 'HINT' });
    expect(stub.calls).toHaveLength(2);
    expect(result.metadata.source).toBe('fallback');
    expect(result.metadata.model).toBe('safe-fallback');
    expect(assessAnswerLeakage(result).safe).toBe(true);
  });

  it('T14b. an unsafe first response that regenerates safely is accepted', async () => {
    const stub = new StubProvider([leakyPayload(), safePayload()]);
    const result = await new AIExplanationService(stub).generateExplanation({ ...serviceRequest, mode: 'HINT' });
    expect(stub.calls).toHaveLength(2);
    expect(result.metadata.source).toBe('provider');
    expect(result.metadata.safety).toBe('regenerated');
  });

  it('T15. a provider failure does not fabricate an explanation', async () => {
    const result = await new AIExplanationService(new StubProvider([new Error('provider down')]))
      .generateExplanation({ ...serviceRequest, mode: 'HINT' });
    expect(result.metadata.source).toBe('fallback');
    expect(result.metadata.model).toBe('safe-fallback');
    expect(result.metadata.tokensUsed).toBe(0);
    expect(assessAnswerLeakage(result).safe).toBe(true);
  });

  it('T15b. malformed provider output (missing explanation) is rejected safely', async () => {
    const result = await new AIExplanationService(new StubProvider([{ stepByStep: [] }]))
      .generateExplanation({ ...serviceRequest, mode: 'HINT' });
    expect(result.metadata.source).toBe('fallback');
  });

  it('T15c. a provider timeout surfaces as an answer-free fallback (no fabricated AI text)', async () => {
    // Simulate the transport aborting on timeout.
    const fetchImpl = vi.fn(async () => {
      const err: any = new Error('aborted');
      err.name = 'AbortError';
      throw err;
    });
    const provider = new RealExplanationProvider(makeConfig({ maxRetries: 0 }), {
      fetchImpl,
      sleepImpl: vi.fn(async () => { }),
    });
    const result = await new AIExplanationService(provider).generateExplanation({
      ...serviceRequest,
      mode: 'HINT',
    });
    expect(result.metadata.source).toBe('fallback');
    expect(result.metadata.model).toBe('safe-fallback');
  });

  it('T15d. malformed JSON from the transport never becomes an explanation', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(envelope('this is not json')));
    const provider = new RealExplanationProvider(makeConfig({ maxRetries: 0 }), {
      fetchImpl,
      sleepImpl: vi.fn(async () => { }),
    });
    const result = await new AIExplanationService(provider).generateExplanation({
      ...serviceRequest,
      mode: 'HINT',
    });
    expect(result.metadata.source).toBe('fallback');
  });

  it('T15e. an unsupported mode is normalised to HINT (no solution mode exists)', async () => {
    const result = await new AIExplanationService(new StubProvider([safePayload()]))
      .generateExplanation({ ...serviceRequest, mode: 'FULL_SOLUTION' });
    expect(result.mode).toBe('HINT');
  });

  it('T6/T7. neither correctAnswer nor any answer field can reach the provider', async () => {
    const stub = new StubProvider([safePayload()]);
    await new AIExplanationService(stub).generateExplanation({
      ...serviceRequest,
      question: SECRET_QUESTION,
      studentAnswer: SECRET_STUDENT_ANSWER,
      correctAnswer: CANONICAL_ANSWER,
    } as any);
    const sent = JSON.stringify(stub.calls[0].messages);
    expect(sent).toContain(SECRET_QUESTION); // question text is legitimate context
    expect(sent).toContain(SECRET_STUDENT_ANSWER); // own answer is evidence, not a key
    expect(sent).not.toContain(CANONICAL_ANSWER);
    expect(sent).not.toMatch(/correct\s*answer/i);
  });

  it('buildPrompt has no parameter that could carry the canonical answer', () => {
    const prompt = buildPrompt({ mode: 'HINT', question: 'q', studentAnswer: 'a' });
    expect(prompt).not.toContain(CANONICAL_ANSWER);
    expect(prompt).not.toMatch(/correct\s*answer\s*:/i);
    expect(prompt).toContain('NOT an answer key');
  });
});

// ======================================================== HTTP: AUTH / OWNERSHIP

describe('Phase 6.4 — HTTP security & ownership', () => {
  let app: express.Application;

  beforeAll(async () => {
    app = await bootstrap();
  });

  it('T1. an authenticated student can request guidance for their own attempt', async () => {
    const student = await registerAndLogin(app, 'p64-own');
    const auth = { Authorization: `Bearer ${student.accessToken}` };
    const { question } = await buildFixture(student.studentProfileId);
    const attemptRes = await submitAnswer(app, student.accessToken, question.id, '4');
    const attemptId = attemptRes.body.data.attemptId as string;

    const res = await request(app).post('/api/v1/ai/ai/explanation').set(auth).send({ attemptId, mode: 'HINT' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.mode).toBe('HINT');
    expect(res.body.data.explanation).toBeTruthy();
    expect(assessAnswerLeakage(res.body.data).safe).toBe(true);
  });

  it('T2. an unauthenticated request is rejected', async () => {
    const res = await request(app).post('/api/v1/ai/ai/explanation').send({ attemptId: 'anything', mode: 'HINT' });
    expect(res.status).toBe(401);
  });

  it('T2b. an invalid token is rejected', async () => {
    const res = await request(app)
      .post('/api/v1/ai/ai/explanation')
      .set('Authorization', 'Bearer not-a-real-token')
      .send({ attemptId: 'anything', mode: 'HINT' });
    expect(res.status).toBe(401);
  });

  it('T3. a cross-student attempt is rejected (403/404)', async () => {
    const alice = await registerAndLogin(app, 'p64-alice');
    const bob = await registerAndLogin(app, 'p64-bob');
    const { question } = await buildFixture(bob.studentProfileId);
    const bobAttempt = await submitAnswer(app, bob.accessToken, question.id, '4');
    const bobAttemptId = bobAttempt.body.data.attemptId as string;

    const res = await request(app)
      .post('/api/v1/ai/ai/explanation')
      .set('Authorization', `Bearer ${alice.accessToken}`)
      .send({ attemptId: bobAttemptId, mode: 'HINT' });
    expect([403, 404]).toContain(res.status);
    expect(res.body.success).toBe(false);
  });

  it('T4. the client cannot override the student identity', async () => {
    const alice = await registerAndLogin(app, 'p64-alice2');
    const bob = await registerAndLogin(app, 'p64-bob2');
    const { question } = await buildFixture(bob.studentProfileId);
    const bobAttempt = await submitAnswer(app, bob.accessToken, question.id, '4');

    const res = await request(app)
      .post('/api/v1/ai/ai/explanation')
      .set('Authorization', `Bearer ${alice.accessToken}`)
      .send({ attemptId: bobAttempt.body.data.attemptId, studentId: bob.studentProfileId, mode: 'HINT' });
    // A spoofed studentId grants nothing: identity comes from the token only.
    expect([403, 404]).toContain(res.status);
  });

  it('T5. the client cannot override the MicroSkill, question, answer or error type', async () => {
    const student = await registerAndLogin(app, 'p64-inject');
    const auth = { Authorization: `Bearer ${student.accessToken}` };
    const { question } = await buildFixture(student.studentProfileId);
    const attemptRes = await submitAnswer(app, student.accessToken, question.id, 'x = 3');

    const res = await request(app)
      .post('/api/v1/ai/ai/explanation')
      .set(auth)
      .send({
        attemptId: attemptRes.body.data.attemptId,
        mode: 'HINT',
        concept: 'HACKED_CONCEPT',
        question: SECRET_QUESTION,
        studentAnswer: SECRET_STUDENT_ANSWER,
        skillId: 'HACKED_SKILL',
        microSkillId: 'HACKED_MICROSKILL',
        skillName: 'HACKED_SKILL_NAME',
        errorType: 'HACKED_ERROR',
        errorPatternId: 'HACKED_PATTERN',
        correctAnswer: CANONICAL_ANSWER,
      });

    expect(res.status).toBe(200);
    const body = JSON.stringify(res.body);
    for (const injected of [
      'HACKED_CONCEPT',
      'HACKED_SKILL',
      'HACKED_MICROSKILL',
      'HACKED_ERROR',
      'HACKED_PATTERN',
      SECRET_QUESTION,
      SECRET_STUDENT_ANSWER,
      CANONICAL_ANSWER,
    ]) {
      expect(body).not.toContain(injected);
    }
  });

  it('T6d. a client-supplied correctAnswer is ignored end-to-end (never in the response)', async () => {
    const student = await registerAndLogin(app, 'p64-inject-answer');
    const auth = { Authorization: `Bearer ${student.accessToken}` };
    const { question } = await buildFixture(student.studentProfileId, { correctAnswer: CANONICAL_ANSWER });
    const attemptRes = await submitAnswer(app, student.accessToken, question.id, 'x = 3');

    const res = await request(app)
      .post('/api/v1/ai/ai/explanation')
      .set(auth)
      .send({ attemptId: attemptRes.body.data.attemptId, mode: 'HINT', correctAnswer: CANONICAL_ANSWER });
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain(CANONICAL_ANSWER);
    expect(contentFields(res.body)).not.toContain('4242');
  });
});

// ======================================================== HTTP: CORRECT ATTEMPT

describe('Phase 6.4 — Correct attempts', () => {
  let app: express.Application;

  beforeAll(async () => {
    app = await bootstrap();
  });

  it('T19a. a correct attempt can request guidance and it is not described as an error', async () => {
    const student = await registerAndLogin(app, 'p64-correct');
    const auth = { Authorization: `Bearer ${student.accessToken}` };
    const { question } = await buildFixture(student.studentProfileId);
    const attemptRes = await submitAnswer(app, student.accessToken, question.id, '4');
    expect(attemptRes.body.data.isCorrect).toBe(true);
    const attemptId = attemptRes.body.data.attemptId as string;

    const res = await request(app).post('/api/v1/ai/ai/explanation').set(auth).send({ attemptId, mode: 'NEXT_STEP' });
    expect(res.status).toBe(200);
    expect(res.body.data.mode).toBe('NEXT_STEP');
    // No ErrorAnalysis exists for a correct attempt, and none is invented.
    const analysis = await prisma.errorAnalysis.findUnique({ where: { attemptId } });
    expect(analysis).toBeNull();
    // The response contains no AI-authored error taxonomy.
    expect(JSON.stringify(res.body)).not.toMatch(/errorType/i);
  });

  it('T19b. MISTAKE_GUIDANCE on a correct attempt degrades to HINT rather than inventing an error', async () => {
    const student = await registerAndLogin(app, 'p64-correct-mistake');
    const auth = { Authorization: `Bearer ${student.accessToken}` };
    const { question } = await buildFixture(student.studentProfileId);
    const attemptRes = await submitAnswer(app, student.accessToken, question.id, '4');
    expect(attemptRes.body.data.isCorrect).toBe(true);

    const res = await request(app)
      .post('/api/v1/ai/ai/explanation')
      .set(auth)
      .send({ attemptId: attemptRes.body.data.attemptId, mode: 'MISTAKE_GUIDANCE' });
    expect(res.status).toBe(200);
    expect(res.body.data.mode).toBe('HINT');
    expect(JSON.stringify(res.body)).not.toMatch(/errorType/i);
  });
});

// ======================================================== HTTP: ERROR ANALYSIS

describe('Phase 6.4 — Error analysis integration', () => {
  let app: express.Application;

  beforeAll(async () => {
    app = await bootstrap();
  });

  it('T19c. an incorrect attempt WITH an ErrorAnalysis honours MISTAKE_GUIDANCE without exposing taxonomy ids', async () => {
    const student = await registerAndLogin(app, 'p64-incorrect-with');
    const auth = { Authorization: `Bearer ${student.accessToken}` };
    const { question, errorPattern } = await buildFixture(student.studentProfileId, { withPattern: true });
    const attemptRes = await submitAnswer(app, student.accessToken, question.id, 'x = 3');
    expect(attemptRes.body.data.isCorrect).toBe(false);
    const attemptId = attemptRes.body.data.attemptId as string;

    const analysis = await prisma.errorAnalysis.findUnique({ where: { attemptId } });
    expect(analysis).toBeTruthy();

    const res = await request(app)
      .post('/api/v1/ai/ai/explanation')
      .set(auth)
      .send({ attemptId, mode: 'MISTAKE_GUIDANCE' });
    expect(res.status).toBe(200);
    expect(res.body.data.mode).toBe('MISTAKE_GUIDANCE');

    // The raw ErrorPattern code / ids must never be surfaced to the student.
    const body = JSON.stringify(res.body);
    expect(body).not.toMatch(new RegExp(errorPattern!.code));
    expect(body).not.toMatch(/errorPatternId/i);
    expect(body).not.toMatch(/"errorType"/);
  });

  it('T19d. an incorrect attempt WITHOUT an ErrorAnalysis does not fabricate a taxonomy', async () => {
    const student = await registerAndLogin(app, 'p64-incorrect-without');
    const auth = { Authorization: `Bearer ${student.accessToken}` };
    // No compatible ErrorPattern fixture, so the resolver cannot persist a diagnosis.
    const { question } = await buildFixture(student.studentProfileId);
    const attemptRes = await submitAnswer(app, student.accessToken, question.id, 'x = 3');
    const attemptId = attemptRes.body.data.attemptId as string;

    // Guarantee the precondition deterministically.
    const analysis = await prisma.errorAnalysis.findUnique({ where: { attemptId } });
    if (analysis) {
      await prisma.errorAnalysis.delete({ where: { attemptId } });
    }

    const res = await request(app)
      .post('/api/v1/ai/ai/explanation')
      .set(auth)
      .send({ attemptId, mode: 'MISTAKE_GUIDANCE' });
    expect(res.status).toBe(200);
    // Degrades to a neutral HINT instead of asserting a diagnosis.
    expect(res.body.data.mode).toBe('HINT');
    expect(res.body.data.explanation).toBeTruthy();
    expect(JSON.stringify(res.body)).not.toMatch(/errorType/i);
  });

  it('T19e. no ErrorPattern record is created by a guidance request', async () => {
    const student = await registerAndLogin(app, 'p64-no-pattern');
    const auth = { Authorization: `Bearer ${student.accessToken}` };
    const { question } = await buildFixture(student.studentProfileId);
    const attemptRes = await submitAnswer(app, student.accessToken, question.id, 'x = 3');
    const before = await prisma.errorPattern.count();

    await request(app)
      .post('/api/v1/ai/ai/explanation')
      .set(auth)
      .send({ attemptId: attemptRes.body.data.attemptId, mode: 'MISTAKE_GUIDANCE' });

    expect(await prisma.errorPattern.count()).toBe(before);
  });
});

// ======================================================== HTTP: NO MUTATION

describe('Phase 6.4 — Guidance never mutates authoritative learning state', () => {
  let app: express.Application;

  beforeAll(async () => {
    app = await bootstrap();
  });

  async function snapshot() {
    const [attempts, mastery, progress, analyses, patterns, mappings, microSkills, audits] = await Promise.all([
      prisma.questionAttempt.findMany({ orderBy: { id: 'asc' } }),
      prisma.skillMastery.findMany({ orderBy: { id: 'asc' } }),
      prisma.learningProgress.findMany({ orderBy: { id: 'asc' } }),
      prisma.errorAnalysis.findMany({ orderBy: { id: 'asc' } }),
      prisma.errorPattern.findMany({ orderBy: { id: 'asc' } }),
      prisma.questionSkillMapping.findMany({ orderBy: { id: 'asc' } }),
      prisma.microSkill.findMany({ orderBy: { id: 'asc' } }),
      prisma.masteryAudit.findMany({ orderBy: { id: 'asc' } }),
    ]);
    return {
      attempts: JSON.stringify(attempts),
      mastery: JSON.stringify(mastery),
      progress: JSON.stringify(progress),
      analyses: JSON.stringify(analyses),
      patterns: JSON.stringify(patterns),
      mappings: JSON.stringify(mappings),
      microSkills: JSON.stringify(microSkills),
      audits: JSON.stringify(audits),
    };
  }

  it('T20. requesting every guidance mode leaves learning state byte-identical', async () => {
    const student = await registerAndLogin(app, 'p64-nonmutation');
    const auth = { Authorization: `Bearer ${student.accessToken}` };
    const { question } = await buildFixture(student.studentProfileId, { withPattern: true });
    const attemptRes = await submitAnswer(app, student.accessToken, question.id, 'x = 3');
    const attemptId = attemptRes.body.data.attemptId as string;

    const before = await snapshot();

    const modes: ExplanationMode[] = ['HINT', 'SOCRATIC', 'FORMULA_REMINDER', 'MISTAKE_GUIDANCE', 'NEXT_STEP'];
    for (const mode of modes) {
      const res = await request(app).post('/api/v1/ai/ai/explanation').set(auth).send({ attemptId, mode });
      expect(res.status).toBe(200);
    }

    const after = await snapshot();
    expect(after).toEqual(before);
  });
});

// ======================================================== LEAKAGE OVER HTTP

describe('Phase 6.4 — Answer suppression over the real HTTP boundary', () => {
  let app: express.Application;

  beforeAll(async () => {
    app = await bootstrap();
  });

  it('T7b. the canonical answer never appears in any guidance mode response', async () => {
    const student = await registerAndLogin(app, 'p64-suppression');
    const auth = { Authorization: `Bearer ${student.accessToken}` };
    const { question } = await buildFixture(student.studentProfileId, { correctAnswer: CANONICAL_ANSWER });
    const attemptRes = await submitAnswer(app, student.accessToken, question.id, 'x = 3');
    const attemptId = attemptRes.body.data.attemptId as string;

    for (const mode of ['HINT', 'SOCRATIC', 'FORMULA_REMINDER', 'MISTAKE_GUIDANCE', 'NEXT_STEP'] as const) {
      const res = await request(app).post('/api/v1/ai/ai/explanation').set(auth).send({ attemptId, mode });
      expect(res.status).toBe(200);
      expect(contentFields(res.body)).not.toContain(CANONICAL_ANSWER);
      expect(contentFields(res.body)).not.toContain('4242');
      expect(assessAnswerLeakage(res.body.data).safe).toBe(true);
    }
  });

  it('T11b. a hostile injected solution mode is rejected by the route schema', async () => {
    const student = await registerAndLogin(app, 'p64-mode');
    const res = await request(app)
      .post('/api/v1/ai/ai/explanation')
      .set('Authorization', `Bearer ${student.accessToken}`)
      .send({ attemptId: 'x', mode: 'FULL_SOLUTION' });
    expect(res.status).toBe(400);
  });
});
