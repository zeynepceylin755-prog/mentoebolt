import {
  IAIProvider,
  AIRequest,
  AIResponse,
} from '../../../domain/interfaces/ai/IAIProvider.js';
import { AiAnalysisError } from '../../../domain/errors/QuestionAnalysisErrors.js';
import { isValidConfidence } from '../../../domain/ingestion/confidencePolicy.js';
import { logger } from '../../logging/logger.js';
import type { ErrorAnalysisConfig } from './config/ErrorAnalysisConfig.js';

/**
 * RealErrorAnalysisProvider — Phase 5F.9-C
 *
 * A real, LLM-backed implementation of the existing `IAIProvider` contract,
 * specialised for ERROR ANALYSIS. It returns a hypothesis about the likely
 * TYPE/SOURCE of a student's mistake. It is never an authority:
 *
 *   - It NEVER decides correctness (the backend already decided the attempt is
 *     incorrect before this provider is invoked).
 *   - It NEVER selects an ErrorPattern id/code, a MicroSkill id, or invents a
 *     taxonomy entry. It only names one of the system's coarse error types.
 *   - It NEVER solves the question or produces a worked solution; Explanation AI
 *     is a later phase.
 *   - It NEVER persists anything. The existing ErrorAnalysisApplicationService
 *     remains responsible for governance, compatibility and persistence.
 *   - Nothing sensitive (question text, student answer, prompt, raw response, API
 *     key, student id) is ever logged.
 *
 * The transport is injectable so tests drive a deterministic fake HTTP boundary
 * without any real network call.
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

export interface RealErrorAnalysisProviderOptions {
  fetchImpl?: FetchLike;
  sleepImpl?: (ms: number) => Promise<void>;
}

/**
 * The coarse error-type vocabulary already supported by the repository. The
 * backend maps these through ERROR_TYPE_TO_CATEGORIES (governance resolver); the
 * AI may never return anything else.
 */
export const ERROR_ANALYSIS_TYPES = [
  'CONCEPT',
  'SKILL',
  'PREREQUISITE',
  'OPERATION',
  'READING',
  'CALCULATION',
  'ATTENTION',
  'OTHER',
] as const;

export type ErrorAnalysisType = (typeof ERROR_ANALYSIS_TYPES)[number];

/** Conservative confidence used when the model gives no usable number. */
export const CONSERVATIVE_FALLBACK_CONFIDENCE = 0.3;

/** Upper bound: the AI hypothesis is never presented as near-certain. */
const MAX_CONFIDENCE = 0.95;

const SYSTEM_PROMPT = `You are a mathematics diagnostics assistant for a learning platform.
You analyze why a STUDENT'S SUBMITTED ANSWER is incorrect, given the question and the SKILL being assessed.

STRICT RULES:
- The backend already decided the answer is incorrect. Do NOT judge or restate correctness.
- Do NOT solve the question. Do NOT provide a full solution, worked steps, or the correct answer.
- Do NOT invent steps the student did not attempt; only reason from the answer actually given.
- Distinguish EVIDENCE (what the answer shows) from HYPOTHESIS (what it might indicate).
- If the evidence is insufficient, return errorType "OTHER" with a LOW confidence.
- Choose errorType ONLY from: CONCEPT, SKILL, PREREQUISITE, OPERATION, READING, CALCULATION, ATTENTION, OTHER.
- NEVER return a database id or code. Do NOT return an ErrorPattern id, an ErrorPattern code, or a MicroSkill id.
- relatedSkills is optional free-text descriptions, never database identifiers.

Return ONLY valid JSON of the exact shape:
{
  "errorType": "CONCEPT" | "SKILL" | "PREREQUISITE" | "OPERATION" | "READING" | "CALCULATION" | "ATTENTION" | "OTHER",
  "confidence": number,
  "hypothesis": string,
  "relatedSkills": string[],
  "suggestion": string,
  "metadata": object
}
confidence must be a finite number in [0,1] and must be conservative.`;

/** Structured output of the provider, matching the existing contract. */
export interface StructuredErrorAnalysis {
  errorType: ErrorAnalysisType;
  confidence: number;
  hypothesis: string;
  relatedSkills: string[];
  suggestion: string;
  metadata: Record<string, unknown>;
}

interface ModelPayload {
  errorType: ErrorAnalysisType;
  confidence: number;
  hypothesis: string;
  relatedSkills: string[];
  suggestion: string;
  metadata: Record<string, unknown>;
}

