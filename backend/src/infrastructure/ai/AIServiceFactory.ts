import { IAIProvider } from '../../domain/interfaces/ai/IAIProvider.js';
import { MockAIProvider } from './providers/MockAIProvider.js';
import { OpenAIProvider } from './providers/OpenAIProvider.js';
import { getAIConfig } from './config/AIConfig.js';
import { logger } from '../logging/logger.js';

export class AIServiceFactory {
  private static instance: AIServiceFactory;
  private provider: IAIProvider | null = null;

  private constructor() {}

  static getInstance(): AIServiceFactory {
    if (!AIServiceFactory.instance) {
      AIServiceFactory.instance = new AIServiceFactory();
    }
    return AIServiceFactory.instance;
  }

  getProvider(): IAIProvider {
    if (this.provider) {
      return this.provider;
    }

    const config = getAIConfig();
    
    // Phase 5F.9-C: the factory is truthful. Only providers that actually have an
    // implementation are accepted; anything else is a hard configuration error
    // rather than a silent fall-through to mock.
    switch (config.provider) {
      case 'openai':
        if (!config.apiKey || config.apiKey.trim().length === 0) {
          throw new Error('AI_PROVIDER=openai requires OPENAI_API_KEY to be configured');
        }
        this.provider = new OpenAIProvider();
        break;
      case 'mock':
        this.provider = new MockAIProvider();
        break;
      default:
        throw new Error(
          `Unsupported AI_PROVIDER: ${String(config.provider)} (supported: mock, openai)`
        );
    }

    logger.info({ provider: config.provider, model: config.model }, 'AI provider initialized');
    return this.provider;
  }

  setProvider(provider: IAIProvider): void {
    this.provider = provider;
  }
}
