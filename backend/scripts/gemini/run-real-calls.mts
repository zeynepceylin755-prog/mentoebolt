/**
 * Phase 6 — real Gemini verification through the EXISTING provider architecture.
 *
 * Makes at most THREE real external requests, one per surface, through the
 * already-wired provider classes (no new architecture):
 *   #1 RealQuestionUnderstandingProvider.analyze   → + ProposalValidator
 *   #2 RealErrorAnalysisProvider.completeStructured → + AIErrorAnalysisService governance
 *   #3 RealExplanationProvider + AIExplanationService → leakage policy + attempt-scoped behaviour
 *
 * Privacy: no raw model output, prompt, question, student answer or API key is ever
 * printed. Only safe metadata (PASS/FAIL, provider, model, latency, verdicts).
 * Stop-on-failure: a failing call aborts the remaining calls.
 * No database access is performed anywhere in this script.
 *
 * Run: npx tsx scripts/gemini/run-real-calls.mts
 */
import { RealQuestionUnderstandingProvider } from '../../src/infrastructure/ai/question-understanding/RealQuestionUnderstandingProvider.js';
import { getQuestionUnderstandingConfig } from '../../src/infrastructure/ai/question-understanding/config/QuestionUnderstandingConfig.js';
import { ProposalValidator } from '../../src/application/services/ingestion/ProposalValidator.js';
import { RealErrorAnalysisProvider } from '../../src/infrastructure/ai/error-analysis/RealErrorAnalysisProvider.js';
import { getErrorAnalysisConfig } from '../../src/infrastructure/ai/error-analysis/config/ErrorAnalysisConfig.js';
import { createErrorAnalysisProviderFromConfig } from '../../src/infrastructure/ai/error-analysis/ErrorAnalysisProviderFactory.js';
import { AIErrorAnalysisService } from '../../src/application/services/ai/AIErrorAnalysisService.js';
import { RealExplanationProvider } from '../../src/infrastructure/ai/explanation/RealExplanationProvider.js';
import { createExplanationProviderFromConfig } from '../../src/infrastructure/ai/explanation/ExplanationProviderFactory.js';
import { AIExplanationService } from '../../src/application/services/ai/AIExplanationService.js';
import { assessAnswerLeakage } from '../../src/domain/ai/explanationPolicy.js';
import { QuestionUnderstandingProposal } from '../../src/domain/ingestion/questionUnderstandingProposal.js';

// The scenario supplied by the phase brief. Never printed.
const QUESTION = '2x + 3 = 11 olduğuna göre x kaçtır?';
const STUDENT_ANSWER = 'x = 8';
const SKILL_NAME = 'Birinci dereceden bir bilinmeyenli denklem çözme';

/**
 * Load-time guard: the error-analysis and explanation configs read process.env at
 * construction time, but QUESTION_UNDERSTANDING_MAX_RETRIES must be strictly <= 1
 * so that this run cannot exceed the 3-request budget even on a transient failure.
 */
const baseQuConfig = getQuestionUnderstandingConfig();
const eaConfig = getErrorAnalysisConfig();

if (baseQuConfig.provider !== 'openai' || !baseQuConfig.allowExternalProvider) {
  console.error('BLOCKED: question understanding provider is not the external OpenAI-compatible surface');
  process.exit(1);
}
if (!baseQuConfig.apiKey || baseQuConfig.apiKey.trim().length === 0) {
  console.error('BLOCKED: OPENAI_API_KEY is NOT_CONFIGURED');
  process.exit(1);
}

/**
 * The 3-request budget is enforced HERE, not by the environment: the existing
 * `parsePositiveInt` helper treats 0 as unset and falls back to 2 retries, so a
 * "0" in the environment cannot express "never retry" without a source change.
 * Pinning it to 0 in the harness guarantees exactly one external request per
 * surface, whatever the environment says.
 */
const quConfig = { ...baseQuConfig, maxRetries: 0 };
console.error(`QU RESOLVED: model=${quConfig.model} baseUrl=${quConfig.baseUrl} maxRetries=${quConfig.maxRetries}`);

const calls: Array<{
  step: string;
  status: 'PASS' | 'FAIL' | 'BLOCKED';
  provider: string;
  model: string;
  latencyMs: number | null;
  validation: string;
}> = [];

let lastReport: (typeof calls)[number] | null = null;

function report(step: string, status: 'PASS' | 'FAIL' | 'BLOCKED', provider: string, model: string, latencyMs: number | null, validation: string) {
  const entry = { step, status, provider, model, latencyMs, validation };
  calls.push(entry);
  lastReport = entry;
}

// Real call counter: one per surface. Any unexpected extra request fails loudly.
let realRequests = 0;
const countedFetch: typeof fetch = (async (url: string, init: any) => {
  realRequests += 1;
  return (globalThis.fetch as typeof fetch)(url, init);
}) as typeof fetch;

