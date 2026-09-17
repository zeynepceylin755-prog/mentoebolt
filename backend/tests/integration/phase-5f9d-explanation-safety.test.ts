import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import {
  RealExplanationProvider,
  buildPrompt,
  validatePayload,
  parseModelEnvelope,
} from '../../src/infrastructure/ai/explanation/RealExplanationProvider.js';
import { createExplanationProviderFromConfig } from '../../src/infrastructure/ai/explanation/ExplanationProviderFactory.js';
import { MockAIProvider } from '../../src/infrastructure/ai/providers/MockAIProvider.js';
import {
  assessAnswerLeakage,
  buildSafeFallbackHint,
} from '../../src/domain/ai/explanationPolicy.js';
import { AIExplanationService } from '../../src/application/services/ai/AIExplanationService.js';
import { AiAnalysisError } from '../../src/domain/errors/QuestionAnalysisErrors.js';
import type { ExplanationConfig } from '../../src/infrastructure/ai/explanation/config/ExplanationConfig.js';
import type { IAIProvider, AIRequest, AIResponse } from '../../src/domain/interfaces/ai/IAIProvider.js';

/**
 * Phase 5F.9-D — Answer-suppressing explanation / hint / Socratic AI.
 *
 * All transport is injected: NO real external network call is made anywhere.
 */

const API_KEY = 'test-key';
// A distinctive canonical answer so that "not present in the request/logs"
// assertions cannot pass or fail by accident on a single digit.
const CANONICAL_ANSWER = 'x = 4242';

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
  return {
    model: 'gpt-4o',
    created: 1700000,
    choices: [{ message: { content: contentText }, finish_reason: 'stop' }],
  };
}

/** A safe, answer-free guidance payload. */
function safePayload(overrides: Record<string, unknown> = {}) {
  return {
    explanation:
      'Cevabı bulmaya çalışmadan önce sorudaki hangi koşulun doğrudan ilgili kuralı işaret ettiğini belirle.',
    stepByStep: ['İfadeyi hangi işlemin dönüştüreceğini düşün.'],
    examples: [],
    keyPoints: ['Önce gerekli koşulu seç.'],
    practiceSuggestion: 'Benzer bir soruda önce koşulu yaz.',
    ...overrides,
  };
}

/** A leaky payload that states the final answer. */
function leakyPayload(overrides: Record<string, unknown> = {}) {
  return safePayload({
    explanation: 'İlk adımı doğru yaptın. The answer is x = 4242.',
    ...overrides,
  });
}

function buildProvider(fetchImpl: any, config = makeConfig()) {
  return new RealExplanationProvider(config, { fetchImpl, sleepImpl: vi.fn(async () => {}) });
}

const MODEL_INPUT = {
  mode: 'HINT' as const,
  question: '2x + 3 = 11 denklemini çözünüz.',
  studentAnswer: 'x = 3',
  skillName: 'Doğrusal denklem çözme',
  skillDescription: 'Bilinmeyeni yalnız bırak.',
};

/** Deterministic provider for AIExplanationService-level tests. */
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

const SERVICE_REQUEST = {
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

describe('Phase 5F.9-D — Existing contract', () => {
  beforeEach(() => vi.clearAllMocks());

  it('1. a valid explanation response is accepted', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(envelope(JSON.stringify(safePayload()))));
    const provider = buildProvider(fetchImpl);
    const { payload } = await provider.generateGuidance(MODEL_INPUT);
    expect(payload.explanation).toContain('hangi koşulun');
    expect(payload.stepByStep).toHaveLength(1);
  });

  it('2. a valid HINT response is produced through the service', async () => {
    const service = new AIExplanationService(new StubProvider([safePayload()]));
    const result = await service.generateExplanation({ ...SERVICE_REQUEST, mode: 'HINT' });
    expect(result.mode).toBe('HINT');
    expect(result.metadata.source).toBe('provider');
    expect(result.metadata.safety).toBe('clear');
  });

  it('3. a valid SOCRATIC response is produced through the service', async () => {
    const service = new AIExplanationService(new StubProvider([safePayload()]));
    const result = await service.generateExplanation({ ...SERVICE_REQUEST, mode: 'SOCRATIC' });
    expect(result.mode).toBe('SOCRATIC');
    expect(result.metadata.safety).toBe('clear');
  });

  it('4. structured JSON parsing works end to end', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(envelope(JSON.stringify({ explanation: 'İpucu', stepByStep: ['A'], examples: ['B'], keyPoints: ['C'], practiceSuggestion: 'D' })))
    );
    const provider = buildProvider(fetchImpl);
    const { payload } = await provider.generateGuidance(MODEL_INPUT);
    expect(payload).toEqual({
      explanation: 'İpucu',
      stepByStep: ['A'],
      examples: ['B'],
      keyPoints: ['C'],
      practiceSuggestion: 'D',
    });
  });

  it('5. a malformed response is rejected', async () => {
    expect(() => parseModelEnvelope('not json')).toThrow(AiAnalysisError);
    expect(() => parseModelEnvelope(JSON.stringify(envelope('still not json')))).toThrow(AiAnalysisError);
    expect(() => validatePayload({ stepByStep: [] })).toThrow(AiAnalysisError);
    expect(() => validatePayload({ explanation: '   ' })).toThrow(AiAnalysisError);

    const fetchImpl = vi.fn(async () => jsonResponse(envelope(JSON.stringify({ nope: 1 }))));
    await expect(
      buildProvider(fetchImpl).generateGuidance(MODEL_INPUT)
    ).rejects.toBeInstanceOf(AiAnalysisError);
  });
});

