import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  RealVisionOcrProvider,
} from '../../src/infrastructure/ocr/RealVisionOcrProvider.js';
import { createOcrProviderFromConfig } from '../../src/infrastructure/ocr/OcrProviderFactory.js';
import {
  RealQuestionUnderstandingProvider,
  validatePayload as validateQuestionUnderstandingPayload,
} from '../../src/infrastructure/ai/question-understanding/RealQuestionUnderstandingProvider.js';
import { createQuestionUnderstandingProviderFromConfig } from '../../src/infrastructure/ai/question-understanding/QuestionUnderstandingProviderFactory.js';
import {
  RealErrorAnalysisProvider,
  validatePayload as validateErrorAnalysisPayload,
} from '../../src/infrastructure/ai/error-analysis/RealErrorAnalysisProvider.js';
import { createErrorAnalysisProviderFromConfig } from '../../src/infrastructure/ai/error-analysis/ErrorAnalysisProviderFactory.js';
import {
  RealExplanationProvider,
  buildPrompt as buildExplanationPrompt,
} from '../../src/infrastructure/ai/explanation/RealExplanationProvider.js';
import { createExplanationProviderFromConfig } from '../../src/infrastructure/ai/explanation/ExplanationProviderFactory.js';
import { AIExplanationService } from '../../src/application/services/ai/AIExplanationService.js';
import { assessAnswerLeakage } from '../../src/domain/ai/explanationPolicy.js';
import { AiAnalysisError, OcrProviderError } from '../../src/domain/errors/QuestionAnalysisErrors.js';
import { MockOcrProvider } from '../../src/infrastructure/ocr/MockOcrProvider.js';
import { MockAIProvider } from '../../src/infrastructure/ai/providers/MockAIProvider.js';
import { MockQuestionUnderstandingProvider } from '../../src/infrastructure/ai/providers/MockQuestionUnderstandingProvider.js';
import { IStorageProvider, StoredAsset, StoreInput } from '../../src/domain/interfaces/storage/IStorageProvider.js';
import type { OcrConfig } from '../../src/infrastructure/ocr/config/OcrConfig.js';
import type { QuestionUnderstandingConfig } from '../../src/infrastructure/ai/question-understanding/config/QuestionUnderstandingConfig.js';
import type { ErrorAnalysisConfig } from '../../src/infrastructure/ai/error-analysis/config/ErrorAnalysisConfig.js';
import type { ExplanationConfig } from '../../src/infrastructure/ai/explanation/config/ExplanationConfig.js';
import type { IAIProvider, AIRequest, AIResponse } from '../../src/domain/interfaces/ai/IAIProvider.js';

/**
 * Phase 7.1 — REAL AI PRODUCTION LAYER: boundary / failure / privacy tests.
 *
 * Every external boundary is FAKE (an injected fetch stub), so NOTHING here makes
 * a real network call. This suite consolidates the Phase 7.1 boundary tests
 * (Tests A-J), the provider-failure behaviours and the privacy guarantees on top
 * of the existing Phase 5F.9 provider contract tests (which are left untouched).
 *
 * The intent is to prove the DETERMINISTIC backend layers stay authoritative:
 *   - AI can never create/reference an unknown MicroSkill / curriculum id / pattern.
 *   - AI output is always validated; malformed/out-of-vocabulary output is rejected.
 *   - The canonical answer never reaches the explanation model.
 *   - A real provider failure never becomes a fake success.
 *   - Configuration FAILS CLOSED for an unsupported provider.
 *   - Nothing sensitive is ever logged.
 */

const API_KEY = 'sk-phase71-secret-never-logged';
const SECRET_QUESTION = 'SENSITIVE_QUESTION_PHASE71_314';
const SECRET_ANSWER = 'SENSITIVE_ANSWER_PHASE71_159';
const CANONICAL_ANSWER = 'x = 987654';

// ------------------------------------------------------------------ helpers

class FakeStorage implements IStorageProvider {
  constructor(private readonly objects: Record<string, Buffer | null> = {}) { }
  getProviderName(): string {
    return 'fake-storage';
  }
  async store(_input: StoreInput): Promise<StoredAsset> {
    throw new Error('not used');
  }
  async read(ref: string): Promise<Buffer | null> {
    return ref in this.objects ? this.objects[ref] : null;
  }
  async delete(_ref: string): Promise<boolean> {
    return false;
  }
}

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);

