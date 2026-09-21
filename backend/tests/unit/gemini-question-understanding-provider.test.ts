import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GeminiQuestionUnderstandingProvider } from '../../src/infrastructure/ai/question-understanding/GeminiQuestionUnderstandingProvider.js';
import { AiAnalysisError } from '../../src/domain/errors/QuestionAnalysisErrors.js';
import type { QuestionUnderstandingConfig } from '../../src/infrastructure/ai/question-understanding/config/QuestionUnderstandingConfig.js';

/**
 * Phase 7.4 (Interactions API) — GeminiQuestionUnderstandingProvider.
 *
 * The official @google/genai SDK is mocked, so NOTHING here touches the network
 * and no real API key is ever used. The tests assert the response mapping,
 * validation and no-mock-fallback boundaries of the database contract.
 */

// The provider constructs `new GoogleGenAI({ apiKey })` in its constructor, so
// the SDK is replaced by a controllable fake whose `interactions.create` is the
// only thing the provider is allowed to depend on.
const createMock = vi.fn();

vi.mock('@google/genai', () => {
  class GoogleGenAI {
    interactions = { create: createMock };
    constructor(_options: { apiKey?: string }) {}
  }
  return { GoogleGenAI };
});

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
    provider: 'gemini',
    model: 'gemini-3.6-flash',
    timeoutMs: 30000,
    maxRetries: 0,
    maxTokens: 1024,
    maxInputChars: 8000,
    allowExternalProvider: true,
    baseUrl: 'https://api.openai.com/v1',
    apiKey: '',
    geminiApiKey: 'test-gemini-key',
    ...overrides,
  };
}

/** A valid model payload (the shape the JSON schema enforces). */
function payload(overrides: Record<string, unknown> = {}) {
  return {
    questionUnderstanding: {
      questionType: 'EQUATION_SOLVING',
      mathematicalObjects: ['linear_equation', 'variable'],
      requestedOperation: 'SOLVE',
      constraints: [],
    },
    curriculumCandidates: [
      { level: 'LEARNING_OUTCOME', targetId: 'lo-1', confidence: 0.9, rationale: 'solving an equation' },
    ],
    microSkillCandidates: [
      { microSkillId: 'ms-1', confidence: 0.88, rationale: 'isolating the variable' },
    ],
    confidence: 0.87,
    warnings: [],
    ...overrides,
  };
}

/** Shape of an Interactions API response as returned by @google/genai. */
function interaction(textOrSteps: string | Array<Record<string, unknown>>) {
  if (typeof textOrSteps === 'string') {
    return { id: 'int-1', status: 'completed', output_text: textOrSteps, steps: [] };
  }
  return { id: 'int-1', status: 'completed', steps: textOrSteps };
}

const REQUEST = {
  ingestionId: 'ing-1',
  normalizedText: '2x + 5 = 15 denklemini çöz.',
  curriculumContext: CONTEXT,
};

