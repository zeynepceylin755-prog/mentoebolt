import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  RealErrorAnalysisProvider,
  validatePayload,
  deriveConfidence,
} from '../../src/infrastructure/ai/error-analysis/RealErrorAnalysisProvider.js';
import { createErrorAnalysisProviderFromConfig } from '../../src/infrastructure/ai/error-analysis/ErrorAnalysisProviderFactory.js';
import { MockAIProvider } from '../../src/infrastructure/ai/providers/MockAIProvider.js';
import { AIErrorAnalysisService } from '../../src/application/services/ai/AIErrorAnalysisService.js';
import { ErrorAnalysisApplicationService } from '../../src/application/services/learning/ErrorAnalysisApplicationService.js';
import { AiAnalysisError } from '../../src/domain/errors/QuestionAnalysisErrors.js';
import type { ErrorAnalysisConfig } from '../../src/infrastructure/ai/error-analysis/config/ErrorAnalysisConfig.js';
import type { IAIProvider, AIRequest, AIResponse } from '../../src/domain/interfaces/ai/IAIProvider.js';

/**
 * Phase 5F.9-C — Real error-analysis provider.
 *
 * The HTTP boundary and the sleep function are injected, so NOTHING here makes a
 * real external call.
 */

const API_KEY = 'test-key';

function makeConfig(overrides: Partial<ErrorAnalysisConfig> = {}): ErrorAnalysisConfig {
  return {
    provider: 'openai',
    model: 'gpt-4o',
    timeoutMs: 5000,
    maxRetries: 2,
    maxTokens: 1024,
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

/** Wrap model JSON content into a chat-completions envelope. */
function envelope(contentText: string) {
  return {
    model: 'gpt-4o',
    created: 1700000,
    choices: [{ message: { content: contentText }, finish_reason: 'stop' }],
  };
}

/** Build a valid model payload. */
function payload(overrides: Record<string, unknown> = {}) {
  return {
    errorType: 'CONCEPT',
    confidence: 0.78,
    hypothesis: 'The student appears to confuse the sign rule with the multiplication rule.',
    relatedSkills: [],
    suggestion: 'Review the distinction between the sign rule and the product rule.',
    metadata: {},
    ...overrides,
  };
}

function build(fetchImpl: any, config = makeConfig(), sleepImpl = vi.fn(async () => {})) {
  const provider = new RealErrorAnalysisProvider(config, { fetchImpl, sleepImpl });
  return { provider, sleepImpl };
}

/** Deterministic provider used to exercise AIErrorAnalysisService in isolation. */
class StubProvider implements IAIProvider {
  constructor(private readonly structured: unknown) {}
  getProviderName() { return 'stub'; }
  getModelName() { return 'stub-model'; }
  getVersion() { return 'stub-1'; }
  async isAvailable() { return true; }
  async complete(_r: AIRequest): Promise<AIResponse> {
    return { content: '', model: 'stub-model', version: 'stub-1', tokensUsed: 0, latencyMs: 0, finishReason: 'stop' };
  }
  async completeStructured<T>(_r: AIRequest, _s?: unknown): Promise<AIResponse & { structured: T }> {
    return {
      content: JSON.stringify(this.structured),
      structured: this.structured as T,
      model: 'stub-model',
      version: 'stub-1',
      tokensUsed: 0,
      latencyMs: 0,
      finishReason: 'stop',
    };
  }
}

const SERVICE_REQUEST = {
  question: 'Solve for x: 2x + 3 = 11',
  studentAnswer: 'x = 3',
  correctAnswer: 'x = 4',
  skillId: 'ms-1',
  skillName: 'Solve linear equations',
  skillDescription: 'Isolate the unknown.',
  difficulty: 2,
  previousAttempts: [],
  timeSpentSeconds: 30,
};

describe('Phase 5F.9-C — Provider contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('1. valid structured error analysis is accepted', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(envelope(JSON.stringify(payload()))));
    const { provider } = build(fetchImpl);
    const res = await provider.completeStructured<any>({
      messages: [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'Analyze this error' },
      ],
    }, {});

    expect(res.structured.errorType).toBe('CONCEPT');
    expect(res.structured.confidence).toBeCloseTo(0.78);
    expect(res.structured.hypothesis).toContain('confuse the sign rule');
    expect(res.model).toBe('gpt-4o');
  });

  it('1b. sends calm Turkish next-step and hidden-reasoning restrictions', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(envelope(JSON.stringify(payload()))));
    await build(fetchImpl).provider.completeStructured<any>(
      { messages: [{ role: 'user', content: 'Analyze this error' }] }, {}
    );

    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, { body: string }];
    const body = JSON.parse(init.body);
    const systemPrompt = body.messages.find((message: { role: string }) => message.role === 'system').content;

    expect(systemPrompt).toContain('mathematics diagnostics assistant');
    expect(systemPrompt).toContain('errorType');
    expect(systemPrompt).toContain('confidence');
    expect(systemPrompt).toContain('Return ONLY valid JSON');
  });

  it('2. malformed JSON is rejected (non-JSON envelope and non-JSON content)', async () => {
    const badEnvelope = vi.fn(async () => jsonResponse('definitely not json'));
    await expect(
      build(badEnvelope).provider.completeStructured<any>(
        { messages: [{ role: 'user', content: 'x' }] }, {}
      )
    ).rejects.toBeInstanceOf(AiAnalysisError);

    const badContent = vi.fn(async () => jsonResponse(envelope('not json either')));
    await expect(
      build(badContent).provider.completeStructured<any>(
        { messages: [{ role: 'user', content: 'x' }] }, {}
      )
    ).rejects.toBeInstanceOf(AiAnalysisError);
  });

  it('3. missing required field is rejected', () => {
    expect(() => validatePayload({ confidence: 0.8, hypothesis: 'h', suggestion: 's' })).toThrow(AiAnalysisError);
    expect(() => validatePayload(payload({ hypothesis: undefined }))).toThrow(AiAnalysisError);
    expect(() => validatePayload(payload({ hypothesis: '' }))).toThrow(AiAnalysisError);
    expect(() => validatePayload(payload({ suggestion: undefined }))).toThrow(AiAnalysisError);
  });

  it('4. invalid (non-numeric) confidence is rejected', () => {
    expect(() => validatePayload(payload({ confidence: 'high' }))).toThrow(AiAnalysisError);
    expect(() => validatePayload(payload({ confidence: Number.NaN }))).toThrow(AiAnalysisError);
    expect(() => validatePayload(payload({ confidence: undefined }))).toThrow(AiAnalysisError);
  });

  it('5. confidence outside [0,1] is rejected', () => {
    expect(() => validatePayload(payload({ confidence: 1.5 }))).toThrow(AiAnalysisError);
    expect(() => validatePayload(payload({ confidence: -0.2 }))).toThrow(AiAnalysisError);
  });
});

