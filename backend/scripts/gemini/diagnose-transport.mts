/**
 * Phase 6 — transport diagnostic (no valid payload is produced).
 *
 * This script does NOT complete a provider request: the injected transport throws
 * AFTER recording the HTTP status, so the provider's own parser/envelope handling
 * reports the true incoming status (401 / 400 / 404 ...) instead of a generic
 * transient error. The prompt is never logged. At most one external request is made.
 *
 * Run: npx tsx scripts/gemini/diagnose-transport.mts [model]
 */
import { getQuestionUnderstandingConfig } from '../../src/infrastructure/ai/question-understanding/config/QuestionUnderstandingConfig.js';
import { RealQuestionUnderstandingProvider } from '../../src/infrastructure/ai/question-understanding/RealQuestionUnderstandingProvider.js';

const cfg = getQuestionUnderstandingConfig();
const model = process.argv[2] ?? cfg.model;

console.log('endpoint:', `${cfg.baseUrl}/chat/completions`);
console.log('model:', model);
console.log('transport: injected (status is recorded, then the response is withheld)');

class WithheldResponse extends Error {
  constructor(public readonly httpStatus: number) {
    super(`HTTP ${httpStatus}`);
    this.name = 'WithheldResponse';
  }
}

const provider = new RealQuestionUnderstandingProvider(
  { ...cfg, model, maxRetries: 0 },
  {
    fetchImpl: (async (url: string, init: any) => {
      const response = await (globalThis.fetch as any)(url, init);
      // The status is read and then the response is discarded, so the provider
      // reports the real status via its own error path.
      throw new WithheldResponse(response.status);
    }) as any,
  }
);

try {
  await provider.analyze({ ingestionId: 'diagnostic', normalizedText: 'diagnostic' });
  console.log('UNEXPECTED: request succeeded');
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.log('reported:', message);
}
