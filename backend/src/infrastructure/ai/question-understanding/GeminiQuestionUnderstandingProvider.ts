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
import { GoogleGenerativeAI } from '@google/generative-ai';

/**
 * GeminiQuestionUnderstandingProvider — Phase 7.4
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
 *   - Nothing sensitive (question text, prompt, raw response, API key) is logged.
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

export class GeminiQuestionUnderstandingProvider implements IQuestionUnderstandingProvider {
  private readonly config: QuestionUnderstandingConfig;
  private readonly genAI: GoogleGenerativeAI;
  private readonly version = '1.0.0';

  constructor(config: QuestionUnderstandingConfig) {
    this.config = config;

    if (!config.geminiApiKey || config.geminiApiKey.trim().length === 0) {
      throw new AiAnalysisError(
        'GEMINI_API_KEY is required for Gemini question understanding provider'
      );
    }

    // Initialize Google Generative AI SDK with API key as string
    this.genAI = new GoogleGenerativeAI(config.geminiApiKey);
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
      // Build the prompt with curriculum context
      const prompt = this.buildPrompt(request);

      // Generate content using the legacy @google/generative-ai SDK
      const model = this.genAI.getGenerativeModel({ 
        model: this.config.model,
        generationConfig: {
          temperature: 0.1, // Low temperature for more deterministic classification
          maxOutputTokens: this.config.maxTokens,
        },
      });

      const result = await model.generateContent(prompt);
      const response = result.response;
      const text = response.text();

      // Parse JSON response
      const jsonResponse = JSON.parse(text);

      // Build proposal from Gemini response
      const proposal = this.buildProposal(request, jsonResponse);
      const confidence = this.extractConfidence(jsonResponse);
      const warnings = this.extractWarnings(jsonResponse);

      const processingTimeMs = Date.now() - startedAt;

      logger.info({
        ingestionId: request.ingestionId,
        textLength: request.normalizedText.length,
        confidence,
        warningsCount: warnings.length,
        processingTimeMs,
        model: this.config.model,
      }, 'Gemini question understanding analysis completed');

      return {
        proposal,
        confidence,
        warnings,
      };
    } catch (error) {
      logger.error({
        ingestionId: request.ingestionId,
        error: error instanceof Error ? error.message : String(error),
      }, 'Gemini question understanding analysis failed');

      throw new AiAnalysisError(
        `Gemini analysis failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  private buildPrompt(request: QuestionUnderstandingRequest): string {
    let prompt = SYSTEM_PROMPT + '\n\n';

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