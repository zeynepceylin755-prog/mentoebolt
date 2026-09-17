import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  RealQuestionUnderstandingProvider,
  validatePayload,
  deriveConfidence,
} from '../../src/infrastructure/ai/question-understanding/RealQuestionUnderstandingProvider.js';
import { createQuestionUnderstandingProviderFromConfig } from '../../src/infrastructure/ai/question-understanding/QuestionUnderstandingProviderFactory.js';
import { MockQuestionUnderstandingProvider } from '../../src/infrastructure/ai/providers/MockQuestionUnderstandingProvider.js';
import { AiAnalysisError } from '../../src/domain/errors/QuestionAnalysisErrors.js';
import type { QuestionUnderstandingConfig } from '../../src/infrastructure/ai/question-understanding/config/QuestionUnderstandingConfig.js';

/**
 * Phase 5F.9-B — Real question understanding provider.
 *
 * The HTTP boundary and the sleep function are injected, so NOTHING here makes a
 * real external call.
 */

const LO = { id: 'lo-1', code: 'LO.1', text: 'Explain statistical measures.' };
const PC = { id: 'pc-1', code: 'PC.1', text: 'Compute the arithmetic mean.', learningOutcomeId: 'lo-1' };
const MS = {
  id: 'ms-1',
  code: 'MS.1',
  name: 'Compute arithmetic mean',
  description: 'Average a data set.',
  processComponentId: 'pc-1',
};

const CONTEXT = {
  learningOutcomes: [LO],
  processComponents: [PC],
  microSkills: [MS],
};

function makeConfig(overrides: Partial<QuestionUnderstandingConfig> = {}): QuestionUnderstandingConfig {
  return {
    provider: 'openai',
    model: 'gpt-4o',
    timeoutMs: 5000,
    maxRetries: 2,
    maxTokens: 1024,
    maxInputChars: 8000,
    allowExternalProvider: true,
    baseUrl: 'https://api.example.test/v1',
    apiKey: 'test-key',
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
function envelope(contentText: string, extra: Record<string, unknown> = {}) {
  const message = { content: contentText };
  const choice = { message: message };
  const body = { model: 'gpt-4o-2024-08-06', created: 1700000, choices: [choice] };
  return { ...body, ...extra };
}

/** Build a valid model payload. */
function payload(overrides: Record<string, unknown> = {}) {
  return {
    questionUnderstanding: {
      questionType: 'STATISTICS',
      mathematicalObjects: ['data_set', 'mean'],
      requestedOperation: 'CALCULATE',
      constraints: [],
    },
    curriculumCandidates: [
      { level: 'LEARNING_OUTCOME', targetId: 'lo-1', confidence: 0.9, rationale: 'mean is a statistical measure' },
      { level: 'PROCESS_COMPONENT', targetId: 'pc-1', confidence: 0.85, rationale: 'compute the mean' },
    ],
    microSkillCandidates: [
      { microSkillId: 'ms-1', confidence: 0.88, rationale: 'averaging a data set' },
    ],
    confidence: 0.87,
    warnings: [],
    ...overrides,
  };
}

function build(fetchImpl: any, config = makeConfig(), sleepImpl = vi.fn(async () => {})) {
  const provider = new RealQuestionUnderstandingProvider(config, { fetchImpl, sleepImpl });
  return { provider, sleepImpl };
}

const REQUEST = {
  ingestionId: 'ing-1',
  normalizedText: 'Verilen verilerin aritmetik ortalamasını bulunuz.',
  curriculumContext: CONTEXT,
};

describe('Phase 5F.9-B — Provider contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('1. valid structured response', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(envelope(JSON.stringify(payload()))));
    const { provider } = build(fetchImpl);
    const result = await provider.analyze(REQUEST);

    expect(result.proposal.ingestionId).toBe('ing-1');
    expect(result.proposal.curriculumCandidates).toHaveLength(2);
    expect(result.proposal.microSkillCandidates).toHaveLength(1);
    expect(result.proposal.modelMetadata.provider).toBe('question-understanding-openai');
    expect(result.confidence).toBeCloseTo(0.87);
    expect(result.warnings).toEqual([]);
  });

  it('2. malformed JSON rejected', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse('definitely not json'));
    const { provider } = build(fetchImpl);
    await expect(provider.analyze(REQUEST)).rejects.toBeInstanceOf(AiAnalysisError);

    const badContent = vi.fn(async () => jsonResponse(envelope('not json either')));
    await expect(build(badContent).provider.analyze(REQUEST)).rejects.toBeInstanceOf(AiAnalysisError);
  });

  it('3. missing required field rejected', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(envelope(JSON.stringify({ confidence: 0.9, warnings: [] })))
    );
    const { provider } = build(fetchImpl);
    await expect(provider.analyze(REQUEST)).rejects.toBeInstanceOf(AiAnalysisError);
  });

  it('4/5. invalid confidence (non-numeric or out of [0,1]) rejected', () => {
    expect(() => validatePayload({ ...payload(), confidence: 'high' })).toThrow(AiAnalysisError);
    expect(() => validatePayload({ ...payload(), confidence: 1.5 })).toThrow(AiAnalysisError);
    expect(() => validatePayload({ ...payload(), confidence: -0.2 })).toThrow(AiAnalysisError);
    expect(() => validatePayload({ ...payload(), confidence: Number.NaN })).toThrow(AiAnalysisError);
  });
});