describe('Phase 5F.9-C — Error taxonomy', () => {
  it('6. every coarse errorType supported by the system is accepted', () => {
    for (const type of ['CONCEPT', 'SKILL', 'PREREQUISITE', 'OPERATION', 'READING', 'CALCULATION', 'ATTENTION', 'OTHER']) {
      expect(validatePayload(payload({ errorType: type })).errorType).toBe(type);
    }
  });

  it('7. an unsupported errorType is rejected (never silently normalised into a pattern)', () => {
    expect(() => validatePayload(payload({ errorType: 'GUESSING' }))).toThrow(AiAnalysisError);
    expect(() => validatePayload(payload({ errorType: 'concept' }))).toThrow(AiAnalysisError);
    expect(() => validatePayload(payload({ errorType: 7 }))).toThrow(AiAnalysisError);
  });

  it('8/9. the AI cannot supply an authoritative ErrorPattern or MicroSkill identifier', () => {
    expect(() => validatePayload(payload({ errorPatternId: 'ep-123' }))).toThrow(AiAnalysisError);
    expect(() => validatePayload(payload({ errorPatternCode: 'EP.CONCEPT.1' }))).toThrow(AiAnalysisError);
    expect(() => validatePayload(payload({ microSkillId: 'ms-abc' }))).toThrow(AiAnalysisError);
  });

  it('8b. score, mastery and correctness fields are not part of the validated proposal', () => {
    const validated = validatePayload(payload({ correct: true, score: 100, mastery: 1 }));

    expect(validated).not.toHaveProperty('correct');
    expect(validated).not.toHaveProperty('score');
    expect(validated).not.toHaveProperty('mastery');
  });

  it('relatedSkills are free text, never treated as database identifiers', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(envelope(JSON.stringify(payload({ relatedSkills: ['sign rules', 42, ''] }))))
    );
    const { provider } = build(fetchImpl);
    const res = await provider.completeStructured<any>(
      { messages: [{ role: 'user', content: 'x' }] }, {}
    );
    expect(res.structured.relatedSkills).toEqual(['sign rules']);
  });
});