describe('Phase 5F.9-D — Answer suppression (the core invariant)', () => {
  it('6. correctAnswer is NOT included in the provider prompt', () => {
    // The model request type has no answer field at all, so a prompt built from it
    // cannot contain one. This asserts the built prompt never carries it.
    // (The SYSTEM prompt legitimately *forbids* stating the answer; what must be
    // absent is the canonical answer itself and any answer-carrying field.)
    const prompt = buildPrompt(MODEL_INPUT);
    expect(prompt).not.toContain(CANONICAL_ANSWER);
    expect(prompt).not.toMatch(/correct\s+answer\s*:/i);
    expect(prompt).not.toContain('Expected (canonical) answer');
    expect(prompt).toContain('evidence only, NOT an answer key');
  });

  it('6b. ExplanationRequest has no correctAnswer field (compile-time + runtime proof)', async () => {
    // Passing correctAnswer must be ignored, not forwarded.
    const stub = new StubProvider([safePayload()]);
    const service = new AIExplanationService(stub);
    await service.generateExplanation({ ...SERVICE_REQUEST, correctAnswer: CANONICAL_ANSWER } as any);
    const sent = JSON.stringify(stub.calls[0].messages);
    expect(sent).not.toContain(CANONICAL_ANSWER);
    expect(sent).not.toMatch(/correct answer/i);
  });

  it('7. the correct answer is not sent over the transport', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(envelope(JSON.stringify(safePayload()))));
    const provider = buildProvider(fetchImpl);
    await provider.generateGuidance(MODEL_INPUT);

    const call = fetchImpl.mock.calls[0] as unknown as [string, { body: string }];
    const body = JSON.stringify(JSON.parse(call[1].body));
    // The canonical answer value never crosses the transport boundary.
    expect(body).not.toContain(CANONICAL_ANSWER);
    expect(body).not.toMatch(/correct\s+answer\s*:/i);
    // The student's own answer IS allowed as evidence.
    expect(body).toContain('x = 3');
  });

  it('8. an explicit "answer is X" output is rejected', () => {
    expect(assessAnswerLeakage({ explanation: 'The answer is 8.' }).safe).toBe(false);
    expect(assessAnswerLeakage({ explanation: 'Doğru cevap 8.' }).safe).toBe(false);
    expect(assessAnswerLeakage({ explanation: 'So the answer would be x = 4.' }).safe).toBe(false);
    expect(assessAnswerLeakage({ explanation: 'The correct answer is 8.' }).safe).toBe(false);
  });

  it('9. an exact final numeric result is rejected', () => {
    const verdict = assessAnswerLeakage({ explanation: 'Sonucu yazalım. Sonuç = 4' });
    expect(verdict.safe).toBe(false);
    expect(verdict.reasons).toContain('RESULT_EQUALS');

    // A numeric computation reduced to a terminal value.
    const terminal = assessAnswerLeakage({ explanation: '2x = 8, yani buradan 8 / 2 = 4.' });
    expect(terminal.safe).toBe(false);
    expect(terminal.reasons).toContain('COMPLETED_COMPUTATION');
  });

  it('10. multiple-choice answer leakage is rejected', () => {
    expect(assessAnswerLeakage({ explanation: 'Correct option is B.' }).safe).toBe(false);
    expect(assessAnswerLeakage({ explanation: 'Doğru seçenek C.' }).safe).toBe(false);
    expect(assessAnswerLeakage({ explanation: 'B şıkkı seni doğru sonuca götür.' }).safe).toBe(false);
  });

  it('11. "not X, but Y" leakage is rejected', () => {
    expect(assessAnswerLeakage({ explanation: 'The answer is not 7; it is 8.' }).safe).toBe(false);
    expect(assessAnswerLeakage({ explanation: "It's not 7, it's 8." }).safe).toBe(false);
  });

  it('11b. a hidden-answer arithmetic chain is rejected', () => {
    const verdict = assessAnswerLeakage({ explanation: 'Try calculating 3 × 4 + 5 = 17.' });
    expect(verdict.safe).toBe(false);
    expect(verdict.reasons).toContain('COMPLETED_COMPUTATION');
  });

  it('12. a full worked solution is rejected', () => {
    expect(
      assessAnswerLeakage({
        explanation: 'Here is the full solution.',
        stepByStep: ['a', 'b', 'c', 'd'],
      }).safe
    ).toBe(false);

    const numbered = assessAnswerLeakage({
      explanation: 'Step 1: isolate x. Step 2: divide both sides. Step 3: simplify to x = 4.',
    });
    expect(numbered.safe).toBe(false);
  });

  it('12b. a legitimate hint is accepted (policy is not over-eager)', () => {
    expect(assessAnswerLeakage(safePayload()).safe).toBe(true);
    expect(
      assessAnswerLeakage({ explanation: 'Denklemi kur: 2x + 3 = 11. Ardından bilinmeyeni yalnız bırakmayı düşün.' }).safe
    ).toBe(true);
    expect(assessAnswerLeakage({ explanation: 'Bir sonraki adımda hangi işlemi uygulayacağını düşün.' }).safe).toBe(true);
  });

  it('13. an unsafe response never reaches the API response', async () => {
    // Both the first and the regenerated response are unsafe → safe fallback only.
    const service = new AIExplanationService(new StubProvider([leakyPayload(), leakyPayload()]));
    const result = await service.generateExplanation(SERVICE_REQUEST);
    expect(JSON.stringify(result)).not.toMatch(/the answer is/i);
    expect(JSON.stringify(result)).not.toMatch(/= 4/);
    expect(result.metadata.source).toBe('fallback');
    expect(result.metadata.safety).toBe('fallback');
  });
});

