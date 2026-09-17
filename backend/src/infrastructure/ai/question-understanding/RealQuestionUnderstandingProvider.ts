import {
  IQuestionUnderstandingProvider,
  QuestionUnderstandingRequest,
  QuestionUnderstandingResponse,
} from '../../../domain/interfaces/ai/IQuestionUnderstandingProvider.js';
import {
  QuestionUnderstandingProposal,
  CurriculumCandidateProposal,
  MicroSkillCandidateProposal,
} from '../../../domain/ingestion/questionUnderstandingProposal.js';
import { AiAnalysisError } from '../../../domain/errors/QuestionAnalysisErrors.js';
import { isValidConfidence } from '../../../domain/ingestion/confidencePolicy.js';
import { logger } from '../../logging/logger.js';
import type { QuestionUnderstandingConfig } from './config/QuestionUnderstandingConfig.js';

/**
 * RealQuestionUnderstandingProvider — Phase 5F.9-B
 *
 * A real, LLM-backed implementation of the EXISTING IQuestionUnderstandingProvider
 * contract. It analyzes an already normalized question and PROPOSES question
 * understanding, curriculum candidates and MicroSkill candidates.
 *
 * Boundaries honoured:
 *   - It NEVER persists anything (no QuestionSkillMapping / CurriculumCandidate /
 *     MicroSkill / curriculum writes). The deterministic backend services decide
 *     what is valid and what may be stored.
 *   - It NEVER invents curriculum or MicroSkill IDs: every candidate must be one
 *     of the identifiers supplied in `curriculumContext`, or the response is
 *     rejected. Semantic chain validation remains the job of the existing
 *     CurriculumProposalValidator / MicroSkillProposalValidator.
 *   - It NEVER solves the question and is never an answer authority.
 *   - Nothing sensitive (question text, prompt, raw response, API key) is logged.
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

export interface RealQuestionUnderstandingProviderOptions {
  fetchImpl?: FetchLike;
  sleepImpl?: (ms: number) => Promise<void>;
}

/** Confidence used when the model gives no usable number (below the 0.5 gate). */
export const CONSERVATIVE_FALLBACK_CONFIDENCE = 0.3;

const MAX_CANDIDATES = 8;

const SYSTEM_PROMPT = `You are a mathematics education analyst for an 11th-grade curriculum.
You CLASSIFY a question for a learning path. You do NOT solve it and you are NOT an answer authority.

STRICT RULES:
- Never invent curriculum identifiers (LearningOutcome, ProcessComponent) or MicroSkill identifiers.
- Only select identifiers that appear in the provided CURRICULUM CONTEXT.
- Never create, rename or assume the validity of an unfamiliar code.
- Do NOT solve the question, produce an answer, or explain the solution.
- Preserve mathematical meaning. Treat these OCR ambiguities carefully and do NOT silently pick an interpretation: x² vs x2, √x vs x, 1/2 vs 12, ≤ vs <, ≥ vs >, sin²x vs sin 2x, f(x) vs fx, (a,b) vs ab.
- If the question is ambiguous or context is insufficient, return FEWER or NO candidates and lower the confidence; add a warning.

Return ONLY valid JSON of the exact shape:
{
  "questionUnderstanding": {
    "questionType": string,
    "mathematicalObjects": string[],
    "requestedOperation": string,
    "constraints": string[]
  },
  "curriculumCandidates": [ { "level": "LEARNING_OUTCOME"|"PROCESS_COMPONENT", "targetId": string, "confidence": number, "rationale": string } ],
  "microSkillCandidates": [ { "microSkillId": string, "confidence": number, "rationale": string } ],
  "confidence": number,
  "warnings": string[]
}
All confidence values must be finite numbers in [0,1]. Rationale is a short justification, never authoritative evidence.`;

export class RealQuestionUnderstandingProvider implements IQuestionUnderstandingProvider {
  private readonly config: QuestionUnderstandingConfig;
  private readonly fetchImpl: FetchLike;
  private readonly sleepImpl: (ms: number) => Promise<void>;

  constructor(
    config: QuestionUnderstandingConfig,
    options: RealQuestionUnderstandingProviderOptions = {}
  ) {
    this.config = config;
    this.fetchImpl = options.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
    this.sleepImpl = options.sleepImpl ?? ((ms) => new Promise((r) => setTimeout(r, ms)));

    if (typeof this.fetchImpl !== 'function') {
      throw new AiAnalysisError('No fetch implementation available for the question understanding provider');
    }
  }

