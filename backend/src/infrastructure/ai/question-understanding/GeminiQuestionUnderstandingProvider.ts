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
import { logger } from '../../logging/logger.js';
import type { QuestionUnderstandingConfig } from './config/QuestionUnderstandingConfig.js';
import { GoogleGenAI, type Interactions } from '@google/genai';

/**
 * GeminiQuestionUnderstandingProvider — Phase 7.4 (Interactions API migration)
 *
 * A real, Gemini-backed implementation of the IQuestionUnderstandingProvider
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
 *   - It NEVER falls back to the mock provider. Any Gemini/API failure surfaces
 *     as an explicit AiAnalysisError.
 *   - Nothing sensitive (question text, prompt, raw response, API key, auth
 *     headers) is logged.
 *
 * API approach:
 *   Uses the current official `@google/genai` SDK and the Interactions API
 *   (`ai.interactions.create`) as recommended by Google for new projects and the
 *   latest models. The legacy `@google/generative-ai` SDK + `generateContent`
 *   call is no longer used here.
 *
 * Image input: `QuestionUnderstandingRequest` only carries `normalizedText`
 * today. `analyze` therefore builds a text input, but the request construction is
 * kept behind `buildPrompt` so a future multimodal content part can be added
 * without changing the provider contract or this response-mapping logic.
 */

/** Confidence used when the model gives no usable number (below the 0.5 gate). */
const CONSERVATIVE_FALLBACK_CONFIDENCE = 0.3;

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

/**
 * JSON schema handed to the Interactions API through `response_format`.
 * It mirrors the shape already documented in SYSTEM_PROMPT so the model output
 * stays compatible with the existing validation/mapping logic below.
 */
const RESPONSE_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    questionUnderstanding: {
      type: 'object',
      properties: {
        questionType: { type: 'string' },
        mathematicalObjects: { type: 'array', items: { type: 'string' } },
        requestedOperation: { type: 'string' },
        constraints: { type: 'array', items: { type: 'string' } },
      },
      required: ['questionType', 'mathematicalObjects'],
    },
    curriculumCandidates: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          level: { type: 'string', enum: ['LEARNING_OUTCOME', 'PROCESS_COMPONENT'] },
          targetId: { type: 'string' },
          confidence: { type: 'number' },
          rationale: { type: 'string' },
        },
        required: ['level', 'targetId', 'confidence'],
      },
    },
    microSkillCandidates: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          microSkillId: { type: 'string' },
          confidence: { type: 'number' },
          rationale: { type: 'string' },
        },
        required: ['microSkillId', 'confidence'],
      },
    },
    confidence: { type: 'number' },
    warnings: { type: 'array', items: { type: 'string' } },
  },
  required: [
    'questionUnderstanding',
    'curriculumCandidates',
    'microSkillCandidates',
    'confidence',
    'warnings',
  ],
};

export class GeminiQuestionUnderstandingProvider implements IQuestionUnderstandingProvider {
  private readonly config: QuestionUnderstandingConfig;
  private readonly client: GoogleGenAI;
  private readonly version = '2.0.0';

  constructor(config: QuestionUnderstandingConfig) {
    this.config = config;

    if (!config.geminiApiKey || config.geminiApiKey.trim().length === 0) {
      throw new AiAnalysisError(
        'GEMINI_API_KEY is required for Gemini question understanding provider'
      );
    }

    // Current official SDK. The API key is passed straight to the client and is
    // never read back, logged or embedded in an error message.
    this.client = new GoogleGenAI({ apiKey: config.geminiApiKey });
  }

  getProviderName(): string {
    return 'gemini';
  }

  getModelName(): string {
    return this.config.model;
  }

  getVersion(): string {
    return this.version;
  }

  async isAvailable(): Promise<boolean> {
    return this.config.geminiApiKey.trim().length > 0;
  }