describe('Phase 5F.9-C — Evidence behaviour', () => {
  it('10. insufficient evidence → OTHER with low conservative confidence', () => {
    const validated = validatePayload(payload({ errorType: 'OTHER', confidence: 0.9 }));
    expect(validated.errorType).toBe('OTHER');
    // The provider caps OTHER confidence regardless of what the model claimed.
    expect(deriveConfidence('OTHER', 0.9)).toBeLessThanOrEqual(0.3);
  });

  it('10b. confidence is never inflated above the safe ceiling', () => {
    expect(deriveConfidence('CONCEPT', 1)).toBeLessThanOrEqual(0.95);
    expect(deriveConfidence('CONCEPT', 0.5)).toBeCloseTo(0.5);
  });

  it('11/12/13/14. the prompt carries the answer, the question, the authoritative skill and forbids a solution', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(envelope(JSON.stringify(payload()))));
    const { provider } = build(fetchImpl);
    await provider.completeStructured<any>(
      {
        messages: [
          { role: 'system', content: 'SYS' },
          {
            role: 'user',
            content: [
              'Skill being assessed: Solve linear equations — Isolate the unknown.',
              'Question:',
              'Solve for x: 2x + 3 = 11',
              "Student's submitted answer:",
              'x = 3',
              'Do NOT solve the question. Do NOT give a full or worked solution.',
            ].join('\n'),
          },
        ],
      },
      {}
    );

    const call = fetchImpl.mock.calls[0] as unknown as [string, { body: string }];
    const body = JSON.parse(call[1].body);
    const system = body.messages[0].content as string;
    const user = body.messages[1].content as string;

    // 11: the student's answer is passed to the model.
    expect(user).toContain('x = 3');
    // 12: the question context is passed.
    expect(user).toContain('2x + 3 = 11');
    // 13: the authoritative MicroSkill context is passed.
    expect(user).toContain('Solve linear equations');
    // 14: the prompt explicitly forbids generating a full solution.
    expect(system).toContain('Do NOT solve the question');
    expect(user).toContain('Do NOT give a full or worked solution');
  });

  it('14b. the service prompt forbids solving and does not make AI the correctness authority', async () => {
    const capture: AIRequest[] = [];
    const spy: IAIProvider = new (class extends StubProvider {
      async completeStructured<T>(r: AIRequest, s?: unknown): Promise<AIResponse & { structured: T }> {
        capture.push(r);
        return super.completeStructured<T>(r, s);
      }
    })(payload());

    const service = new AIErrorAnalysisService(spy);
    await service.analyzeError(SERVICE_REQUEST);

    const system = capture[0].messages[0].content;
    const user = capture[0].messages[1].content;
    expect(system).toContain('Do NOT solve the question');
    expect(system).toContain('already known to be incorrect');
    expect(user).toContain('x = 3'); // student answer present
    expect(user).toContain('Solve linear equations'); // authoritative skill present
  });
});

