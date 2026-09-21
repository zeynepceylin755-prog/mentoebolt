import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GeminiQuestionUnderstandingProvider } from '../../src/infrastructure/ai/question-understanding/GeminiQuestionUnderstandingProvider.js';
import { QuestionAnalysisService } from '../../src/application/services/ingestion/QuestionAnalysisService.js';
import { QuestionNormalizationService } from '../../src/application/services/ingestion/QuestionNormalizationService.js';
import { QuestionIngestionService } from '../../src/application/services/ingestion/QuestionIngestionService.js';
import { INGESTION_STATES } from '../../src/domain/ingestion/ingestionStateMachine.js';
import type { IStorageProvider } from '../../src/domain/interfaces/storage/IStorageProvider.js';
import type { QuestionUnderstandingConfig } from '../../src/infrastructure/ai/question-understanding/config/QuestionUnderstandingConfig.js';

/**
 * Phase 7.5 — IMAGE_UPLOAD → ingestion → multimodal analysis → Gemini.
 *
 * The @google/genai SDK is mocked (no network, no real key). A fake storage
 * provider serves real PNG bytes for the ingestion's `originalAssetRef`, so the
 * ENTIRE chain is exercised: asset ref → storage read → image content part →
 * provider call → validators → state transition.
 */

const createMock = vi.fn();

vi.mock('@google/genai', () => {
  class GoogleGenAI {
    interactions = { create: createMock };
    constructor(_options: { apiKey?: string }) { }
  }
  return { GoogleGenAI };
});

const PNG_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
]);

/** Storage that serves the stored PNG for any reference, with no filesystem use. */
class FakeStorage implements IStorageProvider {
  public readCalls: string[] = [];
  getProviderName(): string {
    return 'fake-storage';
  }
  async store(): Promise<never> {
    throw new Error('not used in this test');
  }
  async read(ref: string): Promise<Buffer | null> {
    this.readCalls.push(ref);
    return ref.startsWith('local://') ? PNG_BYTES : null;
  }
  async delete(): Promise<boolean> {
    return false;
  }
}

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

function modelPayload() {
  return {
    questionUnderstanding: {
      questionType: 'EQUATION_SOLVING',
      mathematicalObjects: ['linear_equation', 'variable'],
      requestedOperation: 'SOLVE',
      constraints: [],
    },
    curriculumCandidates: [],
    microSkillCandidates: [],
    confidence: 0.86,
    warnings: [],
  };
}

