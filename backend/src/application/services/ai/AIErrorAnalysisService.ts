import { IAIProvider } from '../../../domain/interfaces/ai/IAIProvider.js';
import { createErrorAnalysisProvider } from '../../../infrastructure/ai/error-analysis/ErrorAnalysisProviderFactory.js';
import { ERROR_ANALYSIS_TYPES } from '../../../infrastructure/ai/error-analysis/RealErrorAnalysisProvider.js';
import { AiAnalysisError } from '../../../domain/errors/QuestionAnalysisErrors.js';
import { logger } from '../../../infrastructure/logging/logger.js';

/**
 * AIErrorAnalysisService — Phase 5F.9-C
 *
 * Prepares the model request, invokes the configured `IAIProvider`, validates the
 * structured result and returns it. It is a CLASSIFIER, not an authority:
 *
 *   - It never creates ErrorPatterns / MicroSkills / curriculum.
 *   - It never chooses a database ErrorPattern id or code.
 *   - It never mutates mastery, progress or provenance.
 *   - It never decides correctness (the caller already knows the attempt failed).
 *
 * Governance and persistence stay in ErrorAnalysisApplicationService, which maps
 * the coarse `errorType` through the existing resolver and MicroSkill
 * compatibility checks.
 *
 * Phase 5F.9-C: when a real provider is exactly what was configured, that provider
 * is used and its failures are SURFACED. There is no silent fall-through to a
 * canned mock result — an application must never appear to use real AI while
 * serving mock output.
 */

/** The coarse error-type vocabulary already supported by the repository. */
export type ErrorType = (typeof ERROR_ANALYSIS_TYPES)[number];

export interface ErrorAnalysisRequest {
  question: string;
  studentAnswer: string;
  correctAnswer: string;
  skillId: string;
  difficulty: number;
  previousAttempts: Array<{
    isCorrect: boolean;
    errorType?: string;
    timeSpentSeconds: number;
  }>;
  timeSpentSeconds: number;
  /** Optional authoritative MicroSkill context (name/description) for the model. */
  skillName?: string;
  skillDescription?: string;
}

export interface ErrorAnalysisResult {
  errorType: ErrorType;
  confidence: number;
  hypothesis: string;
  relatedSkills: string[];
  suggestion: string;
  metadata: {
    model: string;
    version: string;
    timestamp: string;
    tokensUsed: number;
    latencyMs: number;
  };
}

interface StructuredPayload {
  errorType?: unknown;
  confidence?: unknown;
  hypothesis?: unknown;
  relatedSkills?: unknown;
  suggestion?: unknown;
  metadata?: unknown;
}

export class AIErrorAnalysisService {
  private provider: IAIProvider;

  /**
   * When no provider is injected, the CONFIGURED error-analysis provider is
   * resolved. A misconfigured real provider fails loudly here rather than being
   * silently replaced by mock output.
   */
  constructor(provider?: IAIProvider) {
    this.provider = provider ?? createErrorAnalysisProvider();
  }