  async analyze(request: QuestionUnderstandingRequest): Promise<QuestionUnderstandingResponse> {
    const startedAt = Date.now();

    try {
      const interaction = await this.callGemini(request);
      const text = this.extractText(interaction);

      // Validate that we got a non-empty response
      if (!text || text.trim().length === 0) {
        throw new AiAnalysisError('Gemini returned empty response');
      }

      // Parse JSON response with validation
      let jsonResponse: any;
      try {
        jsonResponse = JSON.parse(text);
      } catch (parseError) {
        throw new AiAnalysisError(
          `Failed to parse Gemini response as JSON: ${parseError instanceof Error ? parseError.message : String(parseError)}`
        );
      }

      // Validate structured response schema
      this.validateGeminiResponse(jsonResponse);

      // Build proposal from Gemini response
      const proposal = this.buildProposal(request, jsonResponse);
      const confidence = this.extractConfidence(jsonResponse);
      const warnings = this.extractWarnings(jsonResponse);

      // Validate confidence range
      if (typeof confidence !== 'number' || confidence < 0 || confidence > 1) {
        throw new AiAnalysisError('Gemini returned invalid confidence value (must be 0-1)');
      }

      const processingTimeMs = Date.now() - startedAt;

      logger.info({
        ingestionId: request.ingestionId,
        textLength: request.normalizedText.length,
        confidence,
        warningsCount: warnings.length,
        processingTimeMs,
        provider: 'gemini',
        model: this.config.model,
      }, 'Gemini question understanding analysis completed');

      return {
        proposal,
        confidence,
        warnings,
      };
    } catch (error) {
      // Log only non-sensitive context: never the question, the prompt, the raw
      // response, the API key or any auth header.
      logger.error({
        ingestionId: request.ingestionId,
        provider: 'gemini',
        model: this.config.model,
        errorName: error instanceof Error ? error.name : typeof error,
        error: error instanceof Error ? error.message : String(error),
      }, 'Gemini question understanding analysis failed');

      // Never fall back to mock - propagate the error
      throw new AiAnalysisError(
        `Gemini analysis failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Single Interactions API call through the official SDK.
   *
   * The SDK owns transport, auth and (non-streaming) request handling, so the
   * model call happens in exactly one place. Failures propagate to `analyze`,
   * which converts them into an explicit AiAnalysisError (never a mock result).
   */
  private async callGemini(request: QuestionUnderstandingRequest): Promise<Interactions.Interaction> {
    return this.client.interactions.create({
      model: this.config.model,
      input: this.buildPrompt(request),
      system_instruction: SYSTEM_PROMPT,
      generation_config: {
        // NOTE: the Interactions API GenerationConfig has no `temperature`; the
        // schema below + a system prompt that forbids invention keep the output
        // deterministic and classify-only.
        max_output_tokens: this.config.maxTokens,
      },
      // Structured JSON output enforced by the API rather than prompt-only.
      response_format: {
        type: 'text',
        mime_type: 'application/json',
        schema: RESPONSE_SCHEMA,
      },
      // Stateless single turn: nothing is retained server-side.
      store: false,
    });
  }

  /**
   * Extracts the model text from an Interactions response.
   *
   * Prefers the SDK-provided `output_text` convenience field and falls back to
   * the typed `steps` array, which is where the `model_output` content lives.
   */
  private extractText(interaction: Interactions.Interaction | undefined | null): string {
    if (!interaction) {
      throw new AiAnalysisError('Gemini returned no interaction payload');
    }

    if (typeof interaction.output_text === 'string' && interaction.output_text.trim().length > 0) {
      return interaction.output_text;
    }

    const steps = Array.isArray(interaction.steps) ? interaction.steps : [];
    for (const step of steps) {
      if (!step || (step as { type?: string }).type !== 'model_output') continue;
      const content = (step as { content?: unknown }).content;
      if (typeof content === 'string') {
        return content;
      }
      if (Array.isArray(content)) {
        const text = content
          .map((part) =>
            part && typeof part === 'object' && typeof (part as { text?: string }).text === 'string'
              ? (part as { text: string }).text
              : ''
          )
          .join('');
        if (text.trim().length > 0) {
          return text;
        }
      }
    }

    return '';
  }

  private validateGeminiResponse(jsonResponse: any): void {
    if (typeof jsonResponse !== 'object' || jsonResponse === null) {
      throw new AiAnalysisError('Gemini response is not a valid object');
    }

    // Validate required top-level fields
    if (!jsonResponse.questionUnderstanding || typeof jsonResponse.questionUnderstanding !== 'object') {
      throw new AiAnalysisError('Gemini response missing questionUnderstanding field');
    }

    if (typeof jsonResponse.confidence !== 'number') {
      throw new AiAnalysisError('Gemini response missing or invalid confidence field');
    }

    // An out-of-range or non-finite confidence is a model contract violation,
    // not something to silently clamp: fail explicitly (never a fake result).
    if (
      !Number.isFinite(jsonResponse.confidence) ||
      jsonResponse.confidence < 0 ||
      jsonResponse.confidence > 1
    ) {
      throw new AiAnalysisError('Gemini returned invalid confidence value (must be 0-1)');
    }

    if (!Array.isArray(jsonResponse.warnings)) {
      throw new AiAnalysisError('Gemini response missing or invalid warnings field');
    }

    if (!Array.isArray(jsonResponse.curriculumCandidates)) {
      throw new AiAnalysisError('Gemini response missing or invalid curriculumCandidates field');
    }

    if (!Array.isArray(jsonResponse.microSkillCandidates)) {
      throw new AiAnalysisError('Gemini response missing or invalid microSkillCandidates field');
    }

    // Validate questionUnderstanding structure
    const qu = jsonResponse.questionUnderstanding;
    if (typeof qu.questionType !== 'string' || qu.questionType.trim().length === 0) {
      throw new AiAnalysisError('Gemini response missing or invalid questionType');
    }

    if (!Array.isArray(qu.mathematicalObjects)) {
      throw new AiAnalysisError('Gemini response missing or invalid mathematicalObjects');
    }
  }

  /**
   * Builds the Interactions `input` for a normalized question.
   *
   * Text-only today (the contract carries `normalizedText` only). Kept as a
   * dedicated method so an image/OCR content part can be appended later without
   * touching the provider contract or the response-mapping logic below.
   */
  private buildPrompt(request: QuestionUnderstandingRequest): string {
    let prompt = '';

    // Add curriculum context if available
    if (request.curriculumContext) {
      prompt += 'CURRICULUM CONTEXT:\n';
      prompt += `Learning Outcomes (${request.curriculumContext.learningOutcomes.length}):\n`;
      request.curriculumContext.learningOutcomes.forEach(lo => {
        prompt += `  - ${lo.code}: ${lo.text}\n`;
      });

      prompt += `Process Components (${request.curriculumContext.processComponents.length}):\n`;
      request.curriculumContext.processComponents.forEach(pc => {
        prompt += `  - ${pc.code}: ${pc.text}\n`;
      });

      prompt += `MicroSkills (${request.curriculumContext.microSkills.length}):\n`;
      request.curriculumContext.microSkills.forEach(ms => {
        prompt += `  - ${ms.code}: ${ms.name} - ${ms.description}\n`;
      });
      prompt += '\n';
    }

    prompt += 'QUESTION TO ANALYZE:\n';
    prompt += request.normalizedText;

    return prompt;
  }

  private buildProposal(
    request: QuestionUnderstandingRequest,
    jsonResponse: any
  ): QuestionUnderstandingProposal {
    const questionUnderstanding = jsonResponse.questionUnderstanding || {
      questionType: 'UNKNOWN',
      mathematicalObjects: [],
      requestedOperation: 'UNKNOWN',
      constraints: [],
    };

    const curriculumCandidates: CurriculumCandidateProposal[] = (jsonResponse.curriculumCandidates || [])
      .slice(0, MAX_CANDIDATES)
      .map((c: any) => ({
        level: c.level,
        targetId: c.targetId,
        confidence: this.clampConfidence(c.confidence),
        rationale: c.rationale || 'No rationale provided',
      }));

    const microSkillCandidates: MicroSkillCandidateProposal[] = (jsonResponse.microSkillCandidates || [])
      .slice(0, MAX_CANDIDATES)
      .map((c: any) => ({
        microSkillId: c.microSkillId,
        confidence: this.clampConfidence(c.confidence),
        rationale: c.rationale || 'No rationale provided',
      }));

    return {
      ingestionId: request.ingestionId,
      normalizedText: request.normalizedText,
      questionUnderstanding,
      curriculumCandidates,
      microSkillCandidates,
      confidence: this.extractConfidence(jsonResponse),
      warnings: this.extractWarnings(jsonResponse),
      modelMetadata: {
        provider: 'gemini',
        model: this.config.model,
        version: this.version,
        timestamp: new Date().toISOString(),
      },
    };
  }

  private extractConfidence(jsonResponse: any): number {
    if (typeof jsonResponse.confidence === 'number' && 
        jsonResponse.confidence >= 0 && 
        jsonResponse.confidence <= 1) {
      return jsonResponse.confidence;
    }
    return CONSERVATIVE_FALLBACK_CONFIDENCE;
  }

  private extractWarnings(jsonResponse: any): string[] {
    if (Array.isArray(jsonResponse.warnings)) {
      return jsonResponse.warnings.filter((w: any) => typeof w === 'string');
    }
    return [];
  }

  private clampConfidence(value: number): number {
    if (typeof value !== 'number' || isNaN(value)) {
      return 0.5;
    }
    return Math.max(0, Math.min(1, value));
  }
}