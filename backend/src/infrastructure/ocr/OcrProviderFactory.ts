import { IOcrProvider } from '../../domain/interfaces/ocr/IOcrProvider.js';
import { IStorageProvider } from '../../domain/interfaces/storage/IStorageProvider.js';
import { OcrProviderError } from '../../domain/errors/QuestionAnalysisErrors.js';
import { MockOcrProvider } from './MockOcrProvider.js';
import { RealVisionOcrProvider, type RealVisionOcrProviderOptions } from './RealVisionOcrProvider.js';
import { getOcrConfig, type OcrConfig } from './config/OcrConfig.js';
import { logger } from '../logging/logger.js';

/**
 * OCR provider factory — Phase 5F.9-A
 *
 * Preserves the existing architecture: providers are chosen by configuration and
 * injected once at bootstrap. It does NOT silently substitute mock for a
 * misconfigured real provider — that would let production appear to work while
 * using fake OCR. Misconfiguration FAILS FAST.
 */
export function createOcrProvider(
  storageProvider: IStorageProvider,
  options: RealVisionOcrProviderOptions = {}
): IOcrProvider {
  const config = getOcrConfig();
  return createOcrProviderFromConfig(storageProvider, config, options);
}

export function createOcrProviderFromConfig(
  storageProvider: IStorageProvider,
  config: OcrConfig,
  options: RealVisionOcrProviderOptions = {}
): IOcrProvider {
  switch (config.provider) {
    case 'mock':
      return new MockOcrProvider();

    case 'openai': {
      // Explicit data-egress gate: student images must not leave the server just
      // because a real provider was selected. Require BOTH the flag and a key.
      if (!config.allowExternalProvider) {
        throw new OcrProviderError(
          'OCR_PROVIDER=openai requires OCR_ALLOW_EXTERNAL_PROVIDER=true ' +
          '(student images would be sent to an external service)'
        );
      }
      if (!config.apiKey || config.apiKey.trim().length === 0) {
        throw new OcrProviderError(
          'OCR_PROVIDER=openai requires OPENAI_API_KEY to be configured'
        );
      }
      logger.info(
        { provider: config.provider, model: config.model, timeoutMs: config.timeoutMs },
        'Real vision OCR provider enabled (external data egress allowed)'
      );
      return new RealVisionOcrProvider(storageProvider, config, options);
    }

    default:
      // Exhaustiveness guard: an unknown provider is a configuration error.
      throw new OcrProviderError(`Unknown OCR_PROVIDER: ${String(config.provider)}`);
  }
}