describe('Phase 5F.9-D — Safe regeneration / fallback', () => {
  it('14. an unsafe first response triggers ONE bounded regeneration', async () => {
    const stub = new StubProvider([leakyPayload(), safePayload()]);
    const service = new AIExplanationService(stub);
    const result = await service.generateExplanation(SERVICE_REQUEST);

    expect(stub.calls).toHaveLength(2);
    expect(result.metadata.safety).toBe('regenerated');
    expect(result.metadata.source).toBe('provider');
    // The regeneration request told the model what was wrong.
    expect(stub.calls[1].messages.some((m) => m.content.includes('safety policy'))).toBe(true);
  });

  it('15. an unsafe regenerated response falls back to safe answer-free guidance', async () => {
    const stub = new StubProvider([leakyPayload(), leakyPayload()]);
    const service = new AIExplanationService(stub);
    const result = await service.generateExplanation(SERVICE_REQUEST);

    expect(stub.calls).toHaveLength(2);
    expect(result.metadata.source).toBe('fallback');
    expect(JSON.stringify(result)).not.toMatch(/answer is/i);
    // The fallback is still pedagogically useful.
    expect(result.explanation.length).toBeGreaterThan(20);
  });

  it('16. a provider failure yields a truthful fallback (not a fake success)', async () => {
    const service = new AIExplanationService(new StubProvider([new Error('provider down')]));
    const result = await service.generateExplanation(SERVICE_REQUEST);
    expect(result.metadata.source).toBe('fallback');
    expect(result.metadata.model).toBe('safe-fallback');
    // It never claims the model produced it, and never leaks a diagnosis.
    expect(result.metadata.model).not.toBe('stub-model');
  });

  it('16b. an invalid structured response is treated as a provider failure', async () => {
    const service = new AIExplanationService(new StubProvider([{ stepByStep: [] }]));
    const result = await service.generateExplanation(SERVICE_REQUEST);
    expect(result.metadata.source).toBe('fallback');
  });

  it('17. there is no infinite regeneration loop (bounded)', async () => {
    // A provider that is ALWAYS unsafe must be called exactly twice: initial + 1.
    const stub = new StubProvider([leakyPayload()]);
    const service = new AIExplanationService(stub);
    await service.generateExplanation(SERVICE_REQUEST);
    expect(stub.calls.length).toBeLessThanOrEqual(2);
  });
});

