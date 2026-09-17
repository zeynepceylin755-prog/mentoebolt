import { IQuestionUnderstandingProvider } from '../../../domain/interfaces/ai/IQuestionUnderstandingProvider.js';
import { AiAnalysisError } from '../../../domain/errors/QuestionAnalysisErrors.js';
import { MockQuestionUnderstandingProvider } from '../providers/MockQuestionUnderstandingProvider.js';
import {
  RealQuestionUnderstandingProvider,
  type RealQuestionUnderstandingProviderOptions,
} from './RealQuestionUnderstandingProvider.js';
import {
  getQuestionUnderstandingConfig,
  type QuestionUnderstandingConfig,
} from './config/QuestionUnderstandingConfig.js';
import { logger } from '../../logging/logger.js';

/**
 * Question Understanding provider factory — Phase 5F.9-B
 *
 * Preserves the existing architecture: providers are chosen by configuration and
 * injected once at bootstrap. It does NOT silently substitute mock for a
 * misconfigured real provider — that would let production appear to work while
 * using fake AI. Misconfiguration FAILS FAST.
 */
export function createQuestionUnderstandingProvider(
  options: RealQuestionUnderstandingProviderOptions = {}
): IQuestionUnderstandingProvider {
  const config = getQuestionUnderstandingConfig();
  return createQuestionUnderstandingProviderFromConfig(config, options);
}

export function createQuestionUnderstandingProviderFromConfig(
  config: QuestionUnderstandingConfig,
  options: RealQuestionUnderstandingProviderOptions = {}
): IQuestionUnderstandingProvider {
  switch (config.provider) {
    case 'mock':
      return new MockQuestionUnderstandingProvider();

    case 'openai': {
      // Explicit data-egress gate: question text must not leave the server just
      // because a real provider was selected.
      if (!config.allowExternalProvider) {
        throw new AiAnalysisError(
          'QUESTION_UNDERSTANDING_PROVIDER=openai requires ' +
          'QUESTION_UNDERSTANDING_ALLOW_EXTERNAL_PROVIDER=true ' +
          '(question text would be sent to an external service)'
        );
      }
      if (!config.apiKey || config.apiKey.trim().length === 0) {
        throw new AiAnalysisError(
          'QUESTION_UNDERSTANDING_PROVIDER=openai requires OPENAI_API_KEY to be configured'
        );
      }
      logger.info(
        { provider: config.provider, model: config.model, timeoutMs: config.timeoutMs },
        'Real question understanding provider enabled (external data egress allowed)'
      );
      return new RealQuestionUnderstandingProvider(config, options);
    }

    default:
      throw new AiAnalysisError(
        `Unknown QUESTION_UNDERSTANDING_PROVIDER: ${String(config.provider)}`
      );
  }
}
