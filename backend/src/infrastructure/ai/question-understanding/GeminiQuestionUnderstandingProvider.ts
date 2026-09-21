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
import type { IStorageProvider } from '../../../domain/interfaces/storage/IStorageProvider.js';
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
 * Image input (Phase 7.5): `QuestionUnderstandingRequest` may now carry an
 * optional `image` content part (mimeType + bytes, resolved by the caller from the
 * storage abstraction). TEXT_PASTE requests still send a plain text input; an
 * IMAGE_UPLOAD request sends the real image content part to the Interactions API,
 * optionally accompanied by the student's own normalized text. The opaque asset
 * reference is NEVER sent as content — only the bytes are.
 *
 * The response schema, validation and proposal mapping are shared by both input
 * shapes, so the existing text contract is unchanged.
 */

/** Confidence used when the model gives no usable number (below the 0.5 gate). */
const CONSERVATIVE_FALLBACK_CONFIDENCE = 0.3;

const MAX_CANDIDATES = 8;

/** Base64-encode image bytes for the API. The result is never logged. */
function toBase64(data: Buffer): string {
  return Buffer.isBuffer(data) ? data.toString('base64') : Buffer.from(data ?? []).toString('base64');
}

const IMAGE_INSTRUCTION = `An image of a mathematics question is attached.
Read the question directly from the image: equations, expressions, tables, graphs, geometric figures and any accompanying text.
Interpret the mathematical notation as accurately as you can (fractions, exponents, radicals, inequalities, matrices, subscripts/superscripts).
If a symbol is genuinely ambiguous in the image, do NOT silently pick an interpretation: lower your confidence and add a warning.
Do NOT solve the question and do NOT produce an answer — produce only the structured question-understanding analysis defined by the response contract.
All rules above still apply: never invent curriculum or MicroSkill identifiers, and if no CURRICULUM CONTEXT is provided, return NO curriculum or MicroSkill candidates.

FIELD DISCIPLINE (required):
- "extractedText" MUST contain your faithful transcription of the question as it appears in the image, nothing else. Include every part, preserve the notation, and do NOT add reasoning, commentary, answers or field labels.
- "questionUnderstanding.requestedOperation" MUST be a short operation label only (e.g. "solve", "evaluate", "find the roots", "compute the derivative"). Never put the question text, the equation or an answer in this field.`;

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
  "extractedText": string,
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
    // The model's faithful transcription of the question — for an image input this
    // is the reading of the image, and it becomes the ingestion's text.
    extractedText: { type: 'string' },
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
    'extractedText',
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
  private readonly version = '2.1.0';

  constructor(config: QuestionUnderstandingConfig, _storage?: IStorageProvider) {
    // The storage provider is intentionally NOT used inside the provider: bytes
    // are resolved by QuestionAnalysisService and handed over as `request.image`.
    // The parameter exists so the factory can wire a uniform options object and so
    // the multimodal capability is declared where provider selection happens.
    void _storage;
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
        // A truncated response is the common cause: report that explicitly rather
        // than a bare parse error, since it points at the output-token budget.
        const truncated = !text.trimEnd().endsWith('}');
        throw new AiAnalysisError(
          `Failed to parse Gemini response as JSON: ${parseError instanceof Error ? parseError.message : String(parseError)}` +
          (truncated ? ' (response appears truncated — check the output token budget)' : '')
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
      const textLength = (request.normalizedText ?? '').length;

      logger.info({
        ingestionId: request.ingestionId,
        textLength,
        // Content-free evidence that the image content part was actually sent.
        hasImage: Boolean(request.image),
        imageMimeType: request.image?.mimeType,
        imageBytes: request.image?.data?.byteLength,
        confidence,
        warningsCount: warnings.length,
        processingTimeMs,
        provider: 'gemini',
        model: this.config.model,
        inputMode: request.image ? 'multimodal' : 'text',
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
      input: this.buildInput(request),
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
   * Builds the Interactions `input`.
   *
   * TEXT request  → the prompt string alone (unchanged behaviour).
   * IMAGE request → the SAME prompt string (curriculum context + instruction)
   *                 followed by the real image content part, so the model receives
   *                 the image bytes rather than a reference to them.
   */
  private buildInput(request: QuestionUnderstandingRequest): Interactions.InteractionCreateParams['input'] {
    const prompt = this.buildPrompt(request);

    if (!request.image) {
      return prompt;
    }

    return [
      { type: 'text', text: `${prompt}\n\n${IMAGE_INSTRUCTION}` },
      {
        type: 'image',
        // The raw bytes of the uploaded image reach the API here. The opaque
        // assetRef is intentionally NOT part of the payload.
        data: toBase64(request.image.data),
        mime_type: request.image.mimeType,
      },
    ] as unknown as Interactions.InteractionCreateParams['input'];
  }

  /**
   * Builds the text prompt shared by both input shapes.
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

    if (request.image) {
      // `extractedText` is required for an image so the transcription can be used
      // as the ingestion's text by the caller.
      prompt += 'Also transcribe the question you read from the image into the "extractedText" field, preserving the mathematical notation.\n';
      // The question itself lives in the attached image; any student-supplied
      // text is additional context, never a substitute for the image.
      prompt += '[the question is provided in the attached image]';
      const extra = (request.normalizedText ?? '').trim();
      if (extra.length > 0) {
        prompt += `\nSTUDENT-PROVIDED TEXT (additional context):\n${extra}`;
      }
      return prompt;
    }

    prompt += request.normalizedText ?? '';

    return prompt;
  }

  private buildProposal(
    request: QuestionUnderstandingRequest,
    jsonResponse: any
  ): QuestionUnderstandingProposal { // eslint-disable-line @typescript-eslint/no-unused-vars
    const proposalText = (request.normalizedText ?? '').trim();
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

    const extractedText =
      typeof jsonResponse.extractedText === 'string' && jsonResponse.extractedText.trim().length > 0
        ? jsonResponse.extractedText.trim()
        : undefined;

    return {
      ingestionId: request.ingestionId,
      ...(extractedText ? { extractedText } : {}),
      normalizedText: proposalText || extractedText || '',
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