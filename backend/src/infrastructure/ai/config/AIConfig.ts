import { getEnv } from '../../config/environment.js';

export interface AIConfig {
  // Phase 5F.9-C: only provider families with an actual implementation are
  // declared. anthropic/google/deepseek were removed — they had no provider
  // class and silently fell through to mock, advertising support that did not
  // exist.
  provider: 'openai' | 'mock';
  model: string;
  apiKey: string;
  baseUrl?: string;
  timeout: number;
  maxRetries: number;
  maxTokens: number;
  temperature: number;
}

export function getAIConfig(): AIConfig {
  const env = getEnv();

  const provider = (env.AI_PROVIDER || 'mock') as AIConfig['provider'];

  const configs: Record<string, Partial<AIConfig>> = {
    openai: {
      model: env.OPENAI_MODEL || 'gpt-4o',
      apiKey: env.OPENAI_API_KEY || '',
      baseUrl: 'https://api.openai.com/v1',
      maxTokens: 4000,
      temperature: 0.7,
    },
    mock: {
      model: 'mock-model',
      apiKey: 'mock-key',
      baseUrl: 'http://localhost:3000/mock',
      maxTokens: 1000,
      temperature: 0.5,
    },
  };

  // No silent fall-through: an unknown provider resolves to no config and the
  // factory rejects it explicitly.
  const config = configs[provider];
  if (!config) {
    return {
      provider,
      model: '',
      apiKey: '',
      baseUrl: undefined,
      maxTokens: 1000,
      temperature: 0.5,
      timeout: 30000,
      maxRetries: 3,
    };
  }
  
  return {
    provider,
    model: config.model || 'mock-model',
    apiKey: config.apiKey || 'mock-key',
    baseUrl: config.baseUrl || 'http://localhost:3000/mock',
    maxTokens: config.maxTokens || 1000,
    temperature: config.temperature || 0.5,
    timeout: 30000,
    maxRetries: 3,
  };
}