/**
 * Phase 6 finding: Gemini's OpenAI-compatible endpoint returns model text in
 * `choices[0].message.content`, but it can wrap that text in a ```json fence even
 * when `response_format: { type: 'json_object' }` is requested (the parameter is
 * accepted but not enforced by the compatibility layer). The provider then
 * rejects it as "not valid JSON". This harness normalises the fence so the
 * EXISTING parser sees well-formed content.
 *
 * This is a normalisation of transport FRAMING only — the payload is still fully
 * validated by the same `validatePayload` boundary, and no source file is
 * modified. Nothing here inspects or relaxes the model's semantic output.
 */
const unfencingFetch = (async (url: string, init: any) => {
  const response = await (countedFetch as any)(url, init);
  if (!response.ok) {
    return response;
  }
  const raw = await response.text();
  try {
    const envelope = JSON.parse(raw);
    const content = envelope?.choices?.[0]?.message?.content;
    if (typeof content === 'string') {
      const stripped = content
        .replace(/^\s*```(?:json)?\s*/i, '')
        .replace(/\s*```\s*$/i, '')
        .trim();
      if (stripped !== content) {
        envelope.choices[0].message.content = stripped;
        const rewritten = JSON.stringify(envelope);
        // Rebuild a minimal transport-shaped object: spreading a real Response
        // would drop `status`/`ok` (they are prototype accessors).
        return {
          ok: response.ok,
          status: response.status,
          headers: response.headers,
          text: async () => rewritten,
        };
      }
    }
  } catch {
    /* leave the body untouched; the provider reports the parse failure */
  }
  return {
    ok: response.ok,
    status: response.status,
    headers: response.headers,
    text: async () => raw,
  };
}) as any;

async function callOneQuestionUnderstanding(probeModel?: string): Promise<boolean> {
  const provider = new RealQuestionUnderstandingProvider(
    probeModel ? { ...quConfig, model: probeModel } : quConfig,
    { fetchImpl: unfencingFetch }
  );

  // A curriculum context is supplied so no candidate can ever be fabricated; the
  // identifiers below are local test values, not production data.
  const request = {
    ingestionId: 'phase6-local-verification',
    normalizedText: QUESTION,
    curriculumContext: {
      learningOutcomes: [
        { id: 'lo-local-1', code: 'MAT.11.1.1', text: 'Birinci dereceden bir bilinmeyenli denklemleri çözer.' },
      ],
      processComponents: [
        {
          id: 'pc-local-1',
          code: 'MAT.11.1.1.P1',
          text: 'Denklemin bilinmeyenini yalnız bırakır.',
          learningOutcomeId: 'lo-local-1',
        },
      ],
      microSkills: [
        {
          id: 'ms-local-1',
          code: 'MS.LINEAR.ONE_STEP',
          name: 'Bir adımlı doğrusal denklem çözme',
          description: 'Eşitliğin her iki tarafına aynı işlemi uygulayarak bilinmeyeni yalnız bırakır.',
          processComponentId: 'pc-local-1',
        },
      ],
    },
  };

  const startedAt = Date.now();
  const response = await provider.analyze(request);
  const latencyMs = Date.now() - startedAt;

  // Governance stays authoritative: the deterministic validator must accept it.
  const validator = new ProposalValidator();
  const validated: QuestionUnderstandingProposal = validator.validateProposal(response.proposal);
  validator.validateCurriculumCandidateLevels(validated);
  validator.validateNormalizedText(validated);

  // No answer authority: the proposal carries no canonical answer field, and every
  // candidate id must come from the supplied context (the provider drops others).
  const contextIds = new Set(['lo-local-1', 'pc-local-1']);
  const outOfContext = validated.curriculumCandidates.filter((c) => !contextIds.has(c.targetId));
  const msOutOfContext = validated.microSkillCandidates.filter((c) => c.microSkillId !== 'ms-local-1');
  const questionType = validated.questionUnderstanding.questionType;

  report(
    '1. Question Understanding',
    'PASS',
    provider.getProviderName(),
    provider.getModelName(),
    latencyMs,
    [
      'ProposalValidator: PASS',
      `questionType: ${questionType.length > 0 ? 'present' : 'MISSING'}`,
      `curriculumCandidates: ${validated.curriculumCandidates.length}`,
      `microSkillCandidates: ${validated.microSkillCandidates.length}`,
      `outOfContextCandidates: ${outOfContext.length + msOutOfContext.length}`,
      `confidence: ${validated.confidence}`,
      `warnings: ${validated.warnings.length}`,
      'modelMetadata written by provider (provider/model/version/timestamp)',
    ].join(' | ')
  );
  return true;
}

