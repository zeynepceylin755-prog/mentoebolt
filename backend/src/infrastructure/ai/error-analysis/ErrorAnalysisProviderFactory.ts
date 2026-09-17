import { IAIProvider } from '../../../domain/interfaces/ai/IAIProvider.js';
import { AiAnalysisError } from '../../../domain/errors/QuestionAnalysisErrors.js';
import { MockAIProvider } from '../providers/MockAIProvider.js';
import {
  RealErrorAnalysisProvider,
  type RealErrorAnalysisProviderOptions,
} from './RealErrorAnalysisProvider.js';
import {
  getErrorAnalysisConfig,
  type ErrorAnalysisConfig,
} from './config/ErrorAnalysisConfig.js';
import { logger } from '../../logging/logger.js';

/**
 * Error Analysis provider factory — Phase 5F.9-C
 *
 * Preserves the existing architecture: the provider is selected by configuration
 * and injected once at bootstrap. It does NOT silently substitute mock for a
 * misconfigured real provider — that would let production appear to use real AI
 * while serving canned results. Misconfiguration FAILS FAST.
 */
export function createErrorAnalysisProvider(
  options: RealErrorAnalysisProviderOptions = {}
): IAIProvider {
  const config = getErrorAnalysisConfig();
  return createErrorAnalysisProviderFromConfig(config, options);
}

export function createErrorAnalysisProviderFromConfig(
  config: ErrorAnalysisConfig,
  options: RealErrorAnalysisProviderOptions = {}
): IAIProvider {
  switch (config.provider) {
    case 'mock':
      return new MockAIProvider();

    case 'openai': {
      // Explicit data-egress gate: the student's answer must not leave the server
      // just because a real provider was selected.
      if (!config.allowExternalProvider) {
        throw new AiAnalysisError(
          'ERROR_ANALYSIS_PROVIDER=openai requires ' +
          'ERROR_ANALYSIS_ALLOW_EXTERNAL_PROVIDER=true ' +
          '(student answer would be sent to an external service)'
        );
      }
      if (!config.apiKey || config.apiKey.trim().length === 0) {
        throw new AiAnalysisError(
          'ERROR_ANALYSIS_PROVIDER=openai requires OPENAI_API_KEY to be configured'
        );
      }
      logger.info(
        { provider: config.provider, model: config.model, timeoutMs: config.timeoutMs },
        'Real error analysis provider enabled (external data egress allowed)'
      );
      return new RealErrorAnalysisProvider(config, options);
    }

    default:
      throw new AiAnalysisError(`Unknown ERROR_ANALYSIS_PROVIDER: ${String(config.provider)}`);
  }
}