describe('Phase 5F.9-B — Curriculum safety', () => {
  it('6/7. unknown LearningOutcome / ProcessComponent is dropped and warned', async () => {
    const invented = payload({
      curriculumCandidates: [
        { level: 'LEARNING_OUTCOME', targetId: 'lo-INVENTED', confidence: 0.9, rationale: 'x' },
        { level: 'PROCESS_COMPONENT', targetId: 'pc-INVENTED', confidence: 0.8, rationale: 'y' },
      ],
    });
    const fetchImpl = vi.fn(async () => jsonResponse(envelope(JSON.stringify(invented))));
    const result = await build(fetchImpl).provider.analyze(REQUEST);

    expect(result.proposal.curriculumCandidates).toHaveLength(0);
    expect(result.warnings.join(' ')).toContain('not present in the supplied context');
  });

  it('8. unknown MicroSkill is dropped and warned', async () => {
    const invented = payload({
      microSkillCandidates: [{ microSkillId: 'ms-INVENTED', confidence: 0.9, rationale: 'x' }],
    });
    const fetchImpl = vi.fn(async () => jsonResponse(envelope(JSON.stringify(invented))));
    const result = await build(fetchImpl).provider.analyze(REQUEST);
    expect(result.proposal.microSkillCandidates).toHaveLength(0);
    expect(result.warnings.join(' ')).toContain('not present in the supplied context');
  });

  it('9/10. only supplied curriculum candidates are accepted (mixed in/out)', async () => {
    const mixed = payload({
      curriculumCandidates: [
        { level: 'LEARNING_OUTCOME', targetId: 'lo-1', confidence: 0.9, rationale: 'real' },
        { level: 'PROCESS_COMPONENT', targetId: 'pc-INVENTED', confidence: 0.8, rationale: 'fake' },
      ],
      microSkillCandidates: [
        { microSkillId: 'ms-1', confidence: 0.8, rationale: 'real' },
        { microSkillId: 'ms-fake', confidence: 0.7, rationale: 'fake' },
      ],
    });
    const fetchImpl = vi.fn(async () => jsonResponse(envelope(JSON.stringify(mixed))));
    const result = await build(fetchImpl).provider.analyze(REQUEST);

    expect(result.proposal.curriculumCandidates.map((c) => c.targetId)).toEqual(['lo-1']);
    expect(result.proposal.microSkillCandidates.map((c) => c.microSkillId)).toEqual(['ms-1']);
  });

  it('with no context, all candidates are dropped and warned', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(envelope(JSON.stringify(payload()))));
    const result = await build(fetchImpl).provider.analyze({
      ingestionId: 'ing-1',
      normalizedText: 'Verilen verilerin aritmetik ortalamasını bulunuz.',
    });
    expect(result.proposal.curriculumCandidates).toHaveLength(0);
    expect(result.proposal.microSkillCandidates).toHaveLength(0);
    expect(result.confidence).toBeLessThanOrEqual(0.3);
  });
});