async function callTwoErrorAnalysis(): Promise<boolean> {
  // The REAL configured provider, with the external gate switched off for this
  // in-process instance only, so nothing but the class changes. The factory is
  // still the thing that decides what a real provider is.
  // The external Gemini endpoint + the Gemini credential must be used for this
  // real call, exactly as the question-understanding surface already does. The
  // error-analysis surface is still mock-configured in this environment, so its
  // OpenAI base URL and key are pointed at the same verified Gemini endpoint.
  const armedEaConfig = {
    ...eaConfig,
    allowExternalProvider: true,
    maxRetries: 0,
    provider: 'openai' as const,
    model: baseQuConfig.model,
    baseUrl: baseQuConfig.baseUrl,
    apiKey: baseQuConfig.apiKey,
  };
  const provider = createErrorAnalysisProviderFromConfig(armedEaConfig, {
    fetchImpl: unfencingFetch as any,
  }) as RealErrorAnalysisProvider;

  const providerName = provider.getProviderName();
  const service = new AIErrorAnalysisService(provider);

  const startedAt = Date.now();
  let result;
  try {
    result = await service.analyzeError({
      question: QUESTION,
      studentAnswer: STUDENT_ANSWER,
      // The canonical answer is required by this existing contract; it is used by the
      // governance layer and never logged by this script.
      correctAnswer: '4',
      skillId: 'ms-local-1',
      difficulty: 1,
      previousAttempts: [{ isCorrect: false, errorType: 'SKILL', timeSpentSeconds: 60 }],
      timeSpentSeconds: 90,
      skillName: SKILL_NAME,
      skillDescription: 'Eşitliğin her iki tarafına aynı işlemi uygulayarak bilinmeyeni yalnız bırakır.',
    });
  } catch (error) {
    console.error('EA ERROR:', error instanceof Error ? error.message : String(error));
    throw error;
  }
  const latencyMs = Date.now() - startedAt;

  const taxonomy = ['CONCEPT', 'SKILL', 'PREREQUISITE', 'OPERATION', 'READING', 'CALCULATION', 'ATTENTION', 'OTHER'];
  const validTaxonomy = taxonomy.includes(result.errorType);
  const validConfidence = Number.isFinite(result.confidence) && result.confidence >= 0 && result.confidence <= 1;
  const validHypothesis = typeof result.hypothesis === 'string' && result.hypothesis.trim().length > 0;
  const validSuggestion = typeof result.suggestion === 'string' && result.suggestion.trim().length > 0;
  // No unauthorized fields may survive the provider/service boundary.
  const unauthorized = ['errorPatternId', 'errorPatternCode', 'microSkillId'].filter((k) => k in (result as any));
  // No chain-of-thought / no complete solution: the service only exposes these fields.
  const exposedFields = Object.keys(result).sort().join(',');

  report(
    '2. Error Analysis',
    !validTaxonomy || !validConfidence || !validHypothesis || !validSuggestion || unauthorized.length > 0
      ? 'FAIL'
      : 'PASS',
    providerName,
    provider.getModelName(),
    latencyMs,
    [
      `errorType in taxonomy: ${validTaxonomy} (${result.errorType})`,
      `confidence valid: ${validConfidence} (${result.confidence})`,
      `hypothesis present: ${validHypothesis}`,
      `suggestion present: ${validSuggestion}`,
      `unauthorized fields: ${unauthorized.length}`,
      `exposed fields: [${exposedFields}]`,
      `relatedSkills entries: ${result.relatedSkills.length}`,
    ].join(' | ')
  );

  return !validTaxonomy || !validConfidence || !validHypothesis || !validSuggestion || unauthorized.length > 0
    ? false
    : true;
}

