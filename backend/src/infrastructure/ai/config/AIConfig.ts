import { getEnv } from '../../config/environment.js';

export interface AIConfig {
  provider: 'openai' | 'anthropic' | 'google' | 'deepseek' | 'mock';
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
      model: env.OPENAI_MODEL || 'gpt-4-turbo-preview',
      apiKey: env.OPENAI_API_KEY || '',
      baseUrl: 'https://api.openai.com/v1',
      maxTokens: 4000,
      temperature: 0.7,
    },
    anthropic: {
      model: env.ANTHROPIC_MODEL || 'claude-3-opus-20240229',
      apiKey: env.ANTHROPIC_API_KEY || '',
      baseUrl: 'https://api.anthropic.com/v1',
      maxTokens: 4000,
      temperature: 0.7,
    },
    google: {
      model: env.GOOGLE_MODEL || 'gemini-pro',
      apiKey: env.GOOGLE_API_KEY || '',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
      maxTokens: 4000,
      temperature: 0.7,
    },
    deepseek: {
      model: 'deepseek-chat',
      apiKey: env.DEEPSEEK_API_KEY || '',
      baseUrl: 'https://api.deepseek.com/v1',
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

  const config = configs[provider] || configs.mock;
  
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
