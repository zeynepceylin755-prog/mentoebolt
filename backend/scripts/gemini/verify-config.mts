/**
 * Phase 6 — secret-safe configuration report.
 *
 * Reuses the application's OWN configuration getters (no second config system) and
 * prints only non-secret metadata. The API key is NEVER printed: only a
 * CONFIGURED / NOT_CONFIGURED verdict. No network call is made here.
 *
 * Run: npx tsx scripts/gemini/verify-config.mts
 */
import { getQuestionUnderstandingConfig } from '../../src/infrastructure/ai/question-understanding/config/QuestionUnderstandingConfig.js';
import { getErrorAnalysisConfig } from '../../src/infrastructure/ai/error-analysis/config/ErrorAnalysisConfig.js';
import { getExplanationConfig } from '../../src/infrastructure/ai/explanation/config/ExplanationConfig.js';

function describe(label: string, cfg: { provider: string; model: string; baseUrl: string; allowExternalProvider: boolean; apiKey: string; timeoutMs: number; maxRetries: number }) {
  const keyState = cfg.apiKey && cfg.apiKey.trim().length > 0 ? 'CONFIGURED' : 'NOT_CONFIGURED';
  return {
    surface: label,
    apiKey: keyState,
    provider: cfg.provider,
    model: cfg.model,
    baseUrl: cfg.baseUrl,
    externalProviderGate: cfg.allowExternalProvider,
    timeoutMs: cfg.timeoutMs,
    maxRetries: cfg.maxRetries,
  };
}

const report = {
  questionUnderstanding: describe('question-understanding', getQuestionUnderstandingConfig()),
  errorAnalysis: describe('error-analysis', getErrorAnalysisConfig()),
  explanation: describe('explanation', getExplanationConfig()),
};

console.log(JSON.stringify(report, null, 2));

// A defensive assertion: nothing that looks like a secret may appear in this output.
const serialized = JSON.stringify(report);
if (/sk-[A-Za-z0-9]|AIza[A-Za-z0-9_-]/.test(serialized)) {
  console.error('SECRET_LEAK_DETECTED: configuration report contained a key-like value');
  process.exit(2);
}