describe('Phase 5F.9-D — Pedagogy', () => {
  it('18. HINT mode does not require correctAnswer', async () => {
    const stub = new StubProvider([safePayload()]);
    const service = new AIExplanationService(stub);
    const result = await service.generateExplanation({ ...SERVICE_REQUEST, mode: 'HINT' });
    expect(result.mode).toBe('HINT');
    expect(stub.calls).toHaveLength(1);
  });

  it('19. SOCRATIC mode produces a question rather than a solution', async () => {
    const stub = new StubProvider([
      safePayload({ explanation: 'Kendine şunu sor: Verilen koşullardan hangisi gerekli kuralı işaret ediyor?' }),
    ]);
    const service = new AIExplanationService(stub);
    const result = await service.generateExplanation({ ...SERVICE_REQUEST, mode: 'SOCRATIC' });
    expect(result.explanation).toContain('?');
    expect(assessAnswerLeakage(result).safe).toBe(true);
  });

  it('20. FORMULA_REMINDER does not reveal the final answer', async () => {
    const service = new AIExplanationService(
      new StubProvider([safePayload({ explanation: 'İlgili kuralı hatırla: iki tarafa da aynı işlemi uygulamalısın.' })])
    );
    const result = await service.generateExplanation({ ...SERVICE_REQUEST, mode: 'FORMULA_REMINDER' });
    expect(result.mode).toBe('FORMULA_REMINDER');
    expect(assessAnswerLeakage(result).safe).toBe(true);
  });

  it('21. MISTAKE_GUIDANCE can use the authoritative ErrorAnalysis signal', async () => {
    const stub = new StubProvider([safePayload()]);
    const service = new AIExplanationService(stub);
    await service.generateExplanation({
      ...SERVICE_REQUEST,
      mode: 'MISTAKE_GUIDANCE',
      errorType: 'CONCEPT',
      errorHypothesis: 'Öğrenci işlem sırasını karıştırıyor.',
    });
    const prompt = stub.calls[0].messages.map((m) => m.content).join('\n');
    expect(prompt).toContain('CONCEPT');
    expect(prompt).toContain('MISTAKE_GUIDANCE');
  });

  it('22. NEXT_STEP guidance can use the authoritative MicroSkill', async () => {
    const stub = new StubProvider([safePayload()]);
    const service = new AIExplanationService(stub);
    await service.generateExplanation({ ...SERVICE_REQUEST, mode: 'NEXT_STEP' });
    const prompt = stub.calls[0].messages.map((m) => m.content).join('\n');
    expect(prompt).toContain('Doğrusal denklem çözme');
  });

  it('22b. an unknown mode is normalised to HINT (there is no solution mode)', async () => {
    const service = new AIExplanationService(new StubProvider([safePayload()]));
    const result = await service.generateExplanation({ ...SERVICE_REQUEST, mode: 'FULL_SOLUTION' });
    expect(result.mode).toBe('HINT');
  });

  it('22c. the safe fallback is answer-free for every mode', () => {
    for (const mode of ['HINT', 'SOCRATIC', 'FORMULA_REMINDER', 'MISTAKE_GUIDANCE', 'NEXT_STEP'] as const) {
      const content = buildSafeFallbackHint(mode);
      expect(assessAnswerLeakage(content).safe).toBe(true);
      expect(content.explanation.length).toBeGreaterThan(10);
    }
  });
});