  getProviderName(): string {
    return `question-understanding-${this.config.provider}`;
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

  async analyze(request: QuestionUnderstandingRequest): Promise<QuestionUnderstandingResponse> {
    const startedAt = Date.now();

    if (!request || typeof request.normalizedText !== 'string' || request.normalizedText.trim().length === 0) {
      throw new AiAnalysisError('Question understanding requires non-empty normalizedText');
    }

    // Phase 7.1 (cost control): bound the normalized-text input size. An oversized
    // question is rejected rather than forwarded, so a single request can never
    // drive an unbounded prompt. The bound is configuration-driven.
    if (request.normalizedText.length > this.config.maxInputChars) {
      throw new AiAnalysisError(
        `Question understanding input exceeds the ${this.config.maxInputChars} character limit`
      );
    }

    const contextIndex = buildContextIndex(request.curriculumContext);
    const prompt = this.buildPrompt(request, contextIndex);

    let parsed: ParsedModelOutput;
    try {
      parsed = await this.callProvider(prompt);
    } catch (error) {
      // Never echo question content. Log metadata only.
      logger.error(
        {
          provider: this.getProviderName(),
          model: this.config.model,
          status: 'error',
          errorClass: error instanceof Error ? error.name : 'UnknownError',
          inputLength: request.normalizedText.length,
        },
        'Question understanding provider call failed'
      );
      throw error instanceof AiAnalysisError
        ? error
        : new AiAnalysisError('Question understanding provider failed');
    }

    const { proposal, confidence, warnings } = this.toProposal(parsed, request, contextIndex, startedAt);

    logger.info(
      {
        provider: this.getProviderName(),
        model: this.config.model,
        processingTimeMs: Date.now() - startedAt,
        inputLength: request.normalizedText.length,
        curriculumCandidateCount: proposal.curriculumCandidates.length,
        microSkillCandidateCount: proposal.microSkillCandidates.length,
        confidence,
        warningsCount: warnings.length,
        status: 'ok',
      },
      'Question understanding completed'
    );

    return { proposal, confidence, warnings };
  }

  // ------------------------------------------------------------------ prompt

  private buildPrompt(request: QuestionUnderstandingRequest, index: ContextIndex): string {
    if (!index.hasAny) {
      return [
        'CURRICULUM CONTEXT: (none provided)',
        '',
        'No curriculum context was supplied. Return empty curriculumCandidates and',
        'empty microSkillCandidates, a low confidence, and a warning explaining that',
        'no curriculum context was available.',
        '',
        'QUESTION (normalized):',
        request.normalizedText,
      ].join('\n');
    }

    const outcomes = index.learningOutcomes
      .map((lo) => `- id=${lo.id} code=${lo.code} :: ${truncate(lo.text, 200)}`)
      .join('\n');
    const components = index.processComponents
      .map(
        (pc) =>
          `- id=${pc.id} code=${pc.code} parentLearningOutcomeId=${pc.learningOutcomeId} :: ${truncate(pc.text, 200)}`
      )
      .join('\n');
    const microSkills = index.microSkills
      .map(
        (ms) =>
          `- id=${ms.id} code=${ms.code} parentProcessComponentId=${ms.processComponentId} :: ${truncate(ms.name, 120)} — ${truncate(ms.description, 200)}`
      )
      .join('\n');

    return [
      'CURRICULUM CONTEXT (select ids ONLY from here):',
      '',
      'LearningOutcomes:',
      outcomes || '(none)',
      '',
      'ProcessComponents:',
      components || '(none)',
      '',
      'MicroSkills:',
      microSkills || '(none)',
      '',
      'QUESTION (normalized):',
      request.normalizedText,
      '',
      'Classify the question and select the best-fitting curriculum and MicroSkill candidates from the context above.',
    ].join('\n');
  }

  // --------------------------------------------------------- provider call

  private async callProvider(prompt: string): Promise<ParsedModelOutput> {
    const attempts = this.config.maxRetries + 1;

    for (let attempt = 0; attempt < attempts; attempt++) {
      try {
        return await this.performRequest(prompt);
      } catch (error) {
        if (!(error instanceof TransientProviderError)) {
          throw error;
        }
        if (attempt >= attempts - 1) {
          throw new AiAnalysisError(
            `Question understanding provider failed after ${attempts} attempt(s)`
          );
        }
        const delayMs = error.retryAfterMs ?? Math.pow(2, attempt) * 500;
        logger.warn(
          { provider: this.getProviderName(), attempt: attempt + 1, attempts, status: 'retry' },
          'Question understanding transient failure, retrying'
        );
        await this.sleepImpl(delayMs);
      }
    }

    // Unreachable: the loop returns or throws.
    throw new AiAnalysisError('Question understanding provider failed');
  }

  private async performRequest(prompt: string): Promise<ParsedModelOutput> {
    const url = `${this.config.baseUrl}/chat/completions`;
    const body = JSON.stringify({
      model: this.config.model,
      temperature: 0,
      // Phase 7.1 (cost control): bounded completion size.
      max_tokens: this.config.maxTokens,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: prompt },
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
      throw new AiAnalysisError(`Question understanding provider rejected the request (HTTP ${status})`);
    }

    const raw = await response.text();
    return parseModelEnvelope(raw, this.config.model);
  }

  // ------------------------------------------------------------- projection

  private toProposal(
    parsed: ParsedModelOutput,
    request: QuestionUnderstandingRequest,
    index: ContextIndex,
    _startedAt: number
  ): { proposal: QuestionUnderstandingProposal; confidence: number; warnings: string[] } {
    const warnings: string[] = [...parsed.warnings];

    const curriculumCandidates: CurriculumCandidateProposal[] = [];
    for (const candidate of parsed.curriculumCandidates.slice(0, MAX_CANDIDATES)) {
      if (!index.hasCurriculumTarget(candidate.level, candidate.targetId)) {
        // The model referenced an id outside the supplied context: DROP it and warn
        // rather than fabricating/forwarding it. Domain validators would reject it
        // anyway; this keeps the proposal honest.
        warnings.push('Discarded a curriculum candidate not present in the supplied context');
        continue;
      }
      curriculumCandidates.push(candidate);
    }

    const microSkillCandidates: MicroSkillCandidateProposal[] = [];
    for (const candidate of parsed.microSkillCandidates.slice(0, MAX_CANDIDATES)) {
      if (!index.hasMicroSkill(candidate.microSkillId)) {
        warnings.push('Discarded a MicroSkill candidate not present in the supplied context');
        continue;
      }
      microSkillCandidates.push(candidate);
    }

    if (!index.hasAny && (curriculumCandidates.length > 0 || microSkillCandidates.length > 0)) {
      // Defensive: with no context, no candidate can be valid.
      curriculumCandidates.length = 0;
      microSkillCandidates.length = 0;
      warnings.push('No curriculum context was available; no candidates proposed');
    }

    const confidence = deriveConfidence(parsed.confidence, curriculumCandidates, microSkillCandidates, warnings);

    const proposal: QuestionUnderstandingProposal = {
      ingestionId: request.ingestionId,
      normalizedText: request.normalizedText,
      questionUnderstanding: parsed.questionUnderstanding,
      curriculumCandidates,
      microSkillCandidates,
      confidence,
      warnings,
      modelMetadata: {
        provider: this.getProviderName(),
        model: this.config.model,
        version: this.getVersion(),
        timestamp: new Date().toISOString(),
      },
    };

    return { proposal, confidence, warnings };
  }
}

// -------------------------------------------------------------------- helpers

interface ContextIndex {
  hasAny: boolean;
  learningOutcomes: Array<{ id: string; code: string; text: string }>;
  processComponents: Array<{ id: string; code: string; text: string; learningOutcomeId: string }>;
  microSkills: Array<{ id: string; code: string; name: string; description: string; processComponentId: string }>;
  hasCurriculumTarget(level: string, id: string): boolean;
  hasMicroSkill(id: string): boolean;
}

/** A transient provider failure (timeout, network, 429, 5xx) — retryable. */
class TransientProviderError extends Error {
  constructor(message: string, public readonly retryAfterMs?: number) {
    super(message);
    this.name = 'TransientProviderError';
  }
}

interface ParsedModelOutput {
  questionUnderstanding: {
    questionType: string;
    mathematicalObjects: string[];
    requestedOperation?: string;
    constraints?: string[];
  };
  curriculumCandidates: CurriculumCandidateProposal[];
  microSkillCandidates: MicroSkillCandidateProposal[];
  confidence: number;
  warnings: string[];
}

export function buildContextIndex(
  context: QuestionUnderstandingRequest['curriculumContext']
): ContextIndex {
  const learningOutcomes = context?.learningOutcomes ?? [];
  const processComponents = context?.processComponents ?? [];
  const microSkills = context?.microSkills ?? [];

  const loIds = new Set(learningOutcomes.map((lo) => lo.id));
  const pcIds = new Set(processComponents.map((pc) => pc.id));
  const msIds = new Set(microSkills.map((ms) => ms.id));

  return {
    hasAny: learningOutcomes.length > 0 || processComponents.length > 0 || microSkills.length > 0,
    learningOutcomes,
    processComponents,
    microSkills,
    hasCurriculumTarget(level, id) {
      if (level === 'LEARNING_OUTCOME') return loIds.has(id);
      if (level === 'PROCESS_COMPONENT') return pcIds.has(id);
      return false;
    },
    hasMicroSkill(id) {
      return msIds.has(id);
    },
  };
}

/** Parse + validate the transport envelope and the model's JSON payload. */
export function parseModelEnvelope(raw: string, configuredModel: string): ParsedModelOutput {
  let envelope: any;
  try {
    envelope = JSON.parse(raw);
  } catch {
    throw new AiAnalysisError('Question understanding provider returned malformed (non-JSON) response');
  }

  const content = envelope?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || content.trim().length === 0) {
    throw new AiAnalysisError('Question understanding provider response contained no content');
  }