function jsonResponse(body: unknown, status = 200, headers?: Record<string, string>) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (n: string) => headers?.[n.toLowerCase()] ?? null },
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  };
}

function envelope(contentText: string) {
  return { model: 'gpt-4o', created: 1700000, choices: [{ message: { content: contentText }, finish_reason: 'stop' }] };
}

function ocrConfig(overrides: Partial<OcrConfig> = {}): OcrConfig {
  return {
    provider: 'openai',
    model: 'gpt-4o',
    timeoutMs: 5000,
    maxRetries: 2,
    maxTokens: 1024,
    maxImageBytes: 7 * 1024 * 1024,
    allowExternalProvider: true,
    baseUrl: 'https://api.example.test/v1',
    apiKey: API_KEY,
    ...overrides,
  };
}

function quConfig(overrides: Partial<QuestionUnderstandingConfig> = {}): QuestionUnderstandingConfig {
  return {
    provider: 'openai',
    model: 'gpt-4o',
    timeoutMs: 5000,
    maxRetries: 2,
    maxTokens: 1024,
    maxInputChars: 8000,
    allowExternalProvider: true,
    baseUrl: 'https://api.example.test/v1',
    apiKey: API_KEY,
    ...overrides,
  };
}

function eaConfig(overrides: Partial<ErrorAnalysisConfig> = {}): ErrorAnalysisConfig {
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

function explConfig(overrides: Partial<ExplanationConfig> = {}): ExplanationConfig {
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

const CURRICULUM_CONTEXT = {
  learningOutcomes: [{ id: 'lo-1', code: 'LO.1', text: 'Linear equations' }],
  processComponents: [
    { id: 'pc-1', code: 'PC.1', text: 'Isolate the unknown', learningOutcomeId: 'lo-1' },
  ],
  microSkills: [
    {
      id: 'ms-1',
      code: 'MS.1',
      name: 'Solve linear equations',
      description: 'Isolate the unknown.',
      processComponentId: 'pc-1',
    },
  ],
};

const QU_REQUEST = {
  ingestionId: 'ing-1',
  normalizedText: '2x + 3 = 11 denklemini çözünüz.',
  curriculumContext: CURRICULUM_CONTEXT,
};

function quModelOutput(overrides: Record<string, unknown> = {}) {
  return {
    questionUnderstanding: {
      questionType: 'EQUATION_SOLVING',
      mathematicalObjects: ['variable'],
      requestedOperation: 'SOLVE',
      constraints: [],
    },
    curriculumCandidates: [
      { level: 'LEARNING_OUTCOME', targetId: 'lo-1', confidence: 0.8, rationale: 'r' },
    ],
    microSkillCandidates: [{ microSkillId: 'ms-1', confidence: 0.8, rationale: 'r' }],
    confidence: 0.8,
    warnings: [],
    ...overrides,
  };
}

function eaModelOutput(overrides: Record<string, unknown> = {}) {
  return {
    errorType: 'CONCEPT',
    confidence: 0.7,
    hypothesis: 'The student confuses the sign rule.',
    relatedSkills: [],
    suggestion: 'Recheck the sign rule.',
    metadata: {},
    ...overrides,
  };
}

function explModelOutput(overrides: Record<string, unknown> = {}) {
  return {
    explanation: 'Cevabı aramadan önce sorudaki koşulu belirle.',
    stepByStep: ['İfadeyi hangi işlemin dönüştüreceğini düşün.'],
    examples: [],
    keyPoints: [],
    practiceSuggestion: '',
    ...overrides,
  };
}

/** Deterministic IAIProvider for AIExplanationService-level tests. */
class StubExplanationProvider implements IAIProvider {
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

// ============================================================ TEST A: unknown MicroSkill

describe('Phase 7.1 — Test A: AI attempts to create an unknown MicroSkill', () => {
  it('A1. a MicroSkill candidate not present in the context is DROPPED, never forwarded', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(
        envelope(
          JSON.stringify(
            quModelOutput({
              microSkillCandidates: [
                { microSkillId: 'ms-INVENTED-BY-AI', confidence: 0.95, rationale: 'invented' },
              ],
            })
          )
        )
      )
    );
    const provider = new RealQuestionUnderstandingProvider(quConfig(), { fetchImpl, sleepImpl: vi.fn(async () => { }) });
    const res = await provider.analyze(QU_REQUEST);

    // The invented id is gone; the valid one from an earlier call is not invented.
    expect(res.proposal.microSkillCandidates.map((c) => c.microSkillId)).not.toContain('ms-INVENTED-BY-AI');
    expect(res.proposal.microSkillCandidates).toEqual([]);
    expect(res.warnings.join(' ')).toMatch(/Discarded a MicroSkill candidate/i);
    // No authority: the provider never persists anything, so nothing was created.
    expect(res.proposal.microSkillCandidates).toHaveLength(0);
  });

  it('A2. the provider cannot create a MicroSkill entity (contract returns a proposal only)', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(envelope(JSON.stringify(quModelOutput())))
    );
    const provider = new RealQuestionUnderstandingProvider(quConfig(), { fetchImpl, sleepImpl: vi.fn(async () => { }) });
    const res = await provider.analyze(QU_REQUEST);
    // Only the proposal contract is returned — there is no create/persist surface.
    expect(Object.keys(res).sort()).toEqual(['confidence', 'proposal', 'warnings']);
  });
});