describe('Phase 5F.9-D — Security / logging', () => {
  it('23-28. question, answer, correctAnswer, prompt, response and API key are never logged', async () => {
    const { logger } = await import('../../src/infrastructure/logging/logger.js');
    const infoSpy = vi.mocked(logger.info);
    const errorSpy = vi.mocked(logger.error);
    const warnSpy = vi.mocked(logger.warn);
    infoSpy.mockClear();
    errorSpy.mockClear();
    warnSpy.mockClear();

    const SECRET_Q = 'SENSITIVE_QUESTION_551';
    const SECRET_A = 'SENSITIVE_ANSWER_773';

    // Provider success + error paths.
    const okFetch = vi.fn(async () => jsonResponse(envelope(JSON.stringify(safePayload()))));
    await buildProvider(okFetch).generateGuidance({
      ...MODEL_INPUT,
      question: SECRET_Q,
      studentAnswer: SECRET_A,
    });
    await buildProvider(vi.fn(async () => jsonResponse('nope', 400)))
      .generateGuidance({ ...MODEL_INPUT, question: SECRET_Q })
      .catch(() => undefined);

    // Service happy path, rejection path and failure path.
    const service = new AIExplanationService(new StubProvider([safePayload()]));
    await service.generateExplanation({ ...SERVICE_REQUEST, question: SECRET_Q, studentAnswer: SECRET_A });
    await new AIExplanationService(new StubProvider([leakyPayload(), leakyPayload()]))
      .generateExplanation({ ...SERVICE_REQUEST, question: SECRET_Q, studentAnswer: SECRET_A });
    await new AIExplanationService(new StubProvider([new Error('down')]))
      .generateExplanation({ ...SERVICE_REQUEST, question: SECRET_Q });

    const all = JSON.stringify([...infoSpy.mock.calls, ...errorSpy.mock.calls, ...warnSpy.mock.calls]);
    expect(all).not.toContain(SECRET_Q);
    expect(all).not.toContain(SECRET_A);
    expect(all).not.toContain(CANONICAL_ANSWER);
    expect(all).not.toContain(API_KEY);
    expect(all).not.toContain('Bearer');
    expect(all).not.toContain('Question:');
    // Rejection reasons are logged as CATEGORIES, never as content.
    expect(all).toMatch(/rejectionReason/);
  });
});

describe('Phase 5F.9-D — Factory / provider configuration', () => {
  it('returns MockAIProvider when configured as mock', () => {
    expect(createExplanationProviderFromConfig(makeConfig({ provider: 'mock' }))).toBeInstanceOf(MockAIProvider);
  });

  it('returns the real provider when openai + egress allowed + key present', () => {
    const provider = createExplanationProviderFromConfig(
      makeConfig({ provider: 'openai', allowExternalProvider: true, apiKey: 'k' }),
      { fetchImpl: vi.fn() }
    );
    expect(provider).toBeInstanceOf(RealExplanationProvider);
  });

  it('FAILS FAST without explicit egress allowance (never silent mock)', () => {
    expect(() =>
      createExplanationProviderFromConfig(makeConfig({ provider: 'openai', allowExternalProvider: false }))
    ).toThrow(AiAnalysisError);
  });

  it('FAILS FAST when the real provider has no API key', () => {
    expect(() =>
      createExplanationProviderFromConfig(
        makeConfig({ provider: 'openai', allowExternalProvider: true, apiKey: '' })
      )
    ).toThrow(AiAnalysisError);
  });

  it('rejects an unknown provider instead of falling back to mock', () => {
    expect(() =>
      createExplanationProviderFromConfig(makeConfig({ provider: 'unsupported' as any }))
    ).toThrow(AiAnalysisError);
  });

  it('getVersion is truthful (configured model, no fabricated date)', () => {
    const provider = new RealExplanationProvider(makeConfig({ model: 'gpt-4o-mini' }), { fetchImpl: vi.fn() });
    expect(provider.getVersion()).toBe('gpt-4o-mini');
    expect(provider.getVersion()).not.toBe('2024-02-15');
    // The obsolete model must not reappear anywhere in the config surface.
    expect(makeConfig().model).not.toBe('gpt-4-turbo-preview');
  });

  it('retries transient failures but not permanent ones', async () => {
    let call = 0;
    const retryFetch = vi.fn(async () => {
      call++;
      if (call === 1) return jsonResponse('boom', 503);
      return jsonResponse(envelope(JSON.stringify(safePayload())));
    });
    const provider = buildProvider(retryFetch, makeConfig({ maxRetries: 2 }));
    await provider.generateGuidance(MODEL_INPUT);
    expect(retryFetch).toHaveBeenCalledTimes(2);

    const sleepImpl = vi.fn(async () => {});
    const badFetch = vi.fn(async () => jsonResponse('bad request', 400));
    const provider2 = new RealExplanationProvider(makeConfig({ maxRetries: 3 }), { fetchImpl: badFetch, sleepImpl });
    await expect(provider2.generateGuidance(MODEL_INPUT)).rejects.toBeInstanceOf(AiAnalysisError);
    expect(badFetch).toHaveBeenCalledTimes(1);
    expect(sleepImpl).not.toHaveBeenCalled();
  });
});

