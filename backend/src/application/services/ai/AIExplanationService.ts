import { IAIProvider } from '../../../domain/interfaces/ai/IAIProvider.js';
import { createExplanationProvider } from '../../../infrastructure/ai/explanation/ExplanationProviderFactory.js';
import {
  RealExplanationProvider,
  buildPrompt,
  type ExplanationModelRequest,
} from '../../../infrastructure/ai/explanation/RealExplanationProvider.js';
import {
  assessAnswerLeakage,
  buildSafeFallbackHint,
  isAllowedMode,
  type ExplanationMode,
} from '../../../domain/ai/explanationPolicy.js';
import { AiAnalysisError } from '../../../domain/errors/QuestionAnalysisErrors.js';
import { logger } from '../../../infrastructure/logging/logger.js';

/**
 * AIExplanationService — Phase 5F.9-D
 *
 * Generates ANSWER-SUPPRESSING guidance (hint / Socratic / formula reminder /
 * mistake guidance / next step). It is a COACH, not an answer authority:
 *
 *   - `correctAnswer` is deliberately ABSENT from `ExplanationRequest`. The
 *     canonical answer can therefore never enter the provider request: the old
 *     field was removed rather than redacted after the fact. Any caller that
 *     still sends it simply has it ignored by the controller.
 *   - Output is passed through a deterministic answer-leakage policy before it is
 *     returned. A rejected response triggers ONE bounded regeneration; if that is
 *     also unsafe the service returns an answer-free safe fallback.
 *   - It never persists anything and never mutates mastery, progress, ErrorPattern,
 *     MicroSkill or QuestionSkillMapping.
 *   - There is NO full-solution mode.
 */

export interface ExplanationRequest {
  /**
   * Phase 5F.9-E: the authoritative, persisted QuestionAttempt this guidance is
   * about. When present, the CALLER (the HTTP controller) is expected to have
   * already overwritten concept/question/studentAnswer/skillId/difficulty/
   * level/previousAttempts/skillName/skillDescription/errorType/errorHypothesis
   * with values derived from the persisted attempt. The service itself does not
   * resolve the attempt — it only transports the authoritative context — so it
   * stays free of database access (a key non-mutation guarantee).
   */
  attemptId?: string;
  concept: string;
  question?: string;
  studentAnswer?: string;
  skillId: string;
  difficulty: number;
  previousAttempts: number;
  level: 'beginner' | 'intermediate' | 'advanced';
  /** Guidance mode. Defaults to HINT. There is no solution mode. */
  mode?: string;
  /** Authoritative MicroSkill context (resolved by the backend, never invented). */
  skillName?: string;
  skillDescription?: string;
  /** Authoritative ErrorAnalysis signal, when one already exists. */
  errorType?: string;
  errorHypothesis?: string;
  /**
   * Phase 6.4: authoritative correctness of the attempt. A boolean ONLY — never
   * the canonical answer. It is forwarded to the provider so guidance stays
   * consistent with the backend result and never invents a mistake on a correct
   * attempt. Undefined = not communicated (no correctness claim may be made).
   */
  studentAnsweredCorrectly?: boolean;
}

export interface ExplanationResult {
  explanation: string;
  stepByStep: string[];
  examples: string[];
  keyPoints: string[];
  practiceSuggestion: string;
  mode: ExplanationMode;
  metadata: {
    model: string;
    version: string;
    timestamp: string;
    tokensUsed: number;
    latencyMs: number;
    /** Truthful provenance — never claims real AI produced a fallback. */
    source: 'provider' | 'fallback';
    /** Safety outcome, for observability. */
    safety: 'clear' | 'regenerated' | 'fallback';
  };
}

/** A single bounded regeneration is allowed; there is no unbounded loop. */
export const MAX_SAFE_REGENERATIONS = 1;

export class AIExplanationService {
  private readonly provider: IAIProvider;
  private readonly directProvider: RealExplanationProvider | null;

  constructor(provider?: IAIProvider) {
    this.provider = provider ?? createExplanationProvider();
    this.directProvider =
      this.provider instanceof RealExplanationProvider ? this.provider : null;
  }