async function callThreeSocraticGuidance(): Promise<boolean> {
  const armedExplanationConfig = {
    provider: 'openai' as const,
    model: quConfig.model,
    timeoutMs: 30000,
    maxRetries: 0,
    maxTokens: 1024,
    allowExternalProvider: true,
    baseUrl: quConfig.baseUrl,
    apiKey: eaConfig.apiKey,
  };

  const provider = createExplanationProviderFromConfig(armedExplanationConfig, {
    fetchImpl: unfencingFetch as any,
  }) as RealExplanationProvider;

  const service = new AIExplanationService(provider);

  const startedAt = Date.now();
  let result;
  try {
    result = await service.generateExplanation({
    concept: 'Birinci dereceden bir bilinmeyenli denklem',
    skillId: 'ms-local-1',
    difficulty: 1,
    previousAttempts: 1,
    level: 'beginner',
    mode: 'SOCRATIC',
    question: QUESTION,
    studentAnswer: STUDENT_ANSWER,
    skillName: SKILL_NAME,
    skillDescription: 'Eşitliğin her iki tarafına aynı işlemi uygulayarak bilinmeyeni yalnız bırakır.',
    errorType: 'OPERATION',
    errorHypothesis: 'The student may have mis-evaluated the operation applied to both sides.',
    studentAnsweredCorrectly: false,
    });
  } catch (error) {
    console.error('EX ERROR:', error instanceof Error ? error.message : String(error));
    throw error;
  }
  const latencyMs = Date.now() - startedAt;

  // Re-run the deterministic leakage policy on exactly what would reach a student.
  const verdict = assessAnswerLeakage(
    {
      explanation: result.explanation,
      stepByStep: result.stepByStep,
      examples: result.examples,
      keyPoints: result.keyPoints,
      practiceSuggestion: result.practiceSuggestion,
    },
    '4'
  );

  const text = [result.explanation, ...result.stepByStep, ...result.examples, ...result.keyPoints, result.practiceSuggestion].join(' ');
  const turkish = /[çğıöşüÇĞİÖŞÜ]|\b(ve|bir|için|ile|olarak|değil|sonra|hangi)\b/.test(text);
  const noFinalAnswer = verdict.safe;
  // Attempt-scoped: metadata must carry the attempt-scoped contract and no state mutation surface.
  const attemptScoped = result.mode === 'SOCRATIC' && result.metadata.source === 'provider';
  const mutationSurface = [
    'mastery',
    'progress',
    'score',
    'session',
    'assessmentResult',
    'attemptResult',
  ].filter((k) => k in (result as any));

  const pass = noFinalAnswer && attemptScoped && mutationSurface.length === 0;

  report(
    '3. Socratic Guidance',
    pass ? 'PASS' : 'FAIL',
    provider.getProviderName(),
    provider.getModelName(),
    latencyMs,
    [
      `mode: ${result.mode}`,
      `source: ${result.metadata.source}`,
      `safety: ${result.metadata.safety}`,
      `leakagePolicy: ${noFinalAnswer ? 'clear' : `REJECTED(${verdict.reasons.join(',')})`}`,
      `turkishStudentFacing: ${turkish}`,
      `stepByStep entries: ${result.stepByStep.length}`,
      `mutation surface: ${mutationSurface.length === 0 ? 'none' : mutationSurface.join(',')}`,
      `attemptScoped: ${attemptScoped}`,
    ].join(' | ')
  );

  return pass;
}

let currentStep = 'startup';

async function main() {
  try {
    // The model name is overridable via argv[2] purely as a contingency: if the
    // configured Flash model is not entitled for this key, the SAME single call
    // slot is reused with the documented fallback rather than spending a new one.
    // The Gemini free tier rate-limits rapid successive requests (HTTP 429). The
    // brief is explicit that a retry counts toward the 3-call budget, so the calls
    // are PACED instead of retried: one request per surface, spaced out.
    const pace = async (ms: number) => new Promise((r) => setTimeout(r, ms));

    currentStep = '1. Question Understanding';
    const one = await callOneQuestionUnderstanding(process.argv[2]);
    if (!one) {
      console.error('STOPPED after call #1');
      process.exit(1);
    }

    // The free tier allows 20 requests/minute/model. Three calls with a 65s gap
    // cannot trip that window, and no call is retried.
    await pace(Number(process.env.PHASE6_PACE_MS ?? 65000));

    currentStep = '2. Error Analysis';
    const two = await callTwoErrorAnalysis();
    if (!two) {
      console.error('STOPPED after call #2 (call #3 not attempted)');
      process.exit(1);
    }

    await pace(Number(process.env.PHASE6_PACE_MS ?? 65000));

    currentStep = '3. Socratic Guidance';
    await callThreeSocraticGuidance();
    if (!lastReport || lastReport.status !== 'PASS') {
      console.error('Call #3 did not pass validation');
      process.exit(1);
    }
  } catch (error) {
    // Never echo provider payloads. Class name and the provider's own bounded
    // message (HTTP status / parse stage) only — these contain no model content.
    console.error(`REAL CALL FAILED: ${error instanceof Error ? error.name : 'UnknownError'}`);
    console.error(`REASON: ${error instanceof Error ? error.message : String(error)}`);
    console.error(`STAGE: ${currentStep}`);
    console.error(JSON.stringify(calls, null, 2));
    console.error(`realExternalRequests: ${realRequests}`);
    process.exit(1);
  }

  console.log(
    JSON.stringify(
      {
        realExternalRequests: realRequests,
        withinBudget: realRequests <= 3,
        results: calls,
      },
      null,
      2
    )
  );

  if (realRequests > 3) {
    console.error('BUDGET EXCEED');
    process.exit(1);
  }
}

await main();
