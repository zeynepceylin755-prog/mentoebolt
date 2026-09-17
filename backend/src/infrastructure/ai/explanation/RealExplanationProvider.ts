import { IAIProvider, AIRequest, AIResponse } from '../../../domain/interfaces/ai/IAIProvider.js';
import { AiAnalysisError } from '../../../domain/errors/QuestionAnalysisErrors.js';
import {
  EXPLANATION_MODES,
  type ExplanationMode,
} from '../../../domain/ai/explanationPolicy.js';
import { logger } from '../../logging/logger.js';
import type { ExplanationConfig } from './config/ExplanationConfig.js';

/**
 * RealExplanationProvider — Phase 5F.9-D
 *
 * A real, LLM-backed implementation of the existing `IAIProvider` contract,
 * specialised for ANSWER-SUPPRESSING explanation / hint / Socratic guidance.
 *
 * Boundaries honoured:
 *   - The CANONICAL ANSWER IS NEVER PLACED IN THE REQUEST. This is enforced by
 *     construction: the request type has no field for it, so it cannot be passed
 *     even by mistake.
 *   - It is NOT an answer authority and never judges correctness.
 *   - It never persists anything and never mutates learning state.
 *   - Nothing sensitive (question, student answer, prompt, raw response, API key)
 *     is logged.
 *
 * The policy that inspects the OUTPUT lives in the application layer
 * (AIExplanationService), because a single regeneration attempt must be bounded
 * there — not retried indefinitely inside the transport.
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

export interface RealExplanationProviderOptions {
  fetchImpl?: FetchLike;
  sleepImpl?: (ms: number) => Promise<void>;
}

/**
 * The request the explanation provider accepts. Deliberately has NO
 * `correctAnswer` field: the canonical answer must never reach the model.
 */
export interface ExplanationModelRequest {
  mode: ExplanationMode;
  /** The question the student is working on (may be omitted for concept help). */
  question?: string;
  /** The student's own submitted answer — useful evidence, never an answer key. */
  studentAnswer?: string;
  /** Authoritative MicroSkill name (resolved by the backend). */
  skillName?: string;
  /** Authoritative MicroSkill description. */
  skillDescription?: string;
  /** Authoritative ErrorAnalysis signal, when one exists. */
  errorType?: string;
  errorHypothesis?: string;
  concept?: string;
  /**
   * Phase 6.4: the AUTHORITATIVE correctness of the attempt being guided. This is
   * a boolean ONLY — it is never the canonical answer, never the answer key, and
   * it exists so the guidance can stay consistent with the backend result (a
   * correct attempt must not be described as an error). Undefined means "not
   * communicated", in which case no claim about correctness may be made.
   */
  studentAnsweredCorrectly?: boolean;
  /** Feedback from a previous rejected attempt, bounded regeneration only. */
  policyFeedback?: string;
}

interface ModelPayload {
  explanation: string;
  stepByStep: string[];
  examples: string[];
  keyPoints: string[];
  practiceSuggestion: string;
}

/** A transient provider failure (timeout, network, 429, 5xx) — retryable. */
class TransientProviderError extends Error {
  constructor(message: string, public readonly retryAfterMs?: number) {
    super(message);
    this.name = 'TransientProviderError';
  }
}

const SYSTEM_PROMPT = `You are a Socratic mathematics coach for an 11th-grade student.
Your job is to help the student find the NEXT STEP THEMSELVES. You are NOT allowed to give the answer.

ABSOLUTE PROHIBITIONS:
- NEVER state the final answer, the final numeric result, or the correct option letter.
- NEVER give a complete or worked solution, and never enumerate the full chain of solution steps.
- NEVER write phrases such as "the answer is", "the correct answer is", "so the result is", "the correct option is".
- NEVER reveal the answer by elimination, e.g. "it is not 7, it is 8".
- NEVER compute a full arithmetic chain that effectively completes the question.
- NEVER pretend a solution is a hint by phrasing a full solution as advice.
- NEVER claim the student made a mistake when the attempt was evaluated as correct, and never deny a mistake when it was evaluated as incorrect.

WHAT YOU MAY DO:
- Name the likely misconception (evidence first, hypothesis second).
- Point out WHERE to look, or which condition matters.
- Remind the student of a relevant rule, definition or formula (without applying it to the final result).
- Ask ONE Socratic question that moves the student forward.
- Suggest ONE small, concrete next step.
- Explain why a particular step looks suspicious.

STYLE:
- Concise, encouraging, student-facing. Write in Turkish.
- "stepByStep" must contain at most 2 short guidance steps, NOT solution steps; use [] when unnecessary.

Return ONLY valid JSON of the exact shape:
{
  "explanation": string,
  "stepByStep": string[],
  "examples": string[],
  "keyPoints": string[],
  "practiceSuggestion": string
}`;