/** A transient provider failure (timeout, network, 429, 5xx) — retryable. */
class TransientProviderError extends Error {
  constructor(message: string, public readonly retryAfterMs?: number) {
    super(message);
    this.name = 'TransientProviderError';
  }
}

export class RealErrorAnalysisProvider implements IAIProvider {
  private readonly config: ErrorAnalysisConfig;
  private readonly fetchImpl: FetchLike;
  private readonly sleepImpl: (ms: number) => Promise<void>;

  constructor(config: ErrorAnalysisConfig, options: RealErrorAnalysisProviderOptions = {}) {
    this.config = config;
    this.fetchImpl = options.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
    this.sleepImpl = options.sleepImpl ?? ((ms) => new Promise((r) => setTimeout(r, ms)));

    if (typeof this.fetchImpl !== 'function') {
      throw new AiAnalysisError('No fetch implementation available for the error analysis provider');
    }
  }

  getProviderName(): string {
    return `error-analysis-${this.config.provider}`;
  }

  getModelName(): string {
    return this.config.model;
  }

  getVersion(): string {
    // Truthful: the configured model identifier rather than an invented date.
    return this.config.model;
  }

  async isAvailable(): Promise<boolean> {
    return this.config.apiKey.trim().length > 0;
  }

  /**
   * Unstructured completion is not part of this provider's contract; the error
   * analysis path is structured-only. It exists to satisfy IAIProvider and fails
   * clearly rather than pretending to work.
   */
  async complete(_request: AIRequest): Promise<AIResponse> {
    throw new AiAnalysisError('Error analysis provider only supports structured completion');
  }

  async completeStructured<T>(request: AIRequest, _schema?: unknown): Promise<AIResponse & { structured: T }> {
    const startedAt = Date.now();
    const userPrompt = extractUserPrompt(request);

    const parsed = await this.callProvider(userPrompt);

    const structured: StructuredErrorAnalysis = {
      errorType: parsed.errorType,
      confidence: deriveConfidence(parsed.errorType, parsed.confidence),
      hypothesis: parsed.hypothesis,
      relatedSkills: parsed.relatedSkills,
      suggestion: parsed.suggestion,
      metadata: parsed.metadata,
    };

    logger.info(
      {
        provider: this.getProviderName(),
        model: this.config.model,
        processingTimeMs: Date.now() - startedAt,
        inputLength: userPrompt.length,
        errorType: structured.errorType,
        confidence: structured.confidence,
        status: 'ok',
      },
      'Error analysis completed'
    );

    return {
      content: JSON.stringify(structured),
      structured: structured as unknown as T,
      model: this.config.model,
      version: this.getVersion(),
      tokensUsed: 0,
      latencyMs: Date.now() - startedAt,
      finishReason: 'stop',
      confidence: structured.confidence,
    };
  }

  // ---------------------------------------------------------- provider call

  private async callProvider(userPrompt: string): Promise<ModelPayload> {
    const attempts = this.config.maxRetries + 1;

    for (let attempt = 0; attempt < attempts; attempt++) {
      try {
        return await this.performRequest(userPrompt);
      } catch (error) {
        if (!(error instanceof TransientProviderError)) {
          // Malformed JSON / invalid request / auth failure / 4xx: never retried.
          throw error instanceof AiAnalysisError
            ? error
            : new AiAnalysisError('Error analysis provider failed');
        }
        if (attempt >= attempts - 1) {
          throw new AiAnalysisError(
            `Error analysis provider failed after ${attempts} attempt(s)`
          );
        }
        const delayMs = error.retryAfterMs ?? Math.pow(2, attempt) * 500;
        logger.warn(
          { provider: this.getProviderName(), attempt: attempt + 1, attempts, status: 'retry' },
          'Error analysis transient failure, retrying'
        );
        await this.sleepImpl(delayMs);
      }
    }

    // Unreachable: the loop returns or throws.
    throw new AiAnalysisError('Error analysis provider failed');
  }