describe('Phase 5F.9-C — Reliability', () => {
  it('15. timeout is transient and retried, then fails clearly', async () => {
    const timeoutError = Object.assign(new Error('aborted'), { name: 'AbortError' });
    const fetchImpl = vi.fn(async () => {
      throw timeoutError;
    });
    const { provider, sleepImpl } = build(fetchImpl, makeConfig({ maxRetries: 2 }));
    await expect(
      provider.completeStructured<any>({ messages: [{ role: 'user', content: 'x' }] }, {})
    ).rejects.toBeInstanceOf(AiAnalysisError);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(sleepImpl).toHaveBeenCalledTimes(2);
  });

  it('16. 429 is retried (honouring Retry-After) then succeeds', async () => {
    let call = 0;
    const sleepImpl = vi.fn(async () => {});
    const fetchImpl = vi.fn(async () => {
      call++;
      if (call < 2) return jsonResponse('rate limited', 429, { 'retry-after': '1' });
      return jsonResponse(envelope(JSON.stringify(payload())));
    });
    const { provider } = build(fetchImpl, makeConfig({ maxRetries: 3 }), sleepImpl);
    const res = await provider.completeStructured<any>({ messages: [{ role: 'user', content: 'x' }] }, {});
    expect(res.structured.errorType).toBe('CONCEPT');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    // Retry-After: 1 second was honoured rather than the exponential default.
    expect(sleepImpl).toHaveBeenCalledWith(1000);
  });

  it('17. 5xx is retried', async () => {
    let call = 0;
    const fetchImpl = vi.fn(async () => {
      call++;
      if (call === 1) return jsonResponse('boom', 503);
      return jsonResponse(envelope(JSON.stringify(payload())));
    });
    const { provider } = build(fetchImpl, makeConfig({ maxRetries: 2 }));
    await provider.completeStructured<any>({ messages: [{ role: 'user', content: 'x' }] }, {});
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('18. exhausted retries fail clearly (no fake success)', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse('boom', 500));
    const { provider } = build(fetchImpl, makeConfig({ maxRetries: 1 }));
    await expect(
      provider.completeStructured<any>({ messages: [{ role: 'user', content: 'x' }] }, {})
    ).rejects.toBeInstanceOf(AiAnalysisError);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('19. a non-retryable 4xx fails immediately', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse('bad request', 400));
    const { provider, sleepImpl } = build(fetchImpl, makeConfig({ maxRetries: 3 }));
    await expect(
      provider.completeStructured<any>({ messages: [{ role: 'user', content: 'x' }] }, {})
    ).rejects.toBeInstanceOf(AiAnalysisError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(sleepImpl).not.toHaveBeenCalled();
  });

  it('19b. 401 authentication failure is not retried', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse('unauthorized', 401));
    const { provider, sleepImpl } = build(fetchImpl, makeConfig({ maxRetries: 3 }));
    await expect(
      provider.completeStructured<any>({ messages: [{ role: 'user', content: 'x' }] }, {})
    ).rejects.toBeInstanceOf(AiAnalysisError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(sleepImpl).not.toHaveBeenCalled();
  });

  it('20. malformed model output is NOT retried (permanent) and produces no result', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(envelope(JSON.stringify({ nonsense: true }))));
    const { provider, sleepImpl } = build(fetchImpl, makeConfig({ maxRetries: 3 }));
    await expect(
      provider.completeStructured<any>({ messages: [{ role: 'user', content: 'x' }] }, {})
    ).rejects.toBeInstanceOf(AiAnalysisError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(sleepImpl).not.toHaveBeenCalled();
  });
});

describe('Phase 5F.9-C — AIErrorAnalysisService contract', () => {
  it('returns the validated classification and metadata', async () => {
    const service = new AIErrorAnalysisService(new StubProvider(payload()));
    const res = await service.analyzeError(SERVICE_REQUEST);
    expect(res.errorType).toBe('CONCEPT');
    expect(res.confidence).toBeCloseTo(0.78);
    expect(res.metadata.model).toBe('stub-model');
  });

  it('a provider failure is SURFACED, never silently converted into a classification', async () => {
    class FailingProvider extends StubProvider {
      async completeStructured<T>(): Promise<AIResponse & { structured: T }> {
        throw new Error('provider down');
      }
    }
    const service = new AIErrorAnalysisService(new FailingProvider(payload()));
    await expect(service.analyzeError(SERVICE_REQUEST)).rejects.toBeInstanceOf(AiAnalysisError);
  });

  it('an invalid structured result is rejected rather than persisted', async () => {
    const service = new AIErrorAnalysisService(new StubProvider({ errorType: 'CONCEPT', confidence: 2 }));
    await expect(service.analyzeError(SERVICE_REQUEST)).rejects.toBeInstanceOf(AiAnalysisError);

    const unsupported = new AIErrorAnalysisService(new StubProvider(payload({ errorType: 'NOPE' })));
    await expect(unsupported.analyzeError(SERVICE_REQUEST)).rejects.toBeInstanceOf(AiAnalysisError);
  });
});