export class RealExplanationProvider implements IAIProvider {
  private readonly config: ExplanationConfig;
  private readonly fetchImpl: FetchLike;
  private readonly sleepImpl: (ms: number) => Promise<void>;

  constructor(config: ExplanationConfig, options: RealExplanationProviderOptions = {}) {
    this.config = config;
    this.fetchImpl = options.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
    this.sleepImpl = options.sleepImpl ?? ((ms) => new Promise((r) => setTimeout(r, ms)));

    if (typeof this.fetchImpl !== 'function') {
      throw new AiAnalysisError('No fetch implementation available for the explanation provider');
    }
  }

  getProviderName(): string {
    return `explanation-${this.config.provider}`;
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
   * Unstructured completion is not part of this provider's contract; the
   * explanation path is structured-only. It exists to satisfy IAIProvider and
   * fails clearly rather than pretending to work.
   */
  async complete(_request: AIRequest): Promise<AIResponse> {
    throw new AiAnalysisError('Explanation provider only supports structured completion');
  }

  /**
   * Generate guidance. `options.priorFeedback`, when present, is a bounded
   * regeneration hint produced by the answer-suppression policy.
   */
  async generateGuidance(
    input: ExplanationModelRequest,
    options: { priorFeedback?: string; signal?: unknown } = {}
  ): Promise<{ payload: ModelPayload; tokensUsed: number; latencyMs: number }> {
    const startedAt = Date.now();
    const prompt = buildPrompt(input, options.priorFeedback);
    const payload = await this.callProvider(prompt);

    logger.info(
      {
        provider: this.getProviderName(),
        model: this.config.model,
        mode: input.mode,
        processingTimeMs: Date.now() - startedAt,
        inputLength: prompt.length,
        outputLength: payload.explanation.length,
        status: 'ok',
      },
      'Explanation guidance generated'
    );

    return { payload, tokensUsed: 0, latencyMs: Date.now() - startedAt };
  }

  /** Validated structured completion, used by AIExplanationService. */
  async completeStructured<T>(request: AIRequest, _schema?: unknown): Promise<AIResponse & { structured: T }> {
    const startedAt = Date.now();
    const userPrompt = request.messages.find((m) => m.role === 'user')?.content ?? '';
    const payload = await this.callProvider(userPrompt);

    return {
      content: JSON.stringify(payload),
      structured: payload as unknown as T,
      model: this.config.model,
      version: this.getVersion(),
      tokensUsed: 0,
      latencyMs: Date.now() - startedAt,
      finishReason: 'stop',
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
            : new AiAnalysisError('Explanation provider failed');
        }
        if (attempt >= attempts - 1) {
          throw new AiAnalysisError(`Explanation provider failed after ${attempts} attempt(s)`);
        }
        const delayMs = error.retryAfterMs ?? Math.pow(2, attempt) * 500;
        logger.warn(
          { provider: this.getProviderName(), attempt: attempt + 1, attempts, status: 'retry' },
          'Explanation transient failure, retrying'
        );
        await this.sleepImpl(delayMs);
      }
    }