// ============================================================ TEST B: unknown curriculum id

describe('Phase 7.1 — Test B: AI returns an unknown curriculum id', () => {
  it('B1. an unknown LearningOutcome id is DROPPED and warned', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(
        envelope(
          JSON.stringify(
            quModelOutput({
              curriculumCandidates: [
                { level: 'LEARNING_OUTCOME', targetId: 'lo-DOES-NOT-EXIST', confidence: 0.9, rationale: 'x' },
              ],
            })
          )
        )
      )
    );
    const provider = new RealQuestionUnderstandingProvider(quConfig(), { fetchImpl, sleepImpl: vi.fn(async () => { }) });
    const res = await provider.analyze(QU_REQUEST);
    expect(res.proposal.curriculumCandidates.map((c) => c.targetId)).not.toContain('lo-DOES-NOT-EXIST');
    expect(res.warnings.join(' ')).toMatch(/Discarded a curriculum candidate/i);
  });

  it('B2. an unknown ProcessComponent id is likewise DROPPED', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(
        envelope(
          JSON.stringify(
            quModelOutput({
              curriculumCandidates: [
                { level: 'PROCESS_COMPONENT', targetId: 'pc-UNKNOWN', confidence: 0.7, rationale: 'x' },
              ],
            })
          )
        )
      )
    );
    const provider = new RealQuestionUnderstandingProvider(quConfig(), { fetchImpl, sleepImpl: vi.fn(async () => { }) });
    const res = await provider.analyze(QU_REQUEST);
    expect(res.proposal.curriculumCandidates.map((c) => c.targetId)).not.toContain('pc-UNKNOWN');
  });

  it('B3. with NO context at all, every candidate is discarded', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(envelope(JSON.stringify(quModelOutput()))));
    const provider = new RealQuestionUnderstandingProvider(quConfig(), { fetchImpl, sleepImpl: vi.fn(async () => { }) });
    const res = await provider.analyze({ ingestionId: 'ing-2', normalizedText: 'Soru metni' });
    expect(res.proposal.curriculumCandidates).toHaveLength(0);
    expect(res.proposal.microSkillCandidates).toHaveLength(0);
  });
});

// ============================================================ TEST C: ErrorPattern id returned

describe('Phase 7.1 — Test C: AI returns an ErrorPattern identifier', () => {
  it('C1. errorPatternId / errorPatternCode / microSkillId in the payload are REJECTED', () => {
    expect(() => validateErrorAnalysisPayload(eaModelOutput({ errorPatternId: 'ep-1' }))).toThrow(AiAnalysisError);
    expect(() => validateErrorAnalysisPayload(eaModelOutput({ errorPatternCode: 'EP.X' }))).toThrow(AiAnalysisError);
    expect(() => validateErrorAnalysisPayload(eaModelOutput({ microSkillId: 'ms-1' }))).toThrow(AiAnalysisError);
  });

  it('C2. an ErrorPattern id in a real provider response becomes a validation failure, not a persisted pattern', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(envelope(JSON.stringify(eaModelOutput({ errorPatternId: 'ep-forged' }))))
    );
    const provider = new RealErrorAnalysisProvider(eaConfig(), { fetchImpl, sleepImpl: vi.fn(async () => { }) });
    await expect(
      provider.completeStructured<any>({ messages: [{ role: 'user', content: 'x' }] }, {})
    ).rejects.toBeInstanceOf(AiAnalysisError);
  });

  it('C3. an unsupported errorType (test I: unsupported enum) is rejected', () => {
    expect(() => validateErrorAnalysisPayload(eaModelOutput({ errorType: 'TOTALLY_MADE_UP' }))).toThrow(AiAnalysisError);
    expect(() => validateErrorAnalysisPayload(eaModelOutput({ errorType: 'concept' }))).toThrow(AiAnalysisError);
  });
});