describe('Phase 5F.9-C — Security / logging', () => {
  it('no question, answer, prompt, response or API key is logged', async () => {
    const { logger } = await import('../../src/infrastructure/logging/logger.js');
    const infoSpy = vi.mocked(logger.info);
    const errorSpy = vi.mocked(logger.error);
    const warnSpy = vi.mocked(logger.warn);
    infoSpy.mockClear();
    errorSpy.mockClear();
    warnSpy.mockClear();

    const SECRET_QUESTION = 'SENSITIVE_STUDENT_QUESTION_771';
    const SECRET_ANSWER = 'SENSITIVE_STUDENT_ANSWER_992';

    // Provider success path (prompt embeds the secret content).
    const okFetch = vi.fn(async () => jsonResponse(envelope(JSON.stringify(payload()))));
    await build(okFetch).provider.completeStructured<any>(
      { messages: [{ role: 'user', content: `${SECRET_QUESTION} ${SECRET_ANSWER}` }] }, {}
    );

    // Provider error path.
    await build(vi.fn(async () => jsonResponse('nope', 400)))
      .provider.completeStructured<any>(
        { messages: [{ role: 'user', content: SECRET_QUESTION }] }, {}
      )
      .catch(() => undefined);

    // Service success + failure paths.
    const service = new AIErrorAnalysisService(new StubProvider(payload()));
    await service.analyzeError({ ...SERVICE_REQUEST, question: SECRET_QUESTION, studentAnswer: SECRET_ANSWER });
    await new AIErrorAnalysisService(new StubProvider(null as any))
      .analyzeError({ ...SERVICE_REQUEST, question: SECRET_QUESTION })
      .catch(() => undefined);

    const all = JSON.stringify([...infoSpy.mock.calls, ...errorSpy.mock.calls, ...warnSpy.mock.calls]);
    expect(all).not.toContain(SECRET_QUESTION);
    expect(all).not.toContain(SECRET_ANSWER);
    expect(all).not.toContain(API_KEY);
    expect(all).not.toContain('Bearer');
    expect(all).not.toContain('Student Answer');
  });
});

describe('Phase 5F.9-C — Factory', () => {
  it('returns MockAIProvider when configured as mock', () => {
    expect(createErrorAnalysisProviderFromConfig(makeConfig({ provider: 'mock' }))).toBeInstanceOf(MockAIProvider);
  });

  it('returns the real provider when openai + egress allowed + key present', () => {
    const provider = createErrorAnalysisProviderFromConfig(
      makeConfig({ provider: 'openai', allowExternalProvider: true, apiKey: 'k' }),
      { fetchImpl: vi.fn() }
    );
    expect(provider).toBeInstanceOf(RealErrorAnalysisProvider);
  });

  it('FAILS FAST without explicit egress allowance (never silent mock)', () => {
    expect(() =>
      createErrorAnalysisProviderFromConfig(makeConfig({ provider: 'openai', allowExternalProvider: false }))
    ).toThrow(AiAnalysisError);
  });

  it('FAILS FAST when the real provider has no API key', () => {
    expect(() =>
      createErrorAnalysisProviderFromConfig(
        makeConfig({ provider: 'openai', allowExternalProvider: true, apiKey: '' })
      )
    ).toThrow(AiAnalysisError);
  });

  it('rejects an unknown provider instead of falling back to mock', () => {
    expect(() =>
      createErrorAnalysisProviderFromConfig(makeConfig({ provider: 'unsupported' as any }))
    ).toThrow(AiAnalysisError);
  });

  it('getVersion is truthful (configured model, not a fabricated date)', () => {
    const provider = new RealErrorAnalysisProvider(makeConfig({ model: 'gpt-4o-mini' }), {
      fetchImpl: vi.fn(),
    });
    expect(provider.getVersion()).toBe('gpt-4o-mini');
    expect(provider.getVersion()).not.toBe('2024-02-15');
  });
});