describe('Phase 7.4 — Gemini provider (Interactions API)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('1. maps a valid structured response onto the unchanged response contract', async () => {
    createMock.mockResolvedValue(interaction(JSON.stringify(payload())));
    const provider = new GeminiQuestionUnderstandingProvider(makeConfig());

    const result = await provider.analyze(REQUEST);

    expect(result.proposal.ingestionId).toBe('ing-1');
    expect(result.proposal.normalizedText).toBe('2x + 5 = 15 denklemini çöz.');
    expect(result.proposal.questionUnderstanding.questionType).toBe('EQUATION_SOLVING');
    expect(result.proposal.curriculumCandidates).toHaveLength(1);
    expect(result.proposal.microSkillCandidates).toHaveLength(1);
    expect(result.proposal.modelMetadata.provider).toBe('gemini');
    expect(result.proposal.modelMetadata.model).toBe('gemini-3.6-flash');
    expect(result.confidence).toBeCloseTo(0.87);
    expect(result.warnings).toEqual([]);
  });

  it('2. calls the Interactions API with the configured model and system prompt', async () => {
    createMock.mockResolvedValue(interaction(JSON.stringify(payload())));
    const provider = new GeminiQuestionUnderstandingProvider(makeConfig());
    await provider.analyze(REQUEST);

    expect(createMock).toHaveBeenCalledTimes(1);
    const params = createMock.mock.calls[0][0] as Record<string, any>;

    expect(params.model).toBe('gemini-3.6-flash');
    expect(params.system_instruction).toContain('curriculumCandidates');
    expect(params.system_instruction).toContain('microSkillCandidates');
    expect(params.system_instruction).toContain('Never invent curriculum identifiers');
    // The question text is carried in the interaction input, not the system prompt.
    expect(params.input).toContain('2x + 5 = 15');
    expect(params.input).toContain('CURRICULUM CONTEXT');
    // Structured JSON output is requested from the API itself.
    expect(params.response_format.mime_type).toBe('application/json');
    expect(params.response_format.schema.required).toContain('questionUnderstanding');
    expect(params.generation_config.max_output_tokens).toBe(1024);
    // Single stateless turn.
    expect(params.store).toBe(false);
  });

  it('3. reads the text from steps/model_output when output_text is absent', async () => {
    createMock.mockResolvedValue(
      interaction([{ type: 'model_output', content: [{ text: JSON.stringify(payload()) }] }])
    );
    const provider = new GeminiQuestionUnderstandingProvider(makeConfig());
    const result = await provider.analyze(REQUEST);
    expect(result.confidence).toBeCloseTo(0.87);
  });

  it('4. empty response is rejected with AiAnalysisError (never a fake result)', async () => {
    createMock.mockResolvedValue(interaction(''));
    const provider = new GeminiQuestionUnderstandingProvider(makeConfig());
    await expect(provider.analyze(REQUEST)).rejects.toBeInstanceOf(AiAnalysisError);
  });

  it('5. malformed JSON is rejected with AiAnalysisError', async () => {
    createMock.mockResolvedValue(interaction('definitely not json'));
    const provider = new GeminiQuestionUnderstandingProvider(makeConfig());
    await expect(provider.analyze(REQUEST)).rejects.toBeInstanceOf(AiAnalysisError);
  });

  it('6. missing required fields are rejected with AiAnalysisError', async () => {
    createMock.mockResolvedValue(interaction(JSON.stringify({ confidence: 0.9, warnings: [] })));
    const provider = new GeminiQuestionUnderstandingProvider(makeConfig());
    await expect(provider.analyze(REQUEST)).rejects.toBeInstanceOf(AiAnalysisError);
  });

  it('7. invalid confidence is rejected with AiAnalysisError', async () => {
    createMock.mockResolvedValue(interaction(JSON.stringify(payload({ confidence: 1.5 }))));
    const provider = new GeminiQuestionUnderstandingProvider(makeConfig());
    await expect(provider.analyze(REQUEST)).rejects.toBeInstanceOf(AiAnalysisError);
  });

  it('8. an SDK/API failure surfaces as AiAnalysisError and never falls back to mock', async () => {
    createMock.mockRejectedValue(new Error('models/gemini-3.6-flash is no longer available'));
    const provider = new GeminiQuestionUnderstandingProvider(makeConfig());

    await expect(provider.analyze(REQUEST)).rejects.toBeInstanceOf(AiAnalysisError);
    // Exactly one attempt: no retry loop, no silent substitution.
    expect(createMock).toHaveBeenCalledTimes(1);
  });

  it('9. logs never contain the API key, the question or the raw response', async () => {
    const { logger } = await import('../../src/infrastructure/logging/logger.js');
    const infoSpy = vi.mocked(logger.info);
    const errorSpy = vi.mocked(logger.error);
    infoSpy.mockClear();
    errorSpy.mockClear();

    const SECRET_QUESTION = 'SENSITIVE_STUDENT_QUESTION_771';
    createMock.mockResolvedValue(interaction(JSON.stringify(payload())));
    await new GeminiQuestionUnderstandingProvider(makeConfig()).analyze({
      ingestionId: 'ing-1',
      normalizedText: SECRET_QUESTION,
      curriculumContext: CONTEXT,
    });

    createMock.mockRejectedValue(new Error('boom'));
    await new GeminiQuestionUnderstandingProvider(makeConfig())
      .analyze({ ingestionId: 'ing-1', normalizedText: SECRET_QUESTION, curriculumContext: CONTEXT })
      .catch(() => undefined);

    const all = JSON.stringify([...infoSpy.mock.calls, ...errorSpy.mock.calls]);
    expect(all).not.toContain(SECRET_QUESTION);
    expect(all).not.toContain('test-gemini-key');
    expect(all).not.toContain('CURRICULUM CONTEXT');
    // Provider/model identity is recorded for production verification.
    expect(all).toContain('gemini-3.6-flash');
  });

  it('10. constructor refuses to build without a configured API key', () => {
    expect(() => new GeminiQuestionUnderstandingProvider(makeConfig({ geminiApiKey: '' }))).toThrow(
      AiAnalysisError
    );
  });

  it('11. exposes provider identity through the unchanged interface', async () => {
    const provider = new GeminiQuestionUnderstandingProvider(makeConfig());
    expect(provider.getProviderName()).toBe('gemini');
    expect(provider.getModelName()).toBe('gemini-3.6-flash');
    expect(await provider.isAvailable()).toBe(true);
  });
});