  let payload: any;
  try {
    payload = JSON.parse(content);
  } catch {
    throw new AiAnalysisError('Question understanding provider content was not valid JSON');
  }

  void configuredModel;
  return validatePayload(payload);
}

/** Safety-boundary validation of the model's structured output. */
export function validatePayload(payload: any): ParsedModelOutput {
  if (typeof payload !== 'object' || payload === null) {
    throw new AiAnalysisError('Question understanding payload is not an object');
  }

  const qu = payload.questionUnderstanding;
  if (typeof qu !== 'object' || qu === null || typeof qu.questionType !== 'string') {
    throw new AiAnalysisError('Question understanding payload is missing questionUnderstanding.questionType');
  }

  const confidence = payload.confidence;
  if (!isValidConfidence(confidence)) {
    throw new AiAnalysisError('Question understanding payload has an invalid confidence');
  }

  const warnings = Array.isArray(payload.warnings)
    ? payload.warnings.filter((w: unknown): w is string => typeof w === 'string')
    : [];

  const curriculumCandidates = validateCurriculumCandidates(payload.curriculumCandidates);
  const microSkillCandidates = validateMicroSkillCandidates(payload.microSkillCandidates);

  return {
    questionUnderstanding: {
      questionType: qu.questionType,
      mathematicalObjects: Array.isArray(qu.mathematicalObjects)
        ? qu.mathematicalObjects.filter((x: unknown): x is string => typeof x === 'string')
        : [],
      requestedOperation: typeof qu.requestedOperation === 'string' ? qu.requestedOperation : undefined,
      constraints: Array.isArray(qu.constraints)
        ? qu.constraints.filter((x: unknown): x is string => typeof x === 'string')
        : [],
    },
    curriculumCandidates,
    microSkillCandidates,
    confidence,
    warnings,
  };
}

