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
    
    switch (config.provider) {
      case 'openai':
        this.provider = new OpenAIProvider();
        break;
      case 'mock':
      default:
        this.provider = new MockAIProvider();
        break;
    }

    logger.info({ provider: config.provider, model: config.model }, 'AI provider initialized');
    return this.provider;
  }

  setProvider(provider: IAIProvider): void {
    this.provider = provider;
  }
}