describe('Phase 5F.9-B — Math understanding', () => {
  async function analyzeText(text: string, modelConfidence = 0.8, warnings: string[] = []) {
    const p = payload({ confidence: modelConfidence, warnings });
    const fetchImpl = vi.fn(async () => jsonResponse(envelope(JSON.stringify(p))));
    return build(fetchImpl).provider.analyze({ ingestionId: 'ing-1', normalizedText: text, curriculumContext: CONTEXT });
  }

  it('11. fractions preserved through to the proposal', async () => {
    const res = await analyzeText('\\frac{1}{2} + \\frac{3}{4} ifadesinin değerini bulunuz.');
    expect(res.proposal.normalizedText).toContain('\\frac{1}{2}');
  });

  it('12. powers preserved', async () => {
    const res = await analyzeText('x^{2} + 5x + 6 = 0 denklemini çözünüz.');
    expect(res.proposal.normalizedText).toContain('x^{2}');
  });

  it('13. roots preserved', async () => {
    const res = await analyzeText('\\sqrt{x + 1} ifadesini sadeleştiriniz.');
    expect(res.proposal.normalizedText).toContain('\\sqrt{x + 1}');
  });

  it('14. inequalities preserved', async () => {
    const res = await analyzeText('2x + 1 ≤ 7 eşitsizliğini çözünüz.');
    expect(res.proposal.normalizedText).toContain('≤');
  });

  it('15. function notation preserved', async () => {
    const res = await analyzeText('f(x) = 3x - 2 fonksiyonu için f(4) değerini bulunuz.');
    expect(res.proposal.normalizedText).toContain('f(x)');
    expect(res.proposal.normalizedText).toContain('f(4)');
  });

  it('16. Turkish question text preserved', async () => {
    const res = await analyzeText('Aşağıdaki üçgenin çevresini hesaplayınız.');
    expect(res.proposal.normalizedText).toContain('üçgenin');
    expect(res.proposal.normalizedText).toContain('hesaplayınız');
  });

  it('17. ambiguous notation lowers confidence (warnings cap it)', () => {
    // Warnings (ambiguity) must cap confidence conservatively.
    expect(deriveConfidence(0.9, [{}], [{}], ['ambiguous: sin²x vs sin 2x'])).toBeLessThanOrEqual(0.6);
    // No candidates at all → strong cap.
    expect(deriveConfidence(0.9, [], [])).toBeLessThanOrEqual(0.3);
    // Never inflated above a safe ceiling.
    expect(deriveConfidence(1, [{}], [{}], [])).toBeLessThanOrEqual(0.95);
  });
});