function validateCurriculumCandidates(value: unknown): CurriculumCandidateProposal[] {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new AiAnalysisError('curriculumCandidates must be an array');
  }
  const out: CurriculumCandidateProposal[] = [];
  for (const c of value) {
    if (typeof c !== 'object' || c === null) {
      throw new AiAnalysisError('curriculum candidate must be an object');
    }
    const level = (c as any).level;
    if (level !== 'LEARNING_OUTCOME' && level !== 'PROCESS_COMPONENT') {
      throw new AiAnalysisError(`Invalid curriculum candidate level: ${String(level)}`);
    }
    if (typeof (c as any).targetId !== 'string' || (c as any).targetId.length === 0) {
      throw new AiAnalysisError('curriculum candidate is missing targetId');
    }
    if (!isValidConfidence((c as any).confidence)) {
      throw new AiAnalysisError('curriculum candidate has an invalid confidence');
    }
    out.push({
      level,
      targetId: (c as any).targetId,
      confidence: (c as any).confidence,
      rationale: typeof (c as any).rationale === 'string' ? (c as any).rationale : '',
    });
  }
  return out;
}

function validateMicroSkillCandidates(value: unknown): MicroSkillCandidateProposal[] {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new AiAnalysisError('microSkillCandidates must be an array');
  }
  const out: MicroSkillCandidateProposal[] = [];
  for (const c of value) {
    if (typeof c !== 'object' || c === null) {
      throw new AiAnalysisError('microskill candidate must be an object');
    }
    if (typeof (c as any).microSkillId !== 'string' || (c as any).microSkillId.length === 0) {
      throw new AiAnalysisError('microskill candidate is missing microSkillId');
    }
    if (!isValidConfidence((c as any).confidence)) {
      throw new AiAnalysisError('microskill candidate has an invalid confidence');
    }
    out.push({
      microSkillId: (c as any).microSkillId,
      confidence: (c as any).confidence,
      rationale: typeof (c as any).rationale === 'string' ? (c as any).rationale : '',
    });
  }
  return out;
}

/**
 * Conservative confidence: the model's number, further reduced when there are no
 * candidates or when warnings indicate ambiguity. Never inflated.
 */
export function deriveConfidence(
  modelConfidence: number,
  curriculumCandidates: unknown[],
  microSkillCandidates: unknown[],
  warnings: string[] = []
): number {
  let confidence = isValidConfidence(modelConfidence) ? modelConfidence : CONSERVATIVE_FALLBACK_CONFIDENCE;
  if (curriculumCandidates.length === 0 && microSkillCandidates.length === 0) {
    confidence = Math.min(confidence, 0.3);
  }
  if (warnings.length > 0) {
    confidence = Math.min(confidence, 0.6);
  }
  return Math.max(0, Math.min(0.95, confidence));
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

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}