    // Unreachable: the loop returns or throws.
    throw new AiAnalysisError('Explanation provider failed');
  }

  private async performRequest(userPrompt: string): Promise<ModelPayload> {
    const url = `${this.config.baseUrl}/chat/completions`;
    const body = JSON.stringify({
      model: this.config.model,
      temperature: 0.4,
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
      throw new AiAnalysisError(`Explanation provider rejected the request (HTTP ${status})`);
    }

    const raw = await response.text();
    return parseModelEnvelope(raw);
  }
}

// -------------------------------------------------------------------- prompt

/**
 * Build the provider prompt. NOTE: there is intentionally no parameter for the
 * canonical answer — it must never be added here.
 */
export function buildPrompt(input: ExplanationModelRequest, priorFeedback?: string): string {
  const lines: string[] = [];

  lines.push(`Requested guidance mode: ${input.mode}`);

  if (input.concept) {
    lines.push(`Concept: ${input.concept}`);
  }
  if (input.skillName) {
    lines.push(
      `Authoritative skill being assessed: ${input.skillName}` +
        (input.skillDescription ? ` — ${input.skillDescription}` : '')
    );
  }
  if (input.errorType) {
    lines.push(
      `Previously diagnosed error category: ${input.errorType}` +
        (input.errorHypothesis ? ` (hypothesis: ${input.errorHypothesis})` : '')
    );
  }

  // Phase 6.4: a boolean correctness signal, never the answer. It keeps the
  // guidance consistent with the authoritative result and prevents the model from
  // inventing an error on a correct attempt (or denying one on an incorrect one).
  if (input.studentAnsweredCorrectly === true) {
    lines.push(
      'The backend evaluated this attempt as CORRECT.',
      'Do NOT claim or imply that the student made a mistake, and do NOT state the answer.'
    );
  } else if (input.studentAnsweredCorrectly === false) {
    lines.push(
      'The backend evaluated this attempt as INCORRECT.',
      'Do NOT state the correct answer; guide the student toward reconsidering their reasoning.'
    );
  }

  if (input.question) {
    lines.push('', 'Question:', input.question);
  }
  if (input.studentAnswer) {
    lines.push('', "The student's submitted answer (evidence only, NOT an answer key):", input.studentAnswer);
  }

  lines.push(
    '',
    'Produce short, student-facing guidance for the chosen mode.',
    'Do NOT state or imply the final answer and do NOT provide a worked solution.'
  );

  if (priorFeedback) {
    lines.push(
      '',
      'IMPORTANT — your previous response was rejected by the safety policy:',
      priorFeedback,
      'Rewrite the guidance so it contains no answer and no complete solution.'
    );
  }

  return lines.join('\n');
}

// -------------------------------------------------------------------- helpers

/** Parse + validate the transport envelope and the model's JSON payload. */
export function parseModelEnvelope(raw: string): ModelPayload {
  let envelope: any;
  try {
    envelope = JSON.parse(raw);
  } catch {
    throw new AiAnalysisError('Explanation provider returned malformed (non-JSON) response');
  }

  const content = envelope?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || content.trim().length === 0) {
    throw new AiAnalysisError('Explanation provider response contained no content');
  }

  let payload: any;
  try {
    payload = JSON.parse(content);
  } catch {
    throw new AiAnalysisError('Explanation provider content was not valid JSON');
  }

  return validatePayload(payload);
}

/** Safety-boundary validation of the model's structured output. */
export function validatePayload(payload: any): ModelPayload {
  if (typeof payload !== 'object' || payload === null) {
    throw new AiAnalysisError('Explanation payload is not an object');
  }

  if (typeof payload.explanation !== 'string' || payload.explanation.trim().length === 0) {
    throw new AiAnalysisError('Explanation payload is missing explanation');
  }

  return {
    explanation: payload.explanation,
    stepByStep: toStringArray(payload.stepByStep),
    examples: toStringArray(payload.examples),
    keyPoints: toStringArray(payload.keyPoints),
    practiceSuggestion:
      typeof payload.practiceSuggestion === 'string' ? payload.practiceSuggestion : '',
  };
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((x): x is string => typeof x === 'string' && x.trim().length > 0);
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

export { EXPLANATION_MODES };
