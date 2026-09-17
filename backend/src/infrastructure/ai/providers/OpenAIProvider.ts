import { IAIProvider, AIRequest, AIResponse } from '../../../domain/interfaces/ai/IAIProvider.js';
import { logger } from '../../logging/logger.js';
import { getAIConfig } from '../config/AIConfig.js';

export class OpenAIProvider implements IAIProvider {
  private readonly provider = 'openai';
  private readonly model: string;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeout: number;
  private readonly maxRetries: number;

  constructor() {
    const config = getAIConfig();
    this.model = config.model;
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl || 'https://api.openai.com/v1';
    this.timeout = config.timeout || 30000;
    this.maxRetries = config.maxRetries || 3;
  }

  getProviderName(): string {
    return this.provider;
  }

  getModelName(): string {
    return this.model;
  }

  getVersion(): string {
    // Phase 5F.9-C: truthful provider/model metadata. The previous hardcoded
    // '2024-02-15' invented a model version that was never the configured model.
    return this.model;
  }

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async complete(request: AIRequest): Promise<AIResponse> {
    const startTime = Date.now();
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      try {
        const response = await this.makeRequest(request);
        return response;
      } catch (error: unknown) {
        lastError = error as Error;
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.warn({ 
          attempt: attempt + 1, 
          maxRetries: this.maxRetries,
          error: errorMessage 
        }, 'OpenAI API request failed, retrying');
        
        if (attempt < this.maxRetries - 1) {
          await this.delay(Math.pow(2, attempt) * 1000);
        }
      }
    }

    throw new Error(`OpenAI API failed after ${this.maxRetries} attempts: ${lastError?.message}`);
  }

  async completeStructured<T>(request: AIRequest, schema: any): Promise<AIResponse & { structured: T }> {
    const structuredRequest: AIRequest = {
      ...request,
      messages: [
        {
          role: 'system',
          content: 'You must respond with valid JSON only. Do not include any other text.',
        },
        ...request.messages,
      ],
      responseFormat: 'json',
    };

    const response = await this.complete(structuredRequest);
    
    try {
      const structured = JSON.parse(response.content) as T;
      return {
        ...response,
        structured,
      };
    } catch (error) {
      // Phase 6.7 (privacy): never log the raw model output — it can contain
      // student content and/or internal reasoning. Log only safe metadata.
      logger.error(
        { error, contentLength: typeof response.content === 'string' ? response.content.length : 0 },
        'Failed to parse structured AI response'
      );
      throw new Error('Invalid structured response from AI');
    }
  }

  private async makeRequest(request: AIRequest): Promise<AIResponse> {
    const url = `${this.baseUrl}/chat/completions`;
    
    const body = {
      model: this.model,
      messages: request.messages.map(m => ({
        role: m.role,
        content: m.content,
      })),
      temperature: request.temperature || 0.7,
      max_tokens: request.maxTokens || 4000,
      response_format: request.responseFormat === 'json' ? { type: 'json_object' } : undefined,
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`OpenAI API error: ${response.status} - ${errorText}`);
      }

      const data = await response.json() as any;
      
      return {
        content: data.choices?.[0]?.message?.content || '',
        model: data.model || this.model,
        version: data.created?.toString() || this.getVersion(),
        tokensUsed: data.usage?.total_tokens || 0,
        latencyMs: Date.now() - (data.created || 0) * 1000,
        finishReason: data.choices?.[0]?.finish_reason || 'stop',
      };
    } catch (error: unknown) {
      clearTimeout(timeoutId);
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error('OpenAI API request timed out');
      }
      throw error;
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
