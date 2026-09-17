import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RealVisionOcrProvider, clampConfidence } from '../../src/infrastructure/ocr/RealVisionOcrProvider.js';
import { createOcrProviderFromConfig } from '../../src/infrastructure/ocr/OcrProviderFactory.js';
import { MockOcrProvider } from '../../src/infrastructure/ocr/MockOcrProvider.js';
import { OcrProviderError } from '../../src/domain/errors/QuestionAnalysisErrors.js';
import { IStorageProvider, StoredAsset, StoreInput } from '../../src/domain/interfaces/storage/IStorageProvider.js';
import type { OcrConfig } from '../../src/infrastructure/ocr/config/OcrConfig.js';

/**
 * Phase 5F.9-A — Real vision OCR provider tests.
 *
 * The provider's HTTP boundary is injected, so NOTHING here makes a real
 * external call. We assert contract behaviour, retry/timeout semantics,
 * failure handling, and that sensitive content is never logged.
 */

const PNG_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
]);

/** In-memory storage provider — no filesystem, no real I/O. */
class FakeStorage implements IStorageProvider {
  constructor(private readonly objects: Record<string, Buffer | null> = {}) {}
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

function makeConfig(overrides: Partial<OcrConfig> = {}): OcrConfig {
  return {
    provider: 'openai',
    model: 'gpt-4o',
    timeoutMs: 5000,
    maxRetries: 2,
    maxTokens: 1024,
    maxImageBytes: 7 * 1024 * 1024,
    allowExternalProvider: true,
    baseUrl: 'https://api.example.test/v1',
    apiKey: 'test-key',
    ...overrides,
  };
}

/** Build a fetch-like response. */
function jsonResponse(body: unknown, status = 200, headers?: Record<string, string>) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (n: string) => headers?.[n.toLowerCase()] ?? null },
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  };
}

/** Wrap model content into a chat-completions envelope. */
function envelope(contentText: string, extra: Record<string, unknown> = {}) {
  const message = { content: contentText };
  const choice = { message: message };
  const body = { model: 'gpt-4o-2024-08-06', created: 1700000, choices: [choice] };
  return { ...body, ...extra };
}

/** A provider + fake storage bound together. */
function build(fetchImpl: any, config = makeConfig(), sleepImpl = vi.fn(async () => {})) {
  const storage = new FakeStorage({ 'local://q.png': PNG_BYTES });
  const provider = new RealVisionOcrProvider(storage, config, { fetchImpl, sleepImpl });
  return { provider, storage, sleepImpl };
}

const GOOD_CONTENT = JSON.stringify({
  text: 'x² + 5x + 6 = 0 denkleminin köklerini bulunuz.',
  confidence: 0.92,
  warnings: [],
});

