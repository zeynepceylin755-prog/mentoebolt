import { IOcrProvider, OcrInput, OcrResult } from '../../domain/interfaces/ocr/IOcrProvider.js';
import { IStorageProvider } from '../../domain/interfaces/storage/IStorageProvider.js';
import { OcrProviderError } from '../../domain/errors/QuestionAnalysisErrors.js';
import { logger } from '../logging/logger.js';
import type { OcrConfig } from './config/OcrConfig.js';

/**
 * RealVisionOcrProvider — Phase 5F.9-A
 *
 * Performs math-aware OCR using a multimodal vision model, behind the EXISTING
 * IOcrProvider contract. It does NOT solve the question: it only transcribes it,
 * preserving mathematical notation.
 *
 * Boundaries honoured:
 *   - Bytes come ONLY from IStorageProvider (no direct filesystem access).
 *   - No Question / MicroSkill / curriculum / ErrorPattern is ever written here.
 *   - Errors surface as OcrProviderError so the existing ingestion flow stays
 *     authoritative and retryable.
 *   - Nothing sensitive (image bytes, base64, extracted text, prompt, raw
 *     response) is logged.
 *
 * The transport is injectable so tests can drive a deterministic fake HTTP
 * boundary without any real network call.
 */

/** Minimal fetch-compatible transport, injectable for tests. */
export type FetchLike = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body: string;
    signal?: unknown;
  }
) => Promise<{
  ok: boolean;
  status: number;
  headers?: { get(name: string): string | null };
  text(): Promise<string>;
}>;

export interface RealVisionOcrProviderOptions {
  /** Injectable transport; defaults to global fetch. */
  fetchImpl?: FetchLike;
  /** Injectable sleep for deterministic backoff in tests. */
  sleepImpl?: (ms: number) => Promise<void>;
}

/** MIME types the vision provider will send to the model. */
const SUPPORTED_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

/**
 * Conservative baseline confidence used when the model does not return a usable
 * numeric confidence. It sits BELOW the low-confidence threshold (0.5), so an
 * unquantified extraction always takes the review-required path rather than
 * being treated as trusted.
 */
const CONSERVATIVE_FALLBACK_CONFIDENCE = 0.4;

const SYSTEM_PROMPT = `You are performing mathematical OCR. You transcribe the question exactly as it appears in the image.

STRICT RULES:
- Do NOT solve the question.
- Do NOT invent or guess missing information.
- Do NOT simplify or restate the mathematical problem.
- Do NOT add explanations, answers or commentary.

Preserve faithfully:
- mathematical notation, equation structure
- fractions, exponents/powers, radicals/square roots, subscripts, superscripts
- inequalities, parentheses and brackets
- matrices and multi-line expressions
- Greek letters and mathematical symbols
- Turkish characters
- line structure where it is meaningful

If a symbol cannot be read reliably, do NOT hallucinate it: leave a marker such as [?] in place and list the uncertainty.

Respond ONLY with valid JSON of the exact shape:
{"text": string, "confidence": number, "warnings": string[]}
where "confidence" is your own bounded estimate (0..1) of how accurately you transcribed the content, and "warnings" is an array of short strings (may be empty).`;

export class RealVisionOcrProvider implements IOcrProvider {
  private readonly provider: string;
  private readonly config: OcrConfig;
  private readonly storage: IStorageProvider;
  private readonly fetchImpl: FetchLike;
  private readonly sleepImpl: (ms: number) => Promise<void>;

  constructor(
    storage: IStorageProvider,
    config: OcrConfig,
    options: RealVisionOcrProviderOptions = {}
  ) {
    this.storage = storage;
    this.config = config;
    this.provider = `vision-${config.provider}`;
    this.fetchImpl = options.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
    this.sleepImpl = options.sleepImpl ?? ((ms) => new Promise((r) => setTimeout(r, ms)));

    if (typeof this.fetchImpl !== 'function') {
      throw new OcrProviderError('No fetch implementation available for the vision OCR provider');
    }
  }

  getProviderName(): string {
    return this.provider;
  }

  async isAvailable(): Promise<boolean> {
    return this.config.apiKey.trim().length > 0;
  }