  private async performRequest(userPrompt: string): Promise<ModelPayload> {
    const url = `${this.config.baseUrl}/chat/completions`;
    const body = JSON.stringify({
      model: this.config.model,
      temperature: 0.2,
      // Phase 7.1 (cost control): bounded completion size.
      max_tokens: this.config.maxTokens,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
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
      if (error instanceof Error && error.name === 'AbortError') {
        throw new TransientProviderError('provider request timed out');
      }
      throw new TransientProviderError('provider request failed');
    }
    clearTimeout(timeoutId);

    if (!response.ok) {
      const status = response.status;
      if (status === 429 || status >= 500) {
        throw new TransientProviderError(
          `provider returned HTTP ${status}`,
          parseRetryAfterMs(response.headers?.get('retry-after'))
        );
      }
      throw new AiAnalysisError(`Error analysis provider rejected the request (HTTP ${status})`);
    }

    const raw = await response.text();
    return parseModelEnvelope(raw);
  }
}

// -------------------------------------------------------------------- helpers

/** Extract the user prompt from the request without ever logging it. */
function extractUserPrompt(request: AIRequest): string {
  const userMessage = request.messages.find((m) => m.role === 'user');
  return userMessage?.content ?? '';
}

/** Parse + validate the transport envelope and the model's JSON payload. */
export function parseModelEnvelope(raw: string): ModelPayload {
  let envelope: any;
  try {
    envelope = JSON.parse(raw);
  } catch {
    throw new AiAnalysisError('Error analysis provider returned malformed (non-JSON) response');
  }

  const content = envelope?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || content.trim().length === 0) {
    throw new AiAnalysisError('Error analysis provider response contained no content');
  }

  let payload: any;
  try {
    payload = JSON.parse(content);
  } catch {
    throw new AiAnalysisError('Error analysis provider content was not valid JSON');
  }

  return validatePayload(payload);
}

/**
 * Safety-boundary validation of the model's structured output. Anything the
 * backend relies on is re-established here, never trusted from the model.
 */
export function validatePayload(payload: any): ModelPayload {
  if (typeof payload !== 'object' || payload === null) {
    throw new AiAnalysisError('Error analysis payload is not an object');
  }

  // `errorType` must be one of the supported coarse types. An unsupported value
  // is REJECTED (never normalised into a pattern).
  const errorType = payload.errorType;
  if (typeof errorType !== 'string' || !isSupportedErrorType(errorType)) {
    throw new AiAnalysisError('Error analysis payload has an unsupported errorType');
  }

  if (!isValidConfidence(payload.confidence)) {
    throw new AiAnalysisError('Error analysis payload has an invalid confidence');
  }

  if ('errorPatternId' in payload || 'errorPatternCode' in payload || 'microSkillId' in payload) {
    throw new AiAnalysisError(
      'Error analysis payload may not contain authoritative taxonomy identifiers'
    );
  }

  // `hypothesis` is the classification rationale — required by the contract.
  // `suggestion` is recovery advice and is independently validated so it can
  // never be defaulted to an empty string and persisted as if it were evidence.
  if (typeof payload.hypothesis !== 'string' || payload.hypothesis.trim().length === 0) {
    throw new AiAnalysisError('Error analysis payload is missing hypothesis');
  }
  if (typeof payload.suggestion !== 'string' || payload.suggestion.trim().length === 0) {
    throw new AiAnalysisError('Error analysis payload is missing suggestion');
  }

  return {
    errorType,
    confidence: payload.confidence,
    hypothesis: payload.hypothesis,
    relatedSkills: Array.isArray(payload.relatedSkills)
      ? payload.relatedSkills.filter((x: unknown): x is string => typeof x === 'string' && x.length > 0)
      : [],
    suggestion: payload.suggestion,
    metadata:
      typeof payload.metadata === 'object' && payload.metadata !== null && !Array.isArray(payload.metadata)
        ? (payload.metadata as Record<string, unknown>)
        : {},
  };
}

/**
 * Conservative confidence: the model's number, capped so a hypothesis is never
 * presented as certain, and reduced when the model itself flagged OTHER.
 * Never inflated.
 */
export function deriveConfidence(errorType: ErrorAnalysisType, modelConfidence: number): number {
  let confidence = isValidConfidence(modelConfidence) ? modelConfidence : CONSERVATIVE_FALLBACK_CONFIDENCE;
  if (errorType === 'OTHER') {
    confidence = Math.min(confidence, CONSERVATIVE_FALLBACK_CONFIDENCE);
  }
  return Math.max(0, Math.min(MAX_CONFIDENCE, confidence));
}

function isSupportedErrorType(value: string): value is ErrorAnalysisType {
  return (ERROR_ANALYSIS_TYPES as readonly string[]).includes(value);
}

/** Honour Retry-After when it is a delay in seconds (capped). */
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