  async generateExplanation(request: ExplanationRequest): Promise<ExplanationResult> {
    const startedAt = Date.now();
    const mode: ExplanationMode = isAllowedMode(request.mode) ? request.mode : 'HINT';
    const modelInput = toModelRequest(request, mode);

    // ---- attempt 1: the configured provider
    let candidate: ExplanationContent;
    let provenance: { model: string; version: string; tokensUsed: number; latencyMs: number };
    try {
      const generated = await this.generate(modelInput, mode);
      candidate = generated.content;
      provenance = generated.provenance;
    } catch (error) {
      // Never fabricate a classification or expose provider internals. Return an
      // answer-free fallback and report the failure truthfully in metadata.
      logger.error(
        {
          skillId: request.skillId,
          mode,
          provider: this.provider.getProviderName(),
          model: this.provider.getModelName(),
          status: 'error',
          errorClass: error instanceof Error ? error.name : 'UnknownError',
        },
        'AI explanation generation failed'
      );
      return this.fallbackResult(mode, startedAt, 'fallback', request.skillId, 'provider_error');
    }

    const firstVerdict = assessAnswerLeakage(candidate);
    if (firstVerdict.safe) {
      this.logOutcome(request.skillId, mode, 'clear', startedAt, candidate);
      return this.toResult(candidate, mode, provenance, 'provider', 'clear');
    }

    // ---- attempt 2: ONE bounded regeneration, explicitly told what was wrong
    logger.warn(
      {
        skillId: request.skillId,
        mode,
        status: 'policy_rejected',
        rejectionReason: firstVerdict.reasons.join(','),
        attempt: 1,
      },
      'AI explanation rejected by answer-suppression policy; regenerating once'
    );

    for (let attempt = 0; attempt < MAX_SAFE_REGENERATIONS; attempt++) {
      let regenerated: ExplanationContent;
      try {
        const generated = await this.generate(
          { ...modelInput, policyFeedback: describeRejection(firstVerdict.reasons) },
          mode
        );
        regenerated = generated.content;
      } catch (error) {
        logger.error(
          {
            skillId: request.skillId,
            mode,
            status: 'error',
            errorClass: error instanceof Error ? error.name : 'UnknownError',
          },
          'AI explanation regeneration failed'
        );
        return this.fallbackResult(mode, startedAt, 'fallback', request.skillId, 'regeneration_error');
      }

      const verdict = assessAnswerLeakage(regenerated);
      if (verdict.safe) {
        this.logOutcome(request.skillId, mode, 'regenerated', startedAt, regenerated);
        return this.toResult(regenerated, mode, provenance, 'provider', 'regenerated');
      }

      logger.warn(
        {
          skillId: request.skillId,
          mode,
          status: 'policy_rejected',
          rejectionReason: verdict.reasons.join(','),
          attempt: attempt + 2,
        },
        'AI explanation regeneration still unsafe; using safe fallback'
      );
    }

    // ---- exhausted: never return unsafe text to the student
    return this.fallbackResult(mode, startedAt, 'fallback', request.skillId, 'policy_rejected');
  }

  // --------------------------------------------------------------- internals
  private async generate(
    input: ExplanationModelRequest,
    mode: ExplanationMode
  ): Promise<{
    content: ExplanationContent;
    provenance: { model: string; version: string; tokensUsed: number; latencyMs: number };
  }> {
    if (this.directProvider) {
      const { payload, tokensUsed, latencyMs } = await this.directProvider.generateGuidance(
        input,
        { priorFeedback: input.policyFeedback }
      );
      return {
        content: {
          explanation: payload.explanation,
          stepByStep: payload.stepByStep,
          examples: payload.examples,
          keyPoints: payload.keyPoints,
          practiceSuggestion: payload.practiceSuggestion,
        },
        provenance: {
          model: this.directProvider.getModelName(),
          version: this.directProvider.getVersion(),
          tokensUsed,
          latencyMs,
        },
      };
    }

    // Generic IAIProvider path (e.g. MockAIProvider in tests/default config).
    const prompt = buildPrompt(input, input.policyFeedback);
    const response = await this.provider.completeStructured<Partial<ExplanationContent>>(
      {
        messages: [
          { role: 'system', content: EXPLANATION_SYSTEM_PROMPT },
          { role: 'user', content: prompt },
        ],
        temperature: 0.4,
        maxTokens: 600,
        responseFormat: 'json',
      },
      {}
    );

    const structured = response.structured;
    if (!structured || typeof structured.explanation !== 'string' || structured.explanation.trim().length === 0) {
      throw new AiAnalysisError('Explanation provider returned no usable explanation');
    }

    return {
      content: {
        explanation: structured.explanation,
        stepByStep: toStringArray(structured.stepByStep),
        examples: toStringArray(structured.examples),
        keyPoints: toStringArray(structured.keyPoints),
        practiceSuggestion:
          typeof structured.practiceSuggestion === 'string' ? structured.practiceSuggestion : '',
      },
      provenance: {
        model: response.model,
        version: response.version,
        tokensUsed: response.tokensUsed,
        latencyMs: response.latencyMs,
      },
    };
  }