describe('Phase 7.5 — IMAGE_UPLOAD multimodal analysis chain', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reads the image from storage and sends it to Gemini as a real image part', async () => {
    const { prisma } = await import('../setup.js');

    createMock.mockResolvedValue({
      id: 'int-1',
      status: 'completed',
      output_text: JSON.stringify(modelPayload()),
      steps: [],
    });

    const storage = new FakeStorage();
    const aiProvider = new GeminiQuestionUnderstandingProvider(makeConfig(), storage);
    const ingestionService = new QuestionIngestionService(prisma as any);
    const analysisService = new QuestionAnalysisService(
      prisma as any,
      undefined,
      // OCR is intentionally absent: the image goes straight to the AI.
      undefined,
      aiProvider,
      new QuestionNormalizationService(),
      undefined,
      undefined,
      undefined,
      undefined,
      storage as any
    );

    const user = await prisma.user.create({
      data: {
        email: `p75-image-${Date.now()}@example.com`,
        firstName: 'P75',
        lastName: 'Image',
        role: 'STUDENT',
        passwordHash: 'h',
      },
    });
    await prisma.studentProfile.create({ data: { userId: user.id, grade: 11 } });

    // IMAGE_UPLOAD ingestion with an asset ref and NO normalizedText at all.
    const ingestion = await ingestionService.createIngestion(user.id, {
      ingestMethod: 'IMAGE_UPLOAD',
      originalAssetRef: 'local://p75-photo.png',
      originalAssetMimeType: 'image/png',
    });

    // Analysis must succeed with no text: the image IS the question.
    const result = await analysisService.analyzeIngestion(ingestion.id, user.id, 'STUDENT', {});

    expect(result.ingestionId).toBe(ingestion.id);
    expect([INGESTION_STATES.ANALYZED, INGESTION_STATES.REVIEW_REQUIRED]).toContain(result.state);
    // The provider read the asset through the storage abstraction.
    expect(storage.readCalls).toContain('local://p75-photo.png');

    // The Gemini call carried a real image content part with the actual bytes.
    expect(createMock).toHaveBeenCalledTimes(1);
    const params = createMock.mock.calls[0][0] as Record<string, unknown>;
    const parts = params.input as Array<Record<string, unknown>>;
    expect(Array.isArray(parts)).toBe(true);
    const imagePart = parts.find((p) => p.type === 'image');
    expect(imagePart).toBeDefined();
    expect(imagePart!.data).toBe(PNG_BYTES.toString('base64'));
    expect(imagePart!.mime_type).toBe('image/png');
    // The opaque ref never travels as content.
    expect(JSON.stringify(parts)).not.toContain('local://p75-photo.png');
  });

  it('warns when the model read the image but returned no verbatim transcription', async () => {
    const { prisma } = await import('../setup.js');

    // A response with NO extractedText: the model summarised instead of
    // transcribing. The analysis must still succeed, but it must SAY so rather
    // than silently storing prose as the question text.
    createMock.mockResolvedValue({
      id: 'int-2',
      status: 'completed',
      output_text: JSON.stringify({
        questionUnderstanding: {
          questionType: 'EQUATION_SOLVING',
          mathematicalObjects: ['quadratic equation'],
          requestedOperation: 'solve',
          constraints: [],
        },
        curriculumCandidates: [],
        microSkillCandidates: [],
        confidence: 0.8,
        warnings: [],
      }),
      steps: [],
    });

    const storage = new FakeStorage();
    const aiProvider = new GeminiQuestionUnderstandingProvider(makeConfig(), storage);
    const ingestionService = new QuestionIngestionService(prisma as any);
    const analysisService = new QuestionAnalysisService(
      prisma as any,
      undefined,
      undefined,
      aiProvider,
      new QuestionNormalizationService(),
      undefined,
      undefined,
      undefined,
      undefined,
      storage as any
    );

    const user = await prisma.user.create({
      data: {
        email: `p75-notrans-${Date.now()}@example.com`,
        firstName: 'P75',
        lastName: 'NoTrans',
        role: 'STUDENT',
        passwordHash: 'h',
      },
    });
    await prisma.studentProfile.create({ data: { userId: user.id, grade: 11 } });

    const ingestion = await ingestionService.createIngestion(user.id, {
      ingestMethod: 'IMAGE_UPLOAD',
      originalAssetRef: 'local://p75-notrans.png',
      originalAssetMimeType: 'image/png',
    });

    const result = await analysisService.analyzeIngestion(ingestion.id, user.id, 'STUDENT', {});

    // The image was still analysed (the model read it)…
    expect(createMock).toHaveBeenCalledTimes(1);
    // …but the missing transcription is surfaced, not hidden.
    expect(result.warnings.join(' ')).toContain('no verbatim transcription');
  });

  it('TEXT_PASTE still requires normalizedText (legacy behaviour preserved)', async () => {
    const { prisma } = await import('../setup.js');

    const storage = new FakeStorage();
    const aiProvider = new GeminiQuestionUnderstandingProvider(makeConfig(), storage);
    const ingestionService = new QuestionIngestionService(prisma as any);
    const analysisService = new QuestionAnalysisService(
      prisma as any,
      undefined,
      undefined,
      aiProvider,
      new QuestionNormalizationService(),
      undefined,
      undefined,
      undefined,
      undefined,
      storage as any
    );

    const user = await prisma.user.create({
      data: {
        email: `p75-text-${Date.now()}@example.com`,
        firstName: 'P75',
        lastName: 'Text',
        role: 'STUDENT',
        passwordHash: 'h',
      },
    });
    await prisma.studentProfile.create({ data: { userId: user.id, grade: 11 } });

    const ingestion = await ingestionService.createIngestion(user.id, {
      ingestMethod: 'TEXT_PASTE',
      rawText: 'Synthetic text question long enough to pass validation.',
    });

    // No text is passed to the analysis AND there is no image → must fail.
    await expect(
      analysisService.analyzeIngestion(ingestion.id, user.id, 'STUDENT', {})
    ).rejects.toThrow();

    // The provider was never called: there was nothing to analyse.
    expect(createMock).not.toHaveBeenCalled();
  });
});