  async extract(input: OcrInput): Promise<OcrResult> {
    const startedAt = Date.now();

    if (!input || typeof input.assetRef !== 'string' || input.assetRef.trim().length === 0) {
      throw new OcrProviderError('OCR extraction requires a non-empty assetRef');
    }

    // 1. Resolve bytes through the storage abstraction — never the filesystem.
    const data = input.data ?? (await this.storage.read(input.assetRef));
    if (!data || data.byteLength === 0) {
      throw new OcrProviderError('OCR extraction failed: asset could not be read from storage');
    }

    // Phase 7.1 (cost control): reject an oversized asset BEFORE any external
    // request, so a single upload can never drive an unbounded model call.
    if (data.byteLength > this.config.maxImageBytes) {
      throw new OcrProviderError(
        `OCR extraction failed: asset exceeds the ${this.config.maxImageBytes} byte limit`
      );
    }

    // 2. Verify MIME type (from the caller or the declared asset metadata).
    const mimeType = this.resolveMimeType(input.mimeType, data);

    // 3. Call the provider with bounded retries/timeout.
    const { text, confidence, warnings, model, version } = await this.callProvider(data, mimeType);

    const extracted = text.trim();
    if (extracted.length === 0) {
      // An empty extraction is a FAILURE, not a successful empty OCR.
      throw new OcrProviderError('OCR extraction returned empty text');
    }

    const processingTimeMs = Date.now() - startedAt;

    // Safe, content-free log: identifiers and metadata only.
    logger.info(
      {
        provider: this.provider,
        model,
        processingTimeMs,
        textLength: extracted.length,
        warningsCount: warnings.length,
        status: 'ok',
      },
      'Vision OCR completed'
    );

    return {
      text: extracted,
      confidence,
      metadata: {
        provider: this.provider,
        model,
        version,
        processingTimeMs,
      },
      warnings,
    };
  }

  /**
   * Resolve the MIME type, verifying it against the allowed set. A declared
   * value that is not supported is rejected rather than guessed.
   */
  private resolveMimeType(declared: string | undefined, data: Buffer): string {
    const normalized = (declared ?? inferMimeFromMagicBytes(data) ?? '').toLowerCase();
    if (!SUPPORTED_MIME_TYPES.includes(normalized)) {
      throw new OcrProviderError(
        `OCR extraction failed: unsupported MIME type "${normalized || 'unknown'}"`
      );
    }
    return normalized;
  }

  /**
   * Perform the provider call with bounded retries for TRANSIENT failures only.
   * Non-transient failures (4xx other than 429, malformed responses) fail fast.
   */
  private async callProvider(
    data: Buffer,
    mimeType: string
  ): Promise<{ text: string; confidence: number; warnings: string[]; model: string; version: string }> {
    const attempts = this.config.maxRetries + 1;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < attempts; attempt++) {
      try {
        return await this.performRequest(data, mimeType);
      } catch (error) {
        // Non-transient failures (e.g. malformed response, non-retryable 4xx)
        // are already OcrProviderError and must fail fast.
        if (!(error instanceof TransientProviderError)) {
          throw error;
        }

        lastError = error;

        // Transient but out of attempts: surface as a domain OCR error so the
        // existing ingestion flow can wrap/retry it consistently.
        if (attempt >= attempts - 1) {
          throw new OcrProviderError(`OCR extraction failed after ${attempts} attempt(s): ${error.message}`);
        }

        const delayMs = error.retryAfterMs ?? Math.pow(2, attempt) * 500;
        logger.warn(
          { provider: this.provider, attempt: attempt + 1, attempts, status: 'retry' },
          'Vision OCR transient failure, retrying'
        );
        await this.sleepImpl(delayMs);
      }
    }

