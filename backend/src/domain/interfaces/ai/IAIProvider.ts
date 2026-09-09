export interface AIRequest {
  messages: AIMessage[];
  temperature?: number;
  maxTokens?: number;
  responseFormat?: 'json' | 'text';
  timeout?: number;
}

export interface AIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface AIResponse {
  content: string;
  structured?: any;
  model: string;
  version: string;
  tokensUsed: number;
  latencyMs: number;
  finishReason: 'stop' | 'length' | 'error';
  confidence?: number;
}

export interface AIProviderConfig {
  provider: string;
  model: string;
  apiKey: string;
  baseUrl?: string;
  timeout: number;
  maxRetries: number;
  rateLimit: number;
}

export interface IAIProvider {
  getProviderName(): string;
  getModelName(): string;
  getVersion(): string;
  complete(request: AIRequest): Promise<AIResponse>;
  completeStructured<T>(request: AIRequest, schema: any): Promise<AIResponse & { structured: T }>;
  isAvailable(): Promise<boolean>;
}
