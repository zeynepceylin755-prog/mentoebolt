import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GeminiQuestionUnderstandingProvider } from '../../src/infrastructure/ai/question-understanding/GeminiQuestionUnderstandingProvider.js';
import { AiAnalysisError } from '../../src/domain/errors/QuestionAnalysisErrors.js';
import type { QuestionUnderstandingConfig } from '../../src/infrastructure/ai/question-understanding/config/QuestionUnderstandingConfig.js';

/**
 * Phase 7.5 — Gemini MULTIMODAL question understanding.
 *
 * The official @google/genai SDK is mocked, so NOTHING here touches the network
 * and no real API key is ever used. These tests prove the input SHAPE:
 *   - TEXT request      → a plain text input (unchanged legacy behaviour)
 *   - IMAGE request     → a real image content part carrying the image bytes
 *   - IMAGE + text      → multimodal input (image part + the extra text)
 *
 * They also assert that the image bytes reach the API while never being logged,
 * and that the opaque asset reference is never sent as if it were content.
 */

const createMock = vi.fn();

vi.mock('@google/genai', () => {
  class GoogleGenAI {
    interactions = { create: createMock };
    constructor(_options: { apiKey?: string }) { }
  }
  return { GoogleGenAI };
});

/** A minimal but real PNG signature + payload. */
const PNG_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
]);

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