  private toResult(
    content: ExplanationContent,
    mode: ExplanationMode,
    provenance: { model: string; version: string; tokensUsed: number; latencyMs: number },
    source: 'provider' | 'fallback',
    safety: 'clear' | 'regenerated' | 'fallback'
  ): ExplanationResult {
    return {
      explanation: content.explanation,
      stepByStep: content.stepByStep ?? [],
      examples: content.examples ?? [],
      keyPoints: content.keyPoints ?? [],
      practiceSuggestion: content.practiceSuggestion ?? '',
      mode,
      metadata: {
        model: provenance.model,
        version: provenance.version,
        timestamp: new Date().toISOString(),
        tokensUsed: provenance.tokensUsed,
        latencyMs: provenance.latencyMs,
        source,
        safety,
      },
    };
  }

  /**
   * A safe, answer-free fallback. It is generated by the deterministic policy, NOT
   * by the model, and metadata reports `source: 'fallback'` so the fallback is
   * never presented as real AI output.
   */
  private fallbackResult(
    mode: ExplanationMode,
    startedAt: number,
    safety: 'fallback',
    skillId: string,
    reason: string
  ): ExplanationResult {
    const content = buildSafeFallbackHint(mode);
    logger.info(
      {
        skillId,
        mode,
        status: 'fallback',
        rejectionReason: reason,
        processingTimeMs: Date.now() - startedAt,
        outputLength: content.explanation.length,
      },
      'AI explanation served a safe answer-free fallback'
    );
    return {
      explanation: content.explanation,
      stepByStep: content.stepByStep ?? [],
      examples: content.examples ?? [],
      keyPoints: content.keyPoints ?? [],
      practiceSuggestion: content.practiceSuggestion ?? '',
      mode,
      metadata: {
        model: 'safe-fallback',
        version: 'policy-1',
        timestamp: new Date().toISOString(),
        tokensUsed: 0,
        latencyMs: Date.now() - startedAt,
        source: 'fallback',
        safety,
      },
    };
  }

  private logOutcome(
    skillId: string,
    mode: ExplanationMode,
    safety: 'clear' | 'regenerated',
    startedAt: number,
    content: ExplanationContent
  ): void {
    logger.info(
      {
        skillId,
        mode,
        provider: this.provider.getProviderName(),
        model: this.provider.getModelName(),
        processingTimeMs: Date.now() - startedAt,
        outputLength: content.explanation.length,
        status: 'ok',
        safety,
      },
      'AI explanation generated'
    );
  }
}

// -------------------------------------------------------------------- helpers
const EXPLANATION_SYSTEM_PROMPT = `You are a Socratic mathematics coach. Help the student find the next step themselves.
NEVER state the final answer, the correct option, or the final numeric result.
NEVER provide a complete or worked solution, and never reveal the answer by elimination.
You may name the likely misconception, point to where to look, remind a rule, ask one Socratic question, or suggest one small next step.
Write in Turkish. Return ONLY valid JSON:
{ "explanation": string, "stepByStep": string[], "examples": string[], "keyPoints": string[], "practiceSuggestion": string }
"stepByStep" must contain at most 2 short guidance steps, never solution steps.`;

interface ExplanationContent {
  explanation: string;
  stepByStep?: string[];
  examples?: string[];
  keyPoints?: string[];
  practiceSuggestion?: string;
}

/**
 * Project the public request onto the model input. The canonical answer is simply
 * not part of the model contract, so it can never be forwarded.
 */
function toModelRequest(request: ExplanationRequest, mode: ExplanationMode): ExplanationModelRequest {
  return {
    mode,
    concept: request.concept,
    question: request.question,
    studentAnswer: request.studentAnswer,
    skillName: request.skillName,
    skillDescription: request.skillDescription,
    errorType: request.errorType,
    errorHypothesis: request.errorHypothesis,
    studentAnsweredCorrectly: request.studentAnsweredCorrectly,
  };
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((x): x is string => typeof x === 'string' && x.trim().length > 0);
}

/** Human-readable, content-free description of why output was rejected. */
function describeRejection(reasons: string[]): string {
  const map: Record<string, string> = {
    ANSWER_IS_PHRASE: 'you announced the answer explicitly',
    FINAL_ANSWER_DECLARATION: 'you revealed the final answer',
    MULTIPLE_CHOICE_LETTER: 'you revealed the correct option',
    WINNER_HINT_RESPONSE: 'you narrowed the answer down',
    NOT_X_BUT_Y: 'you revealed the answer by elimination',
    RESULT_EQUALS: 'you stated the final numeric result',
    COMPLETED_COMPUTATION: 'you completed the computation',
    FULL_SOLUTION: 'you provided a full worked solution',
  };
  return reasons.map((r) => map[r] ?? r).join('; ');
}