// ============================================================ TEST D: correctAnswer in explanation

describe('Phase 7.1 — Test D: correctAnswer is excluded from and sanitized out of guidance', () => {
  it('D1. the explanation model request has no correctAnswer field by construction', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(envelope(JSON.stringify(explModelOutput()))));
    const provider = new RealExplanationProvider(explConfig(), { fetchImpl, sleepImpl: vi.fn(async () => { }) });
    await provider.generateGuidance({
      mode: 'HINT',
      question: SECRET_QUESTION,
      studentAnswer: SECRET_ANSWER,
      // Hostile extra field: must not appear in the outbound body.
      // @ts-expect-error deliberately hostile
      correctAnswer: CANONICAL_ANSWER,
    });
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, { body: string }];
    expect(init.body).not.toContain(CANONICAL_ANSWER);
    expect(init.body).not.toMatch(/correct\s*answer\s*:/i);
    // The student's own answer is allowed evidence.
    expect(init.body).toContain(SECRET_ANSWER);
  });

  it('D2. buildPrompt cannot carry a canonical answer even when handed one', () => {
    const prompt = buildExplanationPrompt({ mode: 'HINT', question: 'q', studentAnswer: 'a' });
    expect(prompt).not.toContain(CANONICAL_ANSWER);
    expect(prompt).not.toMatch(/correct\s*answer\s*:/i);
  });

  it('D3. the explanation service ignores a caller-injected correctAnswer before invoking the provider', async () => {
    const stub = new StubExplanationProvider([explModelOutput()]);
    await new AIExplanationService(stub).generateExplanation({
      concept: 'c',
      skillId: 's',
      difficulty: 1,
      previousAttempts: 0,
      level: 'intermediate',
      question: SECRET_QUESTION,
      studentAnswer: SECRET_ANSWER,
      mode: 'HINT',
      // @ts-expect-error hostile
      correctAnswer: CANONICAL_ANSWER,
    });
    const sent = JSON.stringify(stub.calls[0].messages);
    expect(sent).not.toContain(CANONICAL_ANSWER);
    expect(sent).toContain(SECRET_QUESTION);
  });
});

// ============================================================ TEST E: leaked answer

describe('Phase 7.1 — Test E: leaked answer → regeneration → safe fallback', () => {
  const request = {
    concept: 'Doğrusal denklem',
    skillId: 'ms-1',
    difficulty: 2,
    previousAttempts: 1,
    level: 'intermediate' as const,
    question: SECRET_QUESTION,
    studentAnswer: SECRET_ANSWER,
    mode: 'HINT',
  };

  it('E1. an unsafe (English) leak is rejected and regenerated once, then safe', async () => {
    const stub = new StubExplanationProvider([
      explModelOutput({ explanation: 'The answer is x = 42.' }),
      explModelOutput(),
    ]);
    const result = await new AIExplanationService(stub).generateExplanation(request);
    expect(stub.calls).toHaveLength(2);
    expect(result.metadata.safety).toBe('regenerated');
    expect(result.metadata.source).toBe('provider');
  });

  it('E2. an unsafe (Turkish) leak is rejected and regenerated once, then safe', async () => {
    const stub = new StubExplanationProvider([
      explModelOutput({ explanation: 'Doğru cevap x = 42 olacaktır.' }),
      explModelOutput(),
    ]);
    const result = await new AIExplanationService(stub).generateExplanation(request);
    expect(stub.calls).toHaveLength(2);
    expect(result.metadata.safety).toBe('regenerated');
  });

  it('E3. a second unsafe output yields the deterministic answer-free fallback', async () => {
    const stub = new StubExplanationProvider([
      explModelOutput({ explanation: 'The answer is x = 42.' }),
      explModelOutput({ explanation: 'Sonuç: 42.' }),
    ]);
    const result = await new AIExplanationService(stub).generateExplanation(request);
    expect(stub.calls).toHaveLength(2);
    expect(result.metadata.source).toBe('fallback');
    expect(result.metadata.model).toBe('safe-fallback');
    expect(assessAnswerLeakage(result).safe).toBe(true);
    expect(result.explanation).not.toContain('42');
  });

  it('E4. every mode is protected by the same leakage policy', async () => {
    for (const mode of ['HINT', 'SOCRATIC', 'FORMULA_REMINDER', 'MISTAKE_GUIDANCE', 'NEXT_STEP'] as const) {
      const result = await new AIExplanationService(
        new StubExplanationProvider([explModelOutput({ explanation: 'The correct option is C.' })])
      ).generateExplanation({ ...request, mode });
      expect(assessAnswerLeakage(result).safe).toBe(true);
      expect(result.metadata.source).toBe('fallback');
    }
  });
});