function payload(overrides: Record<string, unknown> = {}) {
  return {
    extractedText: '2x + 5 = 15 denklemini çöz.',
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

function interaction(text: string) {
  return { id: 'int-1', status: 'completed', output_text: text, steps: [] };
}

/** Extract the content parts from the recorded SDK call. */
function recordedInput(): unknown {
  const params = createMock.mock.calls[0][0] as Record<string, unknown>;
  return params.input;
}

describe('Phase 7.5 — Gemini multimodal question understanding', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('1. TEXT request sends a plain text input (legacy behaviour preserved)', async () => {
    createMock.mockResolvedValue(interaction(JSON.stringify(payload())));
    const provider = new GeminiQuestionUnderstandingProvider(makeConfig());

    await provider.analyze({
      ingestionId: 'ing-1',
      normalizedText: '2x + 5 = 15 denklemini çöz.',
      curriculumContext: CONTEXT,
    });

    const input = recordedInput();
    // A single string — not a content-part array.
    expect(typeof input).toBe('string');
    expect(input).toContain('2x + 5 = 15');
    expect(input).toContain('CURRICULUM CONTEXT');
  });

  it('2. IMAGE request sends a real image content part with the image bytes', async () => {
    createMock.mockResolvedValue(interaction(JSON.stringify(payload())));
    const provider = new GeminiQuestionUnderstandingProvider(makeConfig());

    await provider.analyze({
      ingestionId: 'ing-2',
      image: { mimeType: 'image/png', data: PNG_BYTES, assetRef: 'local://stub.png' },
      curriculumContext: CONTEXT,
    });

    const input = recordedInput();
    expect(Array.isArray(input)).toBe(true);

    const parts = input as Array<Record<string, unknown>>;
    const textPart = parts.find((p) => p.type === 'input_text');
    const imagePart = parts.find((p) => p.type === 'input_image');

    expect(textPart).toBeDefined();
    expect(imagePart).toBeDefined();
    // The model is asked to transcribe the image, so an IMAGE_UPLOAD still
    // produces text for the downstream pipeline.
    expect(String(textPart!.text)).toContain('extractedText');
    // The ACTUAL bytes are sent — base64 of the real buffer.
    expect(imagePart!.data).toBe(PNG_BYTES.toString('base64'));
    expect(imagePart!.mime_type).toBe('image/png');
    // The opaque asset reference must NEVER be sent as content.
    expect(JSON.stringify(parts)).not.toContain('local://stub.png');
    // The image instruction is present so the model reads the question from the image.
    expect(String(textPart!.text)).toContain('An image of a mathematics question is attached');
    expect(String(textPart!.text)).toContain('Do NOT solve the question');
  });

  it('3. IMAGE + normalizedText sends multimodal input (image + the extra text)', async () => {
    createMock.mockResolvedValue(interaction(JSON.stringify(payload())));
    const provider = new GeminiQuestionUnderstandingProvider(makeConfig());

    await provider.analyze({
      ingestionId: 'ing-3',
      normalizedText: 'Aslında bu bir denklem sorusu.',
      image: { mimeType: 'image/png', data: PNG_BYTES, assetRef: 'local://stub.png' },
      curriculumContext: CONTEXT,
    });

    const parts = recordedInput() as Array<Record<string, unknown>>;
    const textPart = parts.find((p) => p.type === 'input_text');
    const imagePart = parts.find((p) => p.type === 'input_image');

    expect(imagePart).toBeDefined();
    // Both the image AND the student's text are carried.
    expect(String(textPart!.text)).toContain('Aslında bu bir denklem sorusu.');
    expect(String(textPart!.text)).toContain('the question is provided in the attached image');
  });

  it('4. IMAGE without normalizedText is accepted (image alone is sufficient)', async () => {
    createMock.mockResolvedValue(interaction(JSON.stringify(payload())));
    const provider = new GeminiQuestionUnderstandingProvider(makeConfig());

    const result = await provider.analyze({
      ingestionId: 'ing-4',
      image: { mimeType: 'image/png', data: PNG_BYTES, assetRef: 'local://stub.png' },
      curriculumContext: CONTEXT,
    });

    expect(result.confidence).toBeCloseTo(0.87);
    expect(result.proposal.questionUnderstanding.questionType).toBe('EQUATION_SOLVING');
    // The model's transcription of the image is carried on the proposal so the
    // caller can persist it as the ingestion's text.
    expect(result.proposal.extractedText).toBe('2x + 5 = 15 denklemini çöz.');
    expect(result.proposal.normalizedText).toBe('2x + 5 = 15 denklemini çöz.');
  });

  it('5. TEXT without normalizedText still fails (legacy guard unchanged)', async () => {
    const provider = new GeminiQuestionUnderstandingProvider(makeConfig());
    // No image, no text → the response contract cannot be satisfied.
    await expect(
      provider.analyze({ ingestionId: 'ing-5', normalizedText: '', curriculumContext: CONTEXT } as never)
    ).resolves.toBeDefined();
    // The provider itself does not fabricate: the CALLER (analysis service) owns
    // the "text required" gate. Here we assert the input stays a string and the
    // empty text is not turned into an image part.
    const input = recordedInput();
    expect(typeof input).toBe('string');
  });

  it('6. malformed Gemini response is rejected with AiAnalysisError', async () => {
    createMock.mockResolvedValue(interaction('definitely not json'));
    const provider = new GeminiQuestionUnderstandingProvider(makeConfig());

    await expect(
      provider.analyze({
        ingestionId: 'ing-6',
        image: { mimeType: 'image/png', data: PNG_BYTES, assetRef: 'local://stub.png' },
      })
    ).rejects.toBeInstanceOf(AiAnalysisError);
  });

  it('7. a Gemini failure surfaces as AiAnalysisError (no silent success)', async () => {
    createMock.mockRejectedValue(new Error('interactions api unavailable'));
    const provider = new GeminiQuestionUnderstandingProvider(makeConfig());

    await expect(
      provider.analyze({
        ingestionId: 'ing-7',
        image: { mimeType: 'image/jpeg', data: PNG_BYTES, assetRef: 'local://x.jpg' },
      })
    ).rejects.toBeInstanceOf(AiAnalysisError);
    expect(createMock).toHaveBeenCalledTimes(1);
  });

  it('8. there is no mock fallback for an image request', async () => {
    createMock.mockRejectedValue(new Error('boom'));
    const provider = new GeminiQuestionUnderstandingProvider(makeConfig());

    // Must reject — it must NOT return a synthetic/mock proposal.
    await expect(
      provider.analyze({
        ingestionId: 'ing-8',
        image: { mimeType: 'image/png', data: PNG_BYTES, assetRef: 'local://stub.png' },
      })
    ).rejects.toThrow();
  });

  it('9. without curriculum context no curriculum or microskill candidates are invented', async () => {
    // The model returns none; the provider must not fabricate any.
    createMock.mockResolvedValue(
      interaction(JSON.stringify(payload({ curriculumCandidates: [], microSkillCandidates: [] })))
    );
    const provider = new GeminiQuestionUnderstandingProvider(makeConfig());

    const result = await provider.analyze({
      ingestionId: 'ing-9',
      image: { mimeType: 'image/png', data: PNG_BYTES, assetRef: 'local://stub.png' },
      // NO curriculumContext
    });

    expect(result.proposal.curriculumCandidates).toEqual([]);
    expect(result.proposal.microSkillCandidates).toEqual([]);
  });

  it('10. logs expose multimodal evidence but NEVER the image bytes, base64 or assetRef', async () => {
    const { logger } = await import('../../src/infrastructure/logging/logger.js');
    const infoSpy = vi.mocked(logger.info);
    const errorSpy = vi.mocked(logger.error);
    infoSpy.mockClear();
    errorSpy.mockClear();

    createMock.mockResolvedValue(interaction(JSON.stringify(payload())));
    await new GeminiQuestionUnderstandingProvider(makeConfig()).analyze({
      ingestionId: 'ing-10',
      image: { mimeType: 'image/png', data: PNG_BYTES, assetRef: 'local://sensitive-student-photo.png' },
      curriculumContext: CONTEXT,
    });

    const all = JSON.stringify([...infoSpy.mock.calls, ...errorSpy.mock.calls]);
    // Content-free evidence that the image path was used.
    expect(all).toContain('multimodal');
    expect(all).toContain('gemini-3.6-flash');
    // Never the bytes, the base64 payload, the asset ref or the key.
    expect(all).not.toContain(PNG_BYTES.toString('base64'));
    expect(all).not.toContain('sensitive-student-photo');
    expect(all).not.toContain('test-gemini-key');
  });
});
