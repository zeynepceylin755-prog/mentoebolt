import { IAIProvider } from '../../../domain/interfaces/ai/IAIProvider.js';
import { AiAnalysisError } from '../../../domain/errors/QuestionAnalysisErrors.js';
import { MockAIProvider } from '../providers/MockAIProvider.js';
import {
  RealExplanationProvider,
  type RealExplanationProviderOptions,
} from './RealExplanationProvider.js';
import {
  getExplanationConfig,
  type ExplanationConfig,
} from './config/ExplanationConfig.js';
import { logger } from '../../logging/logger.js';

/**
 * Explanation provider factory — Phase 5F.9-D
 *
 * Preserves the existing architecture: the provider is selected by configuration
 * and injected once at bootstrap. It does NOT silently substitute mock for a
 * misconfigured real provider — that would let production appear to use real AI
 * while serving canned results. Misconfiguration FAILS FAST.
 */
export function createExplanationProvider(
  options: RealExplanationProviderOptions = {}
): IAIProvider {
  const config = getExplanationConfig();
  return createExplanationProviderFromConfig(config, options);
}

export function createExplanationProviderFromConfig(
  config: ExplanationConfig,
  options: RealExplanationProviderOptions = {}
): IAIProvider {
  switch (config.provider) {
    case 'mock':
      return new MockAIProvider();

    case 'openai': {
      // Explicit data-egress gate: the student's answer must not leave the server
      // just because a real provider was selected.
      if (!config.allowExternalProvider) {
        throw new AiAnalysisError(
          'EXPLANATION_PROVIDER=openai requires ' +
          'EXPLANATION_ALLOW_EXTERNAL_PROVIDER=true ' +
          '(student answer would be sent to an external service)'
        );
      }
      if (!config.apiKey || config.apiKey.trim().length === 0) {
        throw new AiAnalysisError(
          'EXPLANATION_PROVIDER=openai requires OPENAI_API_KEY to be configured'
        );
      }
      logger.info(
        { provider: config.provider, model: config.model, timeoutMs: config.timeoutMs },
        'Real explanation provider enabled (external data egress allowed)'
      );
      return new RealExplanationProvider(config, options);
    }

    default:
      throw new AiAnalysisError(`Unknown EXPLANATION_PROVIDER: ${String(config.provider)}`);
  }
}