describe('Phase 5F.9-B — Reliability', () => {
  it('18. timeout is transient and retried (then fails clearly)', async () => {
    const timeoutError = Object.assign(new Error('aborted'), { name: 'AbortError' });
    const fetchImpl = vi.fn(async () => {
      throw timeoutError;
    });
    const { provider, sleepImpl } = build(fetchImpl, makeConfig({ maxRetries: 2 }));
    await expect(provider.analyze(REQUEST)).rejects.toBeInstanceOf(AiAnalysisError);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(sleepImpl).toHaveBeenCalledTimes(2);
  });

  it('19. 429 is retried then succeeds', async () => {
    let call = 0;
    const fetchImpl = vi.fn(async () => {
      call++;
      if (call < 2) return jsonResponse('rate limited', 429, { 'retry-after': '1' });
      return jsonResponse(envelope(JSON.stringify(payload())));
    });
    const { provider } = build(fetchImpl, makeConfig({ maxRetries: 3 }));
    const res = await provider.analyze(REQUEST);
    expect(res.proposal.curriculumCandidates.length).toBeGreaterThan(0);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('20. 5xx is retried', async () => {
    let call = 0;
    const fetchImpl = vi.fn(async () => {
      call++;
      if (call === 1) return jsonResponse('boom', 503);
      return jsonResponse(envelope(JSON.stringify(payload())));
    });
    const { provider } = build(fetchImpl, makeConfig({ maxRetries: 2 }));
    await provider.analyze(REQUEST);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('21. exhausted retries fail clearly (no fake success)', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse('boom', 500));
    const { provider } = build(fetchImpl, makeConfig({ maxRetries: 1 }));
    await expect(provider.analyze(REQUEST)).rejects.toBeInstanceOf(AiAnalysisError);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('21b. non-retryable 4xx fails fast', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse('bad request', 400));
    const { provider, sleepImpl } = build(fetchImpl, makeConfig({ maxRetries: 3 }));
    await expect(provider.analyze(REQUEST)).rejects.toBeInstanceOf(AiAnalysisError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(sleepImpl).not.toHaveBeenCalled();
  });

  it('22. malformed model output does not produce a proposal', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(envelope(JSON.stringify({ nonsense: true }))));
    await expect(build(fetchImpl).provider.analyze(REQUEST)).rejects.toBeInstanceOf(AiAnalysisError);
  });

  it('12b. empty normalized text is rejected', async () => {
    const fetchImpl = vi.fn();
    await expect(
      build(fetchImpl).provider.analyze({ ingestionId: 'i', normalizedText: '   ' })
    ).rejects.toBeInstanceOf(AiAnalysisError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('Phase 5F.9-B — Security / logging', () => {
  it('23-27. no question content, prompt, response or API key is logged', async () => {
    const { logger } = await import('../../src/infrastructure/logging/logger.js');
    const infoSpy = vi.mocked(logger.info);
    const errorSpy = vi.mocked(logger.error);
    const warnSpy = vi.mocked(logger.warn);
    infoSpy.mockClear();
    errorSpy.mockClear();
    warnSpy.mockClear();

    const SECRET_QUESTION = 'SENSITIVE_STUDENT_QUESTION_771';
    const SECRET_ANSWER = 'SENSITIVE_STUDENT_ANSWER_992';
    const p = payload({ questionUnderstanding: { questionType: 'X', mathematicalObjects: [] } });

    // Success path (question contains secret content).
    const okFetch = vi.fn(async () => jsonResponse(envelope(JSON.stringify(p))));
    await build(okFetch).provider.analyze({
      ingestionId: 'ing-1',
      normalizedText: `${SECRET_QUESTION} ${SECRET_ANSWER}`,
      curriculumContext: CONTEXT,
    });

    // Error path.
    await build(vi.fn(async () => jsonResponse('nope', 400)))
      .provider.analyze({
        ingestionId: 'ing-1',
        normalizedText: SECRET_QUESTION,
        curriculumContext: CONTEXT,
      })
      .catch(() => undefined);

    const all = JSON.stringify([...infoSpy.mock.calls, ...errorSpy.mock.calls, ...warnSpy.mock.calls]);
    expect(all).not.toContain(SECRET_QUESTION);
    expect(all).not.toContain(SECRET_ANSWER);
    expect(all).not.toContain('test-key');
    expect(all).not.toContain('Bearer');
    // The prompt body (which embeds the question) must never be logged.
    expect(all).not.toContain('CURRICULUM CONTEXT');
  });
});

describe('Phase 5F.9-B — Factory', () => {
  it('returns MockQuestionUnderstandingProvider when configured as mock', () => {
    const provider = createQuestionUnderstandingProviderFromConfig(makeConfig({ provider: 'mock' }));
    expect(provider).toBeInstanceOf(MockQuestionUnderstandingProvider);
  });

  it('returns the real provider when openai + egress allowed + key present', () => {
    const provider = createQuestionUnderstandingProviderFromConfig(
      makeConfig({ provider: 'openai', allowExternalProvider: true, apiKey: 'k' }),
      { fetchImpl: vi.fn() }
    );
    expect(provider).toBeInstanceOf(RealQuestionUnderstandingProvider);
  });

  it('FAILS FAST without explicit egress allowance (never silent mock)', () => {
    expect(() =>
      createQuestionUnderstandingProviderFromConfig(
        makeConfig({ provider: 'openai', allowExternalProvider: false })
      )
    ).toThrow(AiAnalysisError);
  });

  it('FAILS FAST when the real provider has no API key', () => {
    expect(() =>
      createQuestionUnderstandingProviderFromConfig(
        makeConfig({ provider: 'openai', allowExternalProvider: true, apiKey: '' })
      )
    ).toThrow(AiAnalysisError);
  });
});
describe('Phase 5F.9-B — Integration with QuestionAnalysisService', () => {
  it('28/29/31/32/33/34/35. real provider flows through the existing pipeline without side-effect mutations', async () => {
    const { QuestionAnalysisService } = await import(
      '../../src/application/services/ingestion/QuestionAnalysisService.js'
    );
    const { QuestionNormalizationService } = await import(
      '../../src/application/services/ingestion/QuestionNormalizationService.js'
    );
    const { QuestionIngestionService } = await import(
      '../../src/application/services/ingestion/QuestionIngestionService.js'
    );
    const { INGESTION_STATES } = await import('../../src/domain/ingestion/ingestionStateMachine.js');
    const { prisma } = await import('../setup.js');

    // A real provider wired to a deterministic fake HTTP boundary.
    const fetchImpl = vi.fn(async () => jsonResponse(envelope(JSON.stringify(payload()))));
    const realProvider = new RealQuestionUnderstandingProvider(makeConfig({ maxRetries: 0 }), {
      fetchImpl,
    });

    // OCR stub (Phase 5F.9-A provider is not under test here).
    const stubOcr = {
      getProviderName: () => 'stub-ocr',
      isAvailable: async () => true,
      extract: vi.fn(async () => ({
        text: 'Verilen verilerin aritmetik ortalamasını bulunuz.',
        confidence: 0.9,
        metadata: { provider: 'stub-ocr' },
        warnings: [] as string[],
      })),
    };

    // Seed a minimal curriculum chain so the proposal references REAL ids.
    const uid = Math.random().toString(36).slice(2, 10);
    const version = await prisma.curriculumVersion.create({
      data: { code: 'P5F9B-CUR-' + uid, name: 'C', grade: 11, subject: 'Matematik', version: '1', source: 'TEST_FIXTURE' },
    });
    const theme = await prisma.theme.create({
      data: { curriculumVersionId: version.id, officialCode: 'P5F9B.T-' + uid, name: 'T', lessonHours: 1, sourceOrder: 1 },
    });
    const lo = await prisma.learningOutcome.create({
      data: { themeId: theme.id, officialCode: 'P5F9B.LO-' + uid, officialText: 'T', sourceOrder: 1 },
    });
    const pc = await prisma.processComponent.create({
      data: { learningOutcomeId: lo.id, officialCode: 'P5F9B.PC-' + uid, officialText: 'T', sourceOrder: 1 },
    });
    const ms = await prisma.microSkill.create({
      data: { processComponentId: pc.id, code: 'P5F9B.MS-' + uid, name: 'MS', description: 'd', source: 'TEST_FIXTURE', isActive: true },
    });

    // Make the fake model reference THESE ids (as a real context would).
    fetchImpl.mockImplementation(async () =>
      jsonResponse(
        envelope(
          JSON.stringify(
            payload({
              curriculumCandidates: [
                { level: 'LEARNING_OUTCOME', targetId: lo.id, confidence: 0.9, rationale: 'r' },
                { level: 'PROCESS_COMPONENT', targetId: pc.id, confidence: 0.85, rationale: 'r' },
              ],
              microSkillCandidates: [{ microSkillId: ms.id, confidence: 0.88, rationale: 'r' }],
            })
          )
        )
      )
    );

    const ingestionService = new QuestionIngestionService(prisma as any);
    const analysisService = new QuestionAnalysisService(
      prisma as any,
      undefined,
      stubOcr as any,
      realProvider,
      new QuestionNormalizationService()
    );

    const user = await prisma.user.create({
      data: {
        email: `p5f9b-${Date.now()}@example.com`,
        firstName: 'P5F9B',
        lastName: 'Student',
        role: 'STUDENT',
        passwordHash: 'h',
      },
    });
    await prisma.studentProfile.create({ data: { userId: user.id, grade: 11 } });

    const ingestion = await ingestionService.createIngestion(user.id, {
      ingestMethod: 'IMAGE_UPLOAD',
      originalAssetRef: 'local://stub.png',
      originalAssetMimeType: 'image/png',
    });

    // Analyze as a STUDENT: the real provider runs, validators run, but NO
    // candidate/mapping is persisted (staff-only artefact write).
    const result = await analysisService.analyzeIngestion(ingestion.id, user.id, 'STUDENT', {});
    expect(result.ingestionId).toBe(ingestion.id);
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    // The ingestion advanced along the EXISTING state machine and recorded a
    // parsing confidence; nothing else was written by the AI.
    const stored = await prisma.questionIngestion.findUnique({ where: { id: ingestion.id } });
    expect([INGESTION_STATES.ANALYZED, INGESTION_STATES.REVIEW_REQUIRED]).toContain(stored!.state);

    // 31/32: the AI provider cannot directly create mappings/candidates.
    expect(await prisma.questionSkillMapping.count()).toBe(0);
    expect(await prisma.curriculumCandidate.count()).toBe(0);
    // 33/34/35: no mastery/progress/ErrorPattern mutation.
    expect(await prisma.skillMastery.count()).toBe(0);
    expect(await prisma.learningProgress.count()).toBe(0);
    expect(await prisma.errorAnalysis.count()).toBe(0);
    expect(await prisma.errorPattern.count()).toBe(0);
  });

  it('30. an invalid proposal is blocked and persists nothing', async () => {
    const { QuestionAnalysisService } = await import(
      '../../src/application/services/ingestion/QuestionAnalysisService.js'
    );
    const { QuestionNormalizationService } = await import(
      '../../src/application/services/ingestion/QuestionNormalizationService.js'
    );
    const { QuestionIngestionService } = await import(
      '../../src/application/services/ingestion/QuestionIngestionService.js'
    );
    const { prisma } = await import('../setup.js');

    // The model returns a structurally invalid payload (missing confidence).
    const questionUnderstanding = { questionType: 'X' };
    const invalidObj = { questionUnderstanding };
    const invalidContent = JSON.stringify(invalidObj);
    const fetchImpl = vi.fn(async () => jsonResponse(envelope(invalidContent)));
    const realProvider = new RealQuestionUnderstandingProvider(makeConfig({ maxRetries: 0 }), {
      fetchImpl,
    });
    const stubOcr = {
      getProviderName: () => 'stub-ocr',
      isAvailable: async () => true,
      extract: vi.fn(async () => ({
        text: 'Synthetic question text long enough for normalization.',
        confidence: 0.9,
        metadata: { provider: 'stub-ocr' },
        warnings: [] as string[],
      })),
    };

    const ingestionService = new QuestionIngestionService(prisma as any);
    const analysisService = new QuestionAnalysisService(
      prisma as any,
      undefined,
      stubOcr as any,
      realProvider,
      new QuestionNormalizationService()
    );

    const user = await prisma.user.create({
      data: {
        email: `p5f9b-bad-${Date.now()}@example.com`,
        firstName: 'P5F9B',
        lastName: 'Bad',
        role: 'STUDENT',
        passwordHash: 'h',
      },
    });
    await prisma.studentProfile.create({ data: { userId: user.id, grade: 11 } });

    const ingestion = await ingestionService.createIngestion(user.id, {
      ingestMethod: 'IMAGE_UPLOAD',
      originalAssetRef: 'local://stub2.png',
      originalAssetMimeType: 'image/png',
    });

    // The invalid proposal must FAIL the analysis (transaction rolls back).
    await expect(
      analysisService.analyzeIngestion(ingestion.id, user.id, 'STUDENT', {})
    ).rejects.toThrow();

    // Nothing was persisted by the failed provider output.
    expect(await prisma.questionSkillMapping.count()).toBe(0);
    expect(await prisma.curriculumCandidate.count()).toBe(0);
  });
});