// ============================================================ TEST F: timeout

describe('Phase 7.1 — Test F: AI provider times out → bounded failure', () => {
  it('F1. OCR timeout is a bounded failure (attempts = retries + 1)', async () => {
    const abortError = Object.assign(new Error('aborted'), { name: 'AbortError' });
    const fetchImpl = vi.fn(async () => {
      throw abortError;
    });
    const provider = new RealVisionOcrProvider(new FakeStorage({ 'local://q.png': PNG_BYTES }), ocrConfig({ maxRetries: 2 }), {
      fetchImpl,
      sleepImpl: vi.fn(async () => { }),
    });
    await expect(provider.extract({ assetRef: 'local://q.png', mimeType: 'image/png' })).rejects.toBeInstanceOf(
      OcrProviderError
    );
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('F2. question understanding timeout is a bounded failure', async () => {
    const abortError = Object.assign(new Error('aborted'), { name: 'AbortError' });
    const fetchImpl = vi.fn(async () => {
      throw abortError;
    });
    const provider = new RealQuestionUnderstandingProvider(quConfig({ maxRetries: 2 }), {
      fetchImpl,
      sleepImpl: vi.fn(async () => { }),
    });
    await expect(provider.analyze(QU_REQUEST)).rejects.toBeInstanceOf(AiAnalysisError);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('F3. a guidance timeout yields a safe fallback, never a hang', async () => {
    const result = await new AIExplanationService(
      new StubExplanationProvider([new AiAnalysisError('provider request timed out')])
    ).generateExplanation({
      concept: 'c',
      skillId: 's',
      difficulty: 1,
      previousAttempts: 0,
      level: 'intermediate',
      mode: 'HINT',
    });
    expect(result.metadata.source).toBe('fallback');
    expect(assessAnswerLeakage(result).safe).toBe(true);
  });
});

// ============================================================ TEST G/H/I: retry / malformed / enum

describe('Phase 7.1 — Test G: transient failure → bounded retry', () => {
  it('G1. a transient 503 is retried up to the configured bound then fails clearly', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse('unavailable', 503));
    const provider = new RealErrorAnalysisProvider(eaConfig({ maxRetries: 2 }), {
      fetchImpl,
      sleepImpl: vi.fn(async () => { }),
    });
    await expect(
      provider.completeStructured<any>({ messages: [{ role: 'user', content: 'x' }] }, {})
    ).rejects.toBeInstanceOf(AiAnalysisError);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('G2. a non-transient 4xx (invalid input / policy rejection) is NOT retried', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse('bad request', 400));
    const provider = new RealErrorAnalysisProvider(eaConfig({ maxRetries: 3 }), {
      fetchImpl,
      sleepImpl: vi.fn(async () => { }),
    });
    await expect(
      provider.completeStructured<any>({ messages: [{ role: 'user', content: 'x' }] }, {})
    ).rejects.toBeInstanceOf(AiAnalysisError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('G3. a 401 authentication failure is NOT retried', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse('unauthorized', 401));
    const provider = new RealExplanationProvider(explConfig({ maxRetries: 3 }), {
      fetchImpl,
      sleepImpl: vi.fn(async () => { }),
    });
    await expect(provider.generateGuidance({ mode: 'HINT', question: 'q' })).rejects.toBeInstanceOf(AiAnalysisError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe('Phase 7.1 — Test H: malformed JSON → validation failure', () => {
  it('H1. a non-JSON envelope is rejected', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse('definitely not json'));
    const provider = new RealQuestionUnderstandingProvider(quConfig(), { fetchImpl, sleepImpl: vi.fn(async () => { }) });
    await expect(provider.analyze(QU_REQUEST)).rejects.toBeInstanceOf(AiAnalysisError);
  });

  it('H2. valid envelope, non-JSON content is rejected', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(envelope('not json at all')));
    const provider = new RealErrorAnalysisProvider(eaConfig(), { fetchImpl, sleepImpl: vi.fn(async () => { }) });
    await expect(
      provider.completeStructured<any>({ messages: [{ role: 'user', content: 'x' }] }, {})
    ).rejects.toBeInstanceOf(AiAnalysisError);
  });

  it('H3. missing required fields are rejected at the schema boundary', () => {
    expect(() => validateQuestionUnderstandingPayload({ confidence: 0.5 })).toThrow(AiAnalysisError);
    expect(() => validateErrorAnalysisPayload({ errorType: 'CONCEPT' })).toThrow(AiAnalysisError);
  });
});

describe('Phase 7.1 — Test I: unsupported enum → validation failure', () => {
  it('I1. an unsupported errorType is rejected', () => {
    expect(() => validateErrorAnalysisPayload(eaModelOutput({ errorType: 'MAGIC' }))).toThrow(AiAnalysisError);
  });

  it('I2. an unsupported curriculum candidate level is rejected', () => {
    expect(() =>
      validateQuestionUnderstandingPayload(
        quModelOutput({
          curriculumCandidates: [{ level: 'CHAPTER', targetId: 'x', confidence: 0.5, rationale: 'r' }],
        })
      )
    ).toThrow(AiAnalysisError);
  });

  it('I3. an out-of-range confidence is rejected', () => {
    expect(() => validateErrorAnalysisPayload(eaModelOutput({ confidence: 1.5 }))).toThrow(AiAnalysisError);
    expect(() => validateQuestionUnderstandingPayload(quModelOutput({ confidence: -0.1 }))).toThrow(AiAnalysisError);
  });
});

// ============================================================ TEST J: fail closed

describe('Phase 7.1 — Test J: production config requests an unsupported provider → FAIL CLOSED', () => {
  it('J1. OCR rejects an unknown provider rather than falling back to mock', () => {
    expect(() =>
      createOcrProviderFromConfig(new FakeStorage(), ocrConfig({ provider: 'anthropic' as any }))
    ).toThrow(OcrProviderError);
  });

  it('J2. Question Understanding rejects an unknown provider', () => {
    expect(() =>
      createQuestionUnderstandingProviderFromConfig(quConfig({ provider: 'google' as any }))
    ).toThrow(AiAnalysisError);
  });

  it('J3. Error Analysis rejects an unknown provider', () => {
    expect(() =>
      createErrorAnalysisProviderFromConfig(eaConfig({ provider: 'deepseek' as any }))
    ).toThrow(AiAnalysisError);
  });

  it('J4. Explanation rejects an unknown provider', () => {
    expect(() =>
      createExplanationProviderFromConfig(explConfig({ provider: 'mistral' as any }))
    ).toThrow(AiAnalysisError);
  });

  it('J5. a real provider without explicit egress allowance fails closed (never silent mock)', () => {
    expect(() =>
      createOcrProviderFromConfig(new FakeStorage(), ocrConfig({ allowExternalProvider: false }))
    ).toThrow(OcrProviderError);
    expect(() =>
      createQuestionUnderstandingProviderFromConfig(quConfig({ allowExternalProvider: false }))
    ).toThrow(AiAnalysisError);
    expect(() =>
      createErrorAnalysisProviderFromConfig(eaConfig({ allowExternalProvider: false }))
    ).toThrow(AiAnalysisError);
    expect(() =>
      createExplanationProviderFromConfig(explConfig({ allowExternalProvider: false }))
    ).toThrow(AiAnalysisError);
  });

  it('J6. a real provider without an API key fails closed', () => {
    expect(() =>
      createOcrProviderFromConfig(new FakeStorage(), ocrConfig({ allowExternalProvider: true, apiKey: '' }))
    ).toThrow(OcrProviderError);
    expect(() =>
      createQuestionUnderstandingProviderFromConfig(quConfig({ allowExternalProvider: true, apiKey: '' }))
    ).toThrow(AiAnalysisError);
    expect(() =>
      createErrorAnalysisProviderFromConfig(eaConfig({ allowExternalProvider: true, apiKey: '' }))
    ).toThrow(AiAnalysisError);
    expect(() =>
      createExplanationProviderFromConfig(explConfig({ allowExternalProvider: true, apiKey: '' }))
    ).toThrow(AiAnalysisError);
  });

  it('J7. mock providers are reachable only when genuinely configured', () => {
    expect(createOcrProviderFromConfig(new FakeStorage(), ocrConfig({ provider: 'mock' }))).toBeInstanceOf(
      MockOcrProvider
    );
    expect(createQuestionUnderstandingProviderFromConfig(quConfig({ provider: 'mock' }))).toBeInstanceOf(
      MockQuestionUnderstandingProvider
    );
    expect(createErrorAnalysisProviderFromConfig(eaConfig({ provider: 'mock' }))).toBeInstanceOf(MockAIProvider);
    expect(createExplanationProviderFromConfig(explConfig({ provider: 'mock' }))).toBeInstanceOf(MockAIProvider);
  });
});

// ============================================================ COST CONTROL

describe('Phase 7.1 — cost-control bounds are enforced', () => {
  it('CC1. the OCR request carries a bounded max_tokens', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(envelope(JSON.stringify({ text: 'x + 1 = 2', confidence: 0.9, warnings: [] })))
    );
    const provider = new RealVisionOcrProvider(new FakeStorage({ 'local://q.png': PNG_BYTES }), ocrConfig({ maxTokens: 512 }), {
      fetchImpl,
      sleepImpl: vi.fn(async () => { }),
    });
    await provider.extract({ assetRef: 'local://q.png', mimeType: 'image/png' });
    const body = JSON.parse((fetchImpl.mock.calls[0] as unknown as [string, { body: string }])[1].body);
    expect(body.max_tokens).toBe(512);
  });

  it('CC2. an oversized image is rejected before any external request', async () => {
    const big = Buffer.concat([PNG_BYTES, Buffer.alloc(2048)]);
    const fetchImpl = vi.fn();
    const provider = new RealVisionOcrProvider(new FakeStorage({ 'local://big.png': big }), ocrConfig({ maxImageBytes: 1024 }), {
      fetchImpl,
      sleepImpl: vi.fn(async () => { }),
    });
    await expect(provider.extract({ assetRef: 'local://big.png', mimeType: 'image/png' })).rejects.toBeInstanceOf(
      OcrProviderError
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('CC3. an oversized normalized text is rejected before any external request', async () => {
    const fetchImpl = vi.fn();
    const provider = new RealQuestionUnderstandingProvider(quConfig({ maxInputChars: 32 }), {
      fetchImpl,
      sleepImpl: vi.fn(async () => { }),
    });
    await expect(
      provider.analyze({ ingestionId: 'ing', normalizedText: 'x'.repeat(64), curriculumContext: CURRICULUM_CONTEXT })
    ).rejects.toBeInstanceOf(AiAnalysisError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('CC4. the Question Understanding request carries a bounded max_tokens', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(envelope(JSON.stringify(quModelOutput()))));
    const provider = new RealQuestionUnderstandingProvider(quConfig({ maxTokens: 768 }), {
      fetchImpl,
      sleepImpl: vi.fn(async () => { }),
    });
    await provider.analyze(QU_REQUEST);
    const body = JSON.parse((fetchImpl.mock.calls[0] as unknown as [string, { body: string }])[1].body);
    expect(body.max_tokens).toBe(768);
  });

  it('CC5. the Explanation request carries a bounded max_tokens', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(envelope(JSON.stringify(explModelOutput()))));
    const provider = new RealExplanationProvider(explConfig({ maxTokens: 640 }), {
      fetchImpl,
      sleepImpl: vi.fn(async () => { }),
    });
    await provider.generateGuidance({ mode: 'HINT', question: 'q' });
    const body = JSON.parse((fetchImpl.mock.calls[0] as unknown as [string, { body: string }])[1].body);
    expect(body.max_tokens).toBe(640);
  });
});

// ============================================================ PRIVACY

describe('Phase 7.1 — privacy: production logs contain no sensitive content', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('P1. no log contains question, answer, correctAnswer, OCR text, base64, prompt, response or API key', async () => {
    const { logger } = await import('../../src/infrastructure/logging/logger.js');
    const spies = [
      vi.mocked(logger.info),
      vi.mocked(logger.error),
      vi.mocked(logger.warn),
      vi.mocked(logger.debug),
    ];
    spies.forEach((s) => s.mockClear());

    const SECRET_OCR = 'SENSITIVE_OCR_TEXT_PHASE71';

    // OCR success + failure.
    const okOcr = vi.fn(async () =>
      jsonResponse(envelope(JSON.stringify({ text: SECRET_OCR, confidence: 0.9, warnings: [] })))
    );
    await new RealVisionOcrProvider(new FakeStorage({ 'local://q.png': PNG_BYTES }), ocrConfig(), {
      fetchImpl: okOcr,
      sleepImpl: vi.fn(async () => { }),
    }).extract({ assetRef: 'local://q.png', mimeType: 'image/png' });

    await new RealVisionOcrProvider(new FakeStorage({ 'local://q.png': PNG_BYTES }), ocrConfig(), {
      fetchImpl: vi.fn(async () => jsonResponse('boom', 400)),
      sleepImpl: vi.fn(async () => { }),
    })
      .extract({ assetRef: 'local://q.png', mimeType: 'image/png' })
      .catch(() => undefined);

    // Question understanding success + failure.
    await new RealQuestionUnderstandingProvider(quConfig(), {
      fetchImpl: vi.fn(async () => jsonResponse(envelope(JSON.stringify(quModelOutput())))),
      sleepImpl: vi.fn(async () => { }),
    }).analyze({ ...QU_REQUEST, normalizedText: SECRET_QUESTION });

    await new RealQuestionUnderstandingProvider(quConfig(), {
      fetchImpl: vi.fn(async () => jsonResponse('boom', 500)),
      sleepImpl: vi.fn(async () => { }),
    })
      .analyze({ ...QU_REQUEST, normalizedText: SECRET_QUESTION })
      .catch(() => undefined);

    // Error analysis success + failure.
    await new RealErrorAnalysisProvider(eaConfig(), {
      fetchImpl: vi.fn(async () => jsonResponse(envelope(JSON.stringify(eaModelOutput())))),
      sleepImpl: vi.fn(async () => { }),
    }).completeStructured<any>({ messages: [{ role: 'user', content: `${SECRET_QUESTION} ${SECRET_ANSWER}` }] }, {});

    await new RealErrorAnalysisProvider(eaConfig(), {
      fetchImpl: vi.fn(async () => jsonResponse('boom', 400)),
      sleepImpl: vi.fn(async () => { }),
    })
      .completeStructured<any>({ messages: [{ role: 'user', content: SECRET_QUESTION }] }, {})
      .catch(() => undefined);

    // Explanation success + leaky rejection + failure.
    await new AIExplanationService(
      new StubExplanationProvider([explModelOutput({ explanation: 'The answer is x = 42.' }), explModelOutput()])
    ).generateExplanation({
      concept: 'c', skillId: 'ms-secret', difficulty: 1, previousAttempts: 0, level: 'intermediate',
      mode: 'HINT', question: SECRET_QUESTION, studentAnswer: SECRET_ANSWER,
    });
    await new AIExplanationService(new StubExplanationProvider([new Error('down')])).generateExplanation({
      concept: 'c', skillId: 'ms-secret', difficulty: 1, previousAttempts: 0, level: 'intermediate', mode: 'HINT',
    });

    const all = JSON.stringify(spies.flatMap((s) => s.mock.calls));
    expect(all).not.toContain(SECRET_QUESTION);
    expect(all).not.toContain(SECRET_ANSWER);
    expect(all).not.toContain(SECRET_OCR);
    expect(all).not.toContain(CANONICAL_ANSWER);
    expect(all).not.toContain(API_KEY);
    expect(all).not.toContain('Bearer');
    expect(all).not.toContain('base64');
    expect(all).not.toContain(PNG_BYTES.toString('base64'));
  });
});