describe('Phase 5F.9-A — RealVisionOcrProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('1. valid image → extracted text', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(envelope(GOOD_CONTENT)));
    const { provider } = build(fetchImpl);

    const result = await provider.extract({ assetRef: 'local://q.png', mimeType: 'image/png' });
    expect(result.text).toBe('x² + 5x + 6 = 0 denkleminin köklerini bulunuz.');
    expect(result.confidence).toBeCloseTo(0.92);
  });

  it('2. Turkish characters are preserved', async () => {
    const content = JSON.stringify({
      text: 'Üçgenin çevresini hesaplayınız. İç açılar toplamı 180°’dir.',
      confidence: 0.9,
      warnings: [],
    });
    const fetchImpl = vi.fn(async () => jsonResponse(envelope(content)));
    const { provider } = build(fetchImpl);
    const result = await provider.extract({ assetRef: 'local://q.png', mimeType: 'image/png' });
    expect(result.text).toContain('Üçgenin');
    expect(result.text).toContain('açılar');
    expect(result.text).toContain('°');
  });

  it('3. mathematical notation is preserved (fractions/roots/powers/inequalities)', async () => {
    const content = JSON.stringify({
      text: '\\frac{a}{b} ≤ \\sqrt{x+1}, |x| ≥ 2, x^{2} + y_{1}, \\begin{pmatrix}1&2\\\\3&4\\end{pmatrix}',
      confidence: 0.85,
      warnings: [],
    });
    const fetchImpl = vi.fn(async () => jsonResponse(envelope(content)));
    const { provider } = build(fetchImpl);
    const result = await provider.extract({ assetRef: 'local://q.png', mimeType: 'image/png' });
    expect(result.text).toContain('\\frac{a}{b}');
    expect(result.text).toContain('\\sqrt{x+1}');
    expect(result.text).toContain('x^{2}');
    expect(result.text).toContain('≤');
    expect(result.text).toContain('\\begin{pmatrix}');
  });

  it('4. empty provider response is rejected (not a successful empty OCR)', async () => {
    const content = JSON.stringify({ text: '   ', confidence: 0.9, warnings: [] });
    const fetchImpl = vi.fn(async () => jsonResponse(envelope(content)));
    const { provider } = build(fetchImpl);
    await expect(
      provider.extract({ assetRef: 'local://q.png', mimeType: 'image/png' })
    ).rejects.toBeInstanceOf(OcrProviderError);
  });

  it('5. malformed provider response is rejected', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse('not json at all'));
    const { provider } = build(fetchImpl);
    await expect(
      provider.extract({ assetRef: 'local://q.png', mimeType: 'image/png' })
    ).rejects.toBeInstanceOf(OcrProviderError);

    // Content that is valid JSON but the wrong shape is also rejected.
    const wrongShape = vi.fn(async () => jsonResponse(envelope(JSON.stringify({ foo: 'bar' }))));
    await expect(
      build(wrongShape).provider.extract({ assetRef: 'local://q.png', mimeType: 'image/png' })
    ).rejects.toBeInstanceOf(OcrProviderError);
  });

  it('6. timeout is treated as a transient failure (and retried, then fails)', async () => {
    const timeoutError = Object.assign(new Error('aborted'), { name: 'AbortError' });
    const fetchImpl = vi.fn(async () => {
      throw timeoutError;
    });
    const { provider, sleepImpl } = build(fetchImpl, makeConfig({ maxRetries: 2 }));
    await expect(
      provider.extract({ assetRef: 'local://q.png', mimeType: 'image/png' })
    ).rejects.toBeInstanceOf(OcrProviderError);
    // maxRetries=2 → 3 attempts total.
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(sleepImpl).toHaveBeenCalledTimes(2);
  });

  it('7. HTTP 429 is retried and then succeeds', async () => {
    let call = 0;
    const fetchImpl = vi.fn(async () => {
      call++;
      if (call < 3) return jsonResponse('rate limited', 429, { 'retry-after': '1' });
      return jsonResponse(envelope(GOOD_CONTENT));
    });
    const { provider, sleepImpl } = build(fetchImpl, makeConfig({ maxRetries: 3 }));
    const result = await provider.extract({ assetRef: 'local://q.png', mimeType: 'image/png' });
    expect(result.text).toContain('denkleminin');
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(sleepImpl).toHaveBeenCalledTimes(2);
  });

  it('8. HTTP 5xx is retried', async () => {
    let call = 0;
    const fetchImpl = vi.fn(async () => {
      call++;
      if (call === 1) return jsonResponse('boom', 500);
      return jsonResponse(envelope(GOOD_CONTENT));
    });
    const { provider } = build(fetchImpl, makeConfig({ maxRetries: 2 }));
    const result = await provider.extract({ assetRef: 'local://q.png', mimeType: 'image/png' });
    expect(result.text).toBeTruthy();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('9. non-retryable 4xx fails fast (no retries)', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse('bad request', 400));
    const { provider, sleepImpl } = build(fetchImpl, makeConfig({ maxRetries: 3 }));
    await expect(
      provider.extract({ assetRef: 'local://q.png', mimeType: 'image/png' })
    ).rejects.toBeInstanceOf(OcrProviderError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(sleepImpl).not.toHaveBeenCalled();
  });

  it('10. unsupported MIME type is rejected before any provider call', async () => {
    const fetchImpl = vi.fn();
    const storage = new FakeStorage({ 'local://q.txt': Buffer.from('hello') });
    const provider = new RealVisionOcrProvider(storage, makeConfig(), { fetchImpl });
    await expect(
      provider.extract({ assetRef: 'local://q.txt', mimeType: 'text/plain' })
    ).rejects.toBeInstanceOf(OcrProviderError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('11. storage read failure is surfaced as a provider error', async () => {
    const fetchImpl = vi.fn();
    const storage = new FakeStorage({}); // no objects → read returns null
    const provider = new RealVisionOcrProvider(storage, makeConfig(), { fetchImpl });
    await expect(
      provider.extract({ assetRef: 'local://missing.png', mimeType: 'image/png' })
    ).rejects.toBeInstanceOf(OcrProviderError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('12. provider unavailable without an API key', async () => {
    const { provider } = build(vi.fn(), makeConfig({ apiKey: '' }));
    expect(await provider.isAvailable()).toBe(false);

    const { provider: withKey } = build(vi.fn());
    expect(await withKey.isAvailable()).toBe(true);
  });

  it('13. metadata is returned with provider/model/version', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(envelope(GOOD_CONTENT)));
    const { provider } = build(fetchImpl);
    const result = await provider.extract({ assetRef: 'local://q.png', mimeType: 'image/png' });
    expect(result.metadata?.provider).toBe('vision-openai');
    expect(result.metadata?.model).toBe('gpt-4o-2024-08-06');
    expect(result.metadata?.version).toBe('1700000');
  });

  it('14. processingTimeMs is recorded', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(envelope(GOOD_CONTENT)));
    const { provider } = build(fetchImpl);
    const result = await provider.extract({ assetRef: 'local://q.png', mimeType: 'image/png' });
    expect(typeof result.metadata?.processingTimeMs).toBe('number');
    expect(result.metadata?.processingTimeMs as number).toBeGreaterThanOrEqual(0);
  });

  it('15. confidence is bounded to [0,1] and conservative when missing', () => {
    expect(clampConfidence(1.7)).toBe(1);
    expect(clampConfidence(-3)).toBe(0);
    expect(clampConfidence(0.5)).toBe(0.5);
    // Missing / non-numeric → conservative below the low-confidence threshold.
    expect(clampConfidence(undefined)).toBeLessThan(0.5);
    expect(clampConfidence('nonsense')).toBeLessThan(0.5);
  });

  it('15b. an omitted confidence yields a conservative result through extract', async () => {
    const content = JSON.stringify({ text: 'Soru metni yeterince uzun', warnings: [] });
    const fetchImpl = vi.fn(async () => jsonResponse(envelope(content)));
    const { provider } = build(fetchImpl);
    const result = await provider.extract({ assetRef: 'local://q.png', mimeType: 'image/png' });
    expect(result.confidence).toBeLessThan(0.5);
  });

  it('16. no sensitive content is logged on the success or error path', async () => {
    // Import the mocked logger from setup (vitest hoists the mock).
    const { logger } = await import('../../src/infrastructure/logging/logger.js');
    const infoSpy = vi.mocked(logger.info);
    const errorSpy = vi.mocked(logger.error);
    const warnSpy = vi.mocked(logger.warn);
    infoSpy.mockClear();
    errorSpy.mockClear();
    warnSpy.mockClear();

    const secretText = 'SENSITIVE_STUDENT_QUESTION_9x9';
    const okFetch = vi.fn(async () =>
      jsonResponse(envelope(JSON.stringify({ text: secretText, confidence: 0.9, warnings: [] })))
    );
    await build(okFetch).provider.extract({ assetRef: 'local://q.png', mimeType: 'image/png' });

    const failFetch = vi.fn(async () => jsonResponse('boom', 400));
    await build(failFetch).provider
      .extract({ assetRef: 'local://q.png', mimeType: 'image/png' })
      .catch(() => undefined);

    const allCalls = JSON.stringify([
      ...infoSpy.mock.calls,
      ...errorSpy.mock.calls,
      ...warnSpy.mock.calls,
    ]);
    expect(allCalls).not.toContain(secretText);
    expect(allCalls).not.toContain('base64');
    expect(allCalls).not.toContain(PNG_BYTES.toString('base64'));
  });
});

describe('Phase 5F.9-A — OCR provider factory', () => {
  it('returns a MockOcrProvider when OCR_PROVIDER=mock', () => {
    const provider = createOcrProviderFromConfig(new FakeStorage(), makeConfig({ provider: 'mock' }));
    expect(provider).toBeInstanceOf(MockOcrProvider);
  });

  it('returns a RealVisionOcrProvider when openai is configured and egress is allowed', () => {
    const provider = createOcrProviderFromConfig(
      new FakeStorage(),
      makeConfig({ provider: 'openai', allowExternalProvider: true, apiKey: 'k' }),
      { fetchImpl: vi.fn() }
    );
    expect(provider).toBeInstanceOf(RealVisionOcrProvider);
  });

  it('FAILS FAST when egress is not explicitly allowed (never silently uses mock)', () => {
    expect(() =>
      createOcrProviderFromConfig(
        new FakeStorage(),
        makeConfig({ provider: 'openai', allowExternalProvider: false })
      )
    ).toThrow(OcrProviderError);
  });

  it('FAILS FAST when the real provider has no API key', () => {
    expect(() =>
      createOcrProviderFromConfig(
        new FakeStorage(),
        makeConfig({ provider: 'openai', allowExternalProvider: true, apiKey: '' })
      )
    ).toThrow(OcrProviderError);
  });
});
describe('Phase 5F.9-A — OCR provider flows through the existing pipeline', () => {
  it('injects OCR text + confidence into normalization and the review policy', async () => {
    const { PrismaClient } = await import('@prisma/client');
    const { QuestionAnalysisService } = await import(
      '../../src/application/services/ingestion/QuestionAnalysisService.js'
    );
    const { QuestionNormalizationService } = await import(
      '../../src/application/services/ingestion/QuestionNormalizationService.js'
    );
    const { QuestionIngestionService } = await import(
      '../../src/application/services/ingestion/QuestionIngestionService.js'
    );
    const { MockQuestionUnderstandingProvider } = await import(
      '../../src/infrastructure/ai/providers/MockQuestionUnderstandingProvider.js'
    );
    const { INGESTION_STATES } = await import('../../src/domain/ingestion/ingestionStateMachine.js');
    const { prisma } = await import('../setup.js');

    // A stub IOcrProvider standing in for the real vision provider — no network.
    const stubOcr = {
      getProviderName: () => 'stub-vision',
      isAvailable: async () => true,
      extract: vi.fn(async () => ({
        text: 'Synthetic: x² + 5x + 6 = 0 denkleminin köklerini bulunuz.',
        confidence: 0.91,
        metadata: { provider: 'stub-vision', model: 'stub', version: '1', processingTimeMs: 5 },
        warnings: [] as string[],
      })),
    };

    const ingestionService = new QuestionIngestionService(prisma as any);
    const analysisService = new QuestionAnalysisService(
      prisma as any,
      undefined,
      stubOcr as any,
      new MockQuestionUnderstandingProvider(),
      new QuestionNormalizationService()
    );

    // Clean slate for this suite's own rows.
    await prisma.questionInstance.deleteMany({});
    await prisma.questionIngestion.deleteMany({});
    await prisma.questionSource.deleteMany({});
    await prisma.studentProfile.deleteMany({});
    await prisma.user.deleteMany({});

    const user = await prisma.user.create({
      data: {
        email: `p5f9a-${Date.now()}@example.com`,
        firstName: 'P5F9A',
        lastName: 'Student',
        role: 'STUDENT',
        passwordHash: 'h',
      },
    });
    const profile = await prisma.studentProfile.create({
      data: { userId: user.id, grade: 11 },
    });

    const ingestion = await ingestionService.createIngestion(
      user.id,
      {
        ingestMethod: 'IMAGE_UPLOAD',
        originalAssetRef: 'local://stub.png',
        originalAssetMimeType: 'image/png',
      }
    );
    expect(ingestion.state).toBe(INGESTION_STATES.INGESTED);

    // Analyze WITHOUT skipOcr so the injected OCR provider is exercised.
    const result = await analysisService.analyzeIngestion(
      ingestion.id,
      user.id,
      'STUDENT',
      {}
    );

    // The stub provider was actually called (OCR is on the real path).
    expect(stubOcr.extract).toHaveBeenCalledTimes(1);

    // OCR text and confidence were persisted and normalized, and the state
    // advanced along the EXISTING state machine.
    const stored = await prisma.questionIngestion.findUnique({ where: { id: ingestion.id } });
    expect(stored!.rawExtractedText).toContain('denkleminin');
    expect(stored!.ocrConfidence).toBeCloseTo(0.91);
    expect(stored!.normalizedText).toBeTruthy();
    expect([INGESTION_STATES.ANALYZED, INGESTION_STATES.REVIEW_REQUIRED]).toContain(
      stored!.state
    );

    // OCR never created curriculum / microskill / successful mastery artefacts.
    expect(await prisma.questionSkillMapping.count()).toBe(0);
    expect(await prisma.curriculumCandidate.count()).toBe(0);
    expect(await prisma.question.count()).toBe(0);
    expect(result.ingestionId).toBe(ingestion.id);

    // Reference the profile so the fixture is used (keeps FK expectations explicit).
    expect(profile.id).toBeTruthy();
    void prisma;
    void PrismaClient;
  });
});