describe('Phase 5F.9-D — Regression / authoritative state', () => {
  it('31-35. explanation does not mutate any authoritative learning state', async () => {
    const { prisma } = await import('../setup.js');

    const before = {
      skillMastery: await prisma.skillMastery.count(),
      learningProgress: await prisma.learningProgress.count(),
      errorPattern: await prisma.errorPattern.count(),
      microSkill: await prisma.microSkill.count(),
      questionSkillMapping: await prisma.questionSkillMapping.count(),
      errorAnalysis: await prisma.errorAnalysis.count(),
      questionAttempt: await prisma.questionAttempt.count(),
    };

    // Exercise every path: safe, rejected-then-regenerated, rejected-then-fallback, failure.
    await new AIExplanationService(new StubProvider([safePayload()])).generateExplanation(SERVICE_REQUEST);
    await new AIExplanationService(new StubProvider([leakyPayload(), safePayload()])).generateExplanation(SERVICE_REQUEST);
    await new AIExplanationService(new StubProvider([leakyPayload()])).generateExplanation(SERVICE_REQUEST);
    await new AIExplanationService(new StubProvider([new Error('down')])).generateExplanation(SERVICE_REQUEST);

    expect(await prisma.skillMastery.count()).toBe(before.skillMastery);
    expect(await prisma.learningProgress.count()).toBe(before.learningProgress);
    expect(await prisma.errorPattern.count()).toBe(before.errorPattern);
    expect(await prisma.microSkill.count()).toBe(before.microSkill);
    expect(await prisma.questionSkillMapping.count()).toBe(before.questionSkillMapping);
    expect(await prisma.errorAnalysis.count()).toBe(before.errorAnalysis);
    expect(await prisma.questionAttempt.count()).toBe(before.questionAttempt);
  });
});

describe('Phase 5F.9-D — Authorization / data isolation (HTTP)', () => {
  let app: any;

  beforeAll(async () => {
    const bootstrap = (await import('../../src/index.js')).default;
    app = await bootstrap();
  });

  async function registerAndLogin(label: string) {
    const request = (await import('supertest')).default;
    const email = `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
    const password = 'Test123!@#';
    await request(app).post('/api/v1/auth/register')
      .send({ email, password, firstName: label, lastName: 'User', grade: 11 });
    const login = await request(app).post('/api/v1/auth/login').send({ email, password });
    return login.body.data.tokens.accessToken as string;
  }

  it('29. an unauthenticated request is rejected before any AI work', async () => {
    const request = (await import('supertest')).default;
    const res = await request(app)
      .post('/api/v1/ai/ai/explanation')
      .send({ concept: 'x', skillId: 's', difficulty: 1 });
    expect(res.status).toBe(401);
  });

  it('29b. an invalid token is rejected', async () => {
    const request = (await import('supertest')).default;
    const res = await request(app)
      .post('/api/v1/ai/ai/explanation')
      .set('Authorization', 'Bearer not-a-real-token')
      .send({ concept: 'x', skillId: 's', difficulty: 1 });
    expect(res.status).toBe(401);
  });

  it('30. an authenticated owner can request guidance for their own context', async () => {
    const request = (await import('supertest')).default;
    const token = await registerAndLogin('p5f9d');

    const res = await request(app)
      .post('/api/v1/ai/ai/explanation')
      .set('Authorization', `Bearer ${token}`)
      .send({
        concept: 'Doğrusal denklem',
        skillId: 'ms-1',
        difficulty: 2,
        mode: 'HINT',
        question: '2x + 3 = 11',
        studentAnswer: 'x = 3',
        // A hostile client tries to inject the canonical answer: it must be
        // ignored by the route schema and never reach the model or the response.
        correctAnswer: CANONICAL_ANSWER,
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.mode).toBe('HINT');
    const serialized = JSON.stringify(res.body);
    expect(serialized).not.toContain('The answer is');
    expect(serialized).not.toContain(CANONICAL_ANSWER);
  });

  it('30b. an injected full-solution mode is rejected by the route schema', async () => {
    const request = (await import('supertest')).default;
    const token = await registerAndLogin('p5f9d-mode');
    const res = await request(app)
      .post('/api/v1/ai/ai/explanation')
      .set('Authorization', `Bearer ${token}`)
      .send({ concept: 'x', skillId: 's', difficulty: 1, mode: 'FULL_SOLUTION' });
    expect(res.status).toBe(400);
  });
});