    // Unreachable: the loop either returns or throws. Kept for type-safety.
    throw lastError ?? new OcrProviderError('OCR extraction failed');
  }

  private async performRequest(
    data: Buffer,
    mimeType: string
  ): Promise<{ text: string; confidence: number; warnings: string[]; model: string; version: string }> {
    const url = `${this.config.baseUrl}/chat/completions`;
    const body = JSON.stringify({
      model: this.config.model,
      temperature: 0,
      // Phase 7.1 (cost control): bounded completion size.
      max_tokens: this.config.maxTokens,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: 'Transcribe the mathematical question in this image. Respond with the JSON object only.',
            },
            {
              type: 'image_url',
              image_url: { url: `data:${mimeType};base64,${data.toString('base64')}` },
            },
          ],
        },
      ],
    });

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeoutMs);

    let response: Awaited<ReturnType<FetchLike>>;
    try {
      response = await this.fetchImpl(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body,
        signal: controller.signal,
      });
    } catch (error) {
      clearTimeout(timeoutId);
      const message = error instanceof Error ? error.message : String(error);
      const isAbort = error instanceof Error && error.name === 'AbortError';
      // Timeout and network errors are transient; never include payload content.
      if (isAbort) {
        throw new TransientProviderError('provider request timed out');
      }
      throw new TransientProviderError(`provider request failed: ${message}`);
    }
    clearTimeout(timeoutId);

    if (!response.ok) {
      const status = response.status;
      // Classify: 429 and 5xx are transient; other 4xx are not retryable.
      if (status === 429 || status >= 500) {
        const retryAfterMs = parseRetryAfterMs(response.headers?.get('retry-after'));
        throw new TransientProviderError(`provider returned HTTP ${status}`, retryAfterMs);
      }
      throw new OcrProviderError(`OCR provider rejected the request (HTTP ${status})`);
    }

    const raw = await response.text();
    return this.parseResponse(raw);
  }

  /**
   * Parse and validate the provider response. A malformed or structurally
   * incomplete body is rejected — it is never silently converted into a
   * successful (possibly empty) OCR result.
   */
  private parseResponse(
    raw: string
  ): { text: string; confidence: number; warnings: string[]; model: string; version: string } {
    let envelope: any;
    try {
      envelope = JSON.parse(raw);
    } catch {
      throw new OcrProviderError('OCR provider returned a malformed (non-JSON) response');
    }

    const content = envelope?.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || content.trim().length === 0) {
      throw new OcrProviderError('OCR provider response contained no content');
    }

    let payload: any;
    try {
      payload = JSON.parse(content);
    } catch {
      throw new OcrProviderError('OCR provider content was not valid JSON');
    }

    if (typeof payload?.text !== 'string') {
      throw new OcrProviderError('OCR provider response is missing required "text" field');
    }

    const warnings = Array.isArray(payload.warnings)
      ? payload.warnings.filter((w: unknown): w is string => typeof w === 'string')
      : [];

    return {
      text: payload.text,
      confidence: clampConfidence(payload.confidence),
      warnings,
      model: typeof envelope.model === 'string' ? envelope.model : this.config.model,
      version: typeof envelope.created === 'number' ? String(envelope.created) : 'unknown',
    };
  }
}

/** A transient provider failure (timeout, network, 429, 5xx) — retryable. */
class TransientProviderError extends Error {
  constructor(message: string, public readonly retryAfterMs?: number) {
    super(message);
    this.name = 'TransientProviderError';
  }
}

/**
 * Clamp the model's confidence into [0,1]. A missing or non-numeric confidence
 * becomes a CONSERVATIVE low value so the existing review policy treats it as
 * untrusted — we never invent a high confidence just because text was returned.
 */
export function clampConfidence(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) {
    return CONSERVATIVE_FALLBACK_CONFIDENCE;
  }
  return Math.max(0, Math.min(1, n));
}

/** Honour Retry-After when it is a delay in seconds. */
function parseRetryAfterMs(header: string | null | undefined): number | undefined {
  if (!header) {
    return undefined;
  }
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(seconds * 1000, 10000);
  }
  return undefined;
}

/** Best-effort MIME detection from magic bytes when none was declared. */
function inferMimeFromMagicBytes(data: Buffer): string | null {
  if (data.length < 4) {
    return null;
  }
  if (data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47) {
    return 'image/png';
  }
  if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    data.length >= 12 &&
    data.toString('ascii', 0, 4) === 'RIFF' &&
    data.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}