describe('Phase 5F.9-C — End-to-end governance (no AI authority)', () => {
  it('the real provider drives the EXISTING resolver: compatible ErrorPattern is chosen by the backend', async () => {
    const { prisma } = await import('../setup.js');

    await prisma.auditLog.deleteMany();
    await prisma.errorAnalysis.deleteMany();
    await prisma.errorPatternMicroSkill.deleteMany();
    await prisma.errorPattern.deleteMany();
    await prisma.questionAttempt.deleteMany();
    await prisma.questionSkillMapping.deleteMany();
    await prisma.question.deleteMany();
    await prisma.microSkill.deleteMany();
    await prisma.processComponent.deleteMany();
    await prisma.learningOutcome.deleteMany();
    await prisma.theme.deleteMany();
    await prisma.curriculumVersion.deleteMany();
    await prisma.studentProfile.deleteMany();
    await prisma.user.deleteMany();

    const uid = Math.random().toString(36).slice(2, 10);
    const version = await prisma.curriculumVersion.create({
      data: { code: 'P5F9C-CUR-' + uid, name: 'C', grade: 11, subject: 'Matematik', version: '1', source: 'TEST_FIXTURE' },
    });
    const theme = await prisma.theme.create({
      data: { curriculumVersionId: version.id, officialCode: 'P5F9C.T-' + uid, name: 'T', lessonHours: 1, sourceOrder: 1 },
    });
    const lo = await prisma.learningOutcome.create({
      data: { themeId: theme.id, officialCode: 'P5F9C.LO-' + uid, officialText: 'T', sourceOrder: 1 },
    });
    const pc = await prisma.processComponent.create({
      data: { learningOutcomeId: lo.id, officialCode: 'P5F9C.PC-' + uid, officialText: 'T', sourceOrder: 1 },
    });
    const ms = await prisma.microSkill.create({
      data: { processComponentId: pc.id, code: 'P5F9C.MS-' + uid, name: 'MS', description: 'd', source: 'TEST_FIXTURE', isActive: true },
    });
    const pattern = await prisma.errorPattern.create({
      data: { code: 'P5F9C.EP-' + uid, name: 'concept', description: 'd', category: 'CONCEPTUAL_MISUNDERSTANDING', severity: 'MEDIUM', source: 'TEST_FIXTURE', isActive: true, confidence: 0.9 },
    });
    await prisma.errorPatternMicroSkill.create({
      data: { errorPatternId: pattern.id, microSkillId: ms.id, relevance: 0.9, isPrimary: true },
    });

    const user = await prisma.user.create({
      data: { email: `p5f9c-${Date.now()}@example.com`, firstName: 'P5F9C', lastName: 'S', role: 'STUDENT', passwordHash: 'h' },
    });
    const student = await prisma.studentProfile.create({ data: { userId: user.id, grade: 11 }});
    const question = await prisma.question.create({
      data: { content: '2x + 3 = 11', type: 'OPEN_ENDED', difficulty: 2, skillId: 'unmapped', correctAnswer: '4', isActive: false, isFixture: true },
    });
    await prisma.questionSkillMapping.create({
      data: { questionId: question.id, microSkillId: ms.id, relevance: 0.9, isPrimary: true, mappingSource: 'MANUAL_REVIEW', reviewed: true },
    });
    const attempt = await prisma.questionAttempt.create({
      data: { studentId: student.id, questionId: question.id, answer: '3', isCorrect: false, timeSpentSeconds: 20, status: 'COMPLETED', validatedAt: new Date() },
    });

    // A REAL provider wired to a deterministic fake HTTP boundary.
    const fetchImpl = vi.fn(async () =>
      jsonResponse(envelope(JSON.stringify(payload({ errorType: 'CONCEPT', confidence: 0.8 }))))
    );
    const realProvider = new RealErrorAnalysisProvider(makeConfig({ maxRetries: 0 }), { fetchImpl });

    const service = new ErrorAnalysisApplicationService(
      prisma as any,
      new AIErrorAnalysisService(realProvider)
    );
    const result = await service.processAttemptError({ attemptId: attempt.id });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(result.processed).toBe(true);
    expect(result.state).toBe('CLASSIFIED');
    // The BACKEND chose the pattern (via the governance resolver), not the AI.
    expect(result.errorPatternId).toBe(pattern.id);
    expect(result.microSkillId).toBe(ms.id);

    const rows = await prisma.errorAnalysis.findMany({ where: { attemptId: attempt.id } });
    expect(rows.length).toBe(1);
    expect(rows[0].errorPatternId).toBe(pattern.id);
    expect(rows[0].validated).toBe(true);
    // The AI created no taxonomy and mutated neither mastery nor progress.
    expect(await prisma.errorPattern.count()).toBe(1);
    expect(await prisma.microSkill.count()).toBe(1);
    expect(await prisma.skillMastery.count()).toBe(0);
    expect(await prisma.learningProgress.count()).toBe(0);
  });

  it('a provider failure leaves the attempt untouched and persists no authoritative analysis', async () => {
    const { prisma } = await import('../setup.js');

    // Self-contained fixture: an incorrect attempt with a PRIMARY mapping.
    const uid = Math.random().toString(36).slice(2, 10);
    const version = await prisma.curriculumVersion.create({
      data: { code: 'P5F9CF-CUR-' + uid, name: 'C', grade: 11, subject: 'Matematik', version: '1', source: 'TEST_FIXTURE' },
    });
    const theme = await prisma.theme.create({
      data: { curriculumVersionId: version.id, officialCode: 'P5F9CF.T-' + uid, name: 'T', lessonHours: 1, sourceOrder: 1 },
    });
    const lo = await prisma.learningOutcome.create({
      data: { themeId: theme.id, officialCode: 'P5F9CF.LO-' + uid, officialText: 'T', sourceOrder: 1 },
    });
    const pc = await prisma.processComponent.create({
      data: { learningOutcomeId: lo.id, officialCode: 'P5F9CF.PC-' + uid, officialText: 'T', sourceOrder: 1 },
    });
    const ms = await prisma.microSkill.create({
      data: { processComponentId: pc.id, code: 'P5F9CF.MS-' + uid, name: 'MS', description: 'd', source: 'TEST_FIXTURE', isActive: true },
    });
    const user = await prisma.user.create({
      data: { email: `p5f9cf-${Date.now()}@example.com`, firstName: 'P5F9CF', lastName: 'S', role: 'STUDENT', passwordHash: 'h' },
    });

    const student = await prisma.studentProfile.create({ data: { userId: user.id, grade: 11 }});
    const question = await prisma.question.create({
      data: { content: '2x + 3 = 11', type: 'OPEN_ENDED', difficulty: 2, skillId: 'unmapped', correctAnswer: '4', isActive: false, isFixture: true },
    });
    await prisma.questionSkillMapping.create({
      data: { questionId: question.id, microSkillId: ms.id, relevance: 0.9, isPrimary: true, mappingSource: 'MANUAL_REVIEW', reviewed: true },
    });
    const attempt = await prisma.questionAttempt.create({
      data: { studentId: student.id, questionId: question.id, answer: '3', isCorrect: false, timeSpentSeconds: 20, status: 'COMPLETED', validatedAt: new Date() },
    });

    const failingFetch = vi.fn(async () => jsonResponse('down', 500));
    const realProvider = new RealErrorAnalysisProvider(makeConfig({ maxRetries: 0 }), {
      fetchImpl: failingFetch,
    });
    const service = new ErrorAnalysisApplicationService(
      prisma as any,
      new AIErrorAnalysisService(realProvider)
    );

    const result = await service.processAttemptError({ attemptId: attempt.id });
    expect(result.processed).toBe(false);
    expect(result.reason).toBe('AI_FAILED');
    expect(await prisma.errorAnalysis.count()).toBe(0);

    // Correctness is decided by the backend and was not overridden.
    const reloaded = await prisma.questionAttempt.findUnique({ where: { id: attempt!.id } });
    expect(reloaded!.isCorrect).toBe(false);
  });
});