  async analyzeError(request: ErrorAnalysisRequest): Promise<ErrorAnalysisResult> {
    const startedAt = Date.now();
    const prompt = this.buildPrompt(request);

    let response;
    try {
      response = await this.provider.completeStructured<StructuredPayload>(
        {
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: prompt },
          ],
          temperature: 0.2,
          maxTokens: 600,
          responseFormat: 'json',
        },
        {}
      );
    } catch (error) {
      // SECURITY: never log the question, the student's answer, the prompt, the
      // model response or the API key. Safe metadata only.
      logger.error(
        {
          skillId: request.skillId,
          provider: this.provider.getProviderName(),
          model: this.provider.getModelName(),
          status: 'error',
          errorClass: error instanceof Error ? error.name : 'UnknownError',
        },
        'AI error analysis failed'
      );
      // A real provider failure must NOT become a fabricated classification.
      // Surfacing it lets the caller record AI_FAILED and create no analysis.
      throw new AiAnalysisError('AI error analysis provider failed');
    }

    const validated = this.validate(response.structured);

    logger.info(
      {
        provider: this.provider.getProviderName(),
        model: this.provider.getModelName(),
        processingTimeMs: Date.now() - startedAt,
        inputLength: prompt.length,
        errorType: validated.errorType,
        confidence: validated.confidence,
        tokensUsed: response.tokensUsed,
        latencyMs: response.latencyMs,
        status: 'ok',
      },
      'AI error analysis completed'
    );

    return {
      errorType: validated.errorType,
      confidence: validated.confidence,
      hypothesis: validated.hypothesis,
      relatedSkills: validated.relatedSkills,
      suggestion: validated.suggestion,
      metadata: {
        model: response.model,
        version: response.version,
        timestamp: new Date().toISOString(),
        tokensUsed: response.tokensUsed,
        latencyMs: response.latencyMs,
      },
    };
  }

  // -------------------------------------------------------------- validation
  /**
   * The provider contract guarantees structure, but this service re-establishes
   * every field the backend depends on: a classification is never trusted blindly.
   */
  private validate(payload: StructuredPayload | undefined | null): {
    errorType: ErrorType;
    confidence: number;
    hypothesis: string;
    relatedSkills: string[];
    suggestion: string;
  } {
    if (!payload || typeof payload !== 'object') {
      throw new AiAnalysisError('AI error analysis returned no structured result');
    }

    if (typeof payload.errorType !== 'string' || !isSupportedErrorType(payload.errorType)) {
      throw new AiAnalysisError('AI error analysis returned an unsupported errorType');
    }

    const confidence = payload.confidence;
    if (
      typeof confidence !== 'number' ||
      !Number.isFinite(confidence) ||
      confidence < 0 ||
      confidence > 1
    ) {
      throw new AiAnalysisError('AI error analysis returned an invalid confidence');
    }

    if (typeof payload.hypothesis !== 'string' || payload.hypothesis.trim().length === 0) {
      throw new AiAnalysisError('AI error analysis returned no hypothesis');
    }

    return {
      errorType: payload.errorType,
      confidence,
      hypothesis: payload.hypothesis,
      relatedSkills: Array.isArray(payload.relatedSkills)
        ? payload.relatedSkills.filter(
            (x): x is string => typeof x === 'string' && x.length > 0
          )
        : [],
      suggestion:
        typeof payload.suggestion === 'string' && payload.suggestion.trim().length > 0
          ? payload.suggestion
          : '',
    };
  }

  // ------------------------------------------------------------------ prompt
  private buildPrompt(request: ErrorAnalysisRequest): string {
    const previousAttempts = request.previousAttempts
      .slice(-5)
      .map((a, i) => `Attempt ${i + 1}: ${a.isCorrect ? 'Correct' : 'Incorrect'}${a.errorType ? ` (${a.errorType})` : ''}`)
      .join('\n');

    const skillContext = request.skillName
      ? `Skill being assessed: ${request.skillName}${
          request.skillDescription ? ` — ${request.skillDescription}` : ''
        }`
      : 'Skill being assessed: (not provided)';

    return [
      skillContext,
      '',
      'Question:',
      request.question,
      '',
      "Student's submitted answer:",
      request.studentAnswer,
      '',
      'Expected (canonical) answer:',
      request.correctAnswer,
      '',
      `Difficulty: ${request.difficulty}`,
      `Time spent: ${request.timeSpentSeconds} seconds`,
      'Previous attempts on this question:',
      previousAttempts || 'None',
      '',
      "Analyze WHY the student's answer is incorrect.",
      'Identify the likely TYPE and SOURCE of the mistake from evidence in the answer.',
      'Do NOT solve the question. Do NOT give a full or worked solution.',
      'Do NOT invent steps the student did not attempt.',
      'If the evidence is insufficient, return errorType "OTHER" with a low confidence.',
      'Return only the required JSON.',
    ].join('\n');
  }
}

const SYSTEM_PROMPT = `You are a mathematics diagnostics assistant.
You analyze why a STUDENT'S SUBMITTED ANSWER is incorrect for the given question.

STRICT RULES:
- The answer is already known to be incorrect. Do NOT judge or restate correctness.
- Do NOT solve the question, provide a full solution, or reveal the correct answer.
- Do NOT invent steps the student did not attempt; reason only from the answer given.
- Separate EVIDENCE (what the answer shows) from HYPOTHESIS (what it may indicate).
- If evidence is insufficient, use "OTHER" with a low confidence.
- errorType must be one of: ${ERROR_ANALYSIS_TYPES.join(', ')}.
- NEVER return an ErrorPattern id/code or a MicroSkill database id.
- relatedSkills is optional free-text, never a database identifier.

Return ONLY valid JSON:
{ "errorType": string, "confidence": number, "hypothesis": string, "relatedSkills": string[], "suggestion": string, "metadata": object }
confidence must be a finite number in [0,1] and must be conservative.`;

function isSupportedErrorType(value: string): value is ErrorType {
  return (ERROR_ANALYSIS_TYPES as readonly string[]).includes(value);
}
