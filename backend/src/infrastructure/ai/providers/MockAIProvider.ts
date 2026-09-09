import { IAIProvider, AIRequest, AIResponse } from '../../../domain/interfaces/ai/IAIProvider.js';
import { logger } from '../../logging/logger.js';

export class MockAIProvider implements IAIProvider {
  private readonly model = 'mock-model';
  private readonly version = '1.0.0';

  getProviderName(): string {
    return 'mock';
  }

  getModelName(): string {
    return this.model;
  }

  getVersion(): string {
    return this.version;
  }

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async complete(request: AIRequest): Promise<AIResponse> {
    const startTime = Date.now();
    
    // Simulate latency
    await new Promise(resolve => setTimeout(resolve, 100 + Math.random() * 200));

    const lastMessage = request.messages[request.messages.length - 1];
    const userContent = lastMessage?.content || '';

    let responseContent = this.generateMockResponse(userContent, request);

    logger.debug({ 
      request: request.messages, 
      response: responseContent,
      model: this.model 
    }, 'Mock AI completion');

    return {
      content: responseContent,
      model: this.model,
      version: this.version,
      tokensUsed: Math.ceil(responseContent.length / 4),
      latencyMs: Date.now() - startTime,
      finishReason: 'stop',
      confidence: 0.8,
    };
  }

  async completeStructured<T>(request: AIRequest, schema: any): Promise<AIResponse & { structured: T }> {
    const response = await this.complete(request);
    
    try {
      const structured = JSON.parse(response.content) as T;
      return {
        ...response,
        structured,
      };
    } catch (error) {
      const defaultStructured = this.getDefaultStructured<T>(request);
      return {
        ...response,
        structured: defaultStructured,
      };
    }
  }

  private generateMockResponse(userContent: string, request: AIRequest): string {
    // Check if this is an error analysis request
    if (userContent.includes('error') || userContent.includes('yanlış') || userContent.includes('hata') || userContent.includes('türev')) {
      return JSON.stringify({
        errorType: 'CONCEPT',
        confidence: 0.7,
        hypothesis: 'Öğrenci temel kavramı yanlış anlamış olabilir. Türev alma kurallarını karıştırıyor.',
        relatedSkills: ['derivatives', 'calculus'],
        suggestion: 'Türev alma kurallarını tekrar gözden geçirin. Özellikle sabit katsayı kuralına dikkat edin.',
      });
    }

    // Check if this is a recommendation request
    if (userContent.includes('recommend') || userContent.includes('öner') || userContent.includes('tavsiye')) {
      return JSON.stringify({
        actionType: 'PRACTICE',
        focusSkillId: 'derivatives',
        focusSkillName: 'Türev Alma',
        reason: 'Öğrencinin türev konusunda temel kavramları pekiştirmesi gerekiyor.',
        priority: 4,
        estimatedTimeMinutes: 15,
        exercisesCount: 5,
        learningObjectives: ['Türev tanımını anlar', 'Türev alma kurallarını uygular'],
      });
    }

    // Check if this is an explanation request
    if (userContent.includes('explain') || userContent.includes('açıkla') || userContent.includes('türev')) {
      return JSON.stringify({
        explanation: 'Türev, bir fonksiyonun anlık değişim hızını ölçer. Bu, fonksiyonun eğimini her noktada bulmamızı sağlar.',
        stepByStep: [
          'Türev, limit kullanılarak tanımlanır.',
          'f\'(x) = lim[h→0] (f(x+h) - f(x))/h',
          'Bu formül, fonksiyonun her noktadaki eğimini verir.',
          'Örneğin, f(x) = x² için türev f\'(x) = 2x\'tir.',
        ],
        examples: [
          'Örnek 1: f(x) = 3x² → f\'(x) = 6x',
          'Örnek 2: f(x) = sin(x) → f\'(x) = cos(x)',
          'Örnek 3: f(x) = e^x → f\'(x) = e^x',
        ],
        keyPoints: [
          'Türev, değişim hızını ölçer',
          'Her fonksiyonun türevi farklıdır',
          'Türev alma kuralları ezberlenmelidir',
        ],
        practiceSuggestion: 'Türev alma kurallarını öğrenmek için 5-10 basit fonksiyonun türevini almayı dene.',
      });
    }

    // Default response
    return JSON.stringify({
      message: 'Anladım. Bu konuda yardımcı olabilirim.',
      confidence: 0.9,
    });
  }

  private getDefaultStructured<T>(request: AIRequest): T {
    const lastMessage = request.messages[request.messages.length - 1];
    const content = lastMessage?.content || '';

    if (content.includes('error') || content.includes('hata')) {
      return {
        errorType: 'OTHER',
        confidence: 0.5,
        hypothesis: 'Henüz analiz yapılamadı.',
        relatedSkills: [],
        suggestion: 'Lütfen soruyu tekrar deneyin.',
      } as unknown as T;
    }

    if (content.includes('recommend') || content.includes('öner')) {
      return {
        actionType: 'PRACTICE',
        focusSkillId: 'general',
        focusSkillName: 'Genel Tekrar',
        reason: 'Öğrenci verilerine göre genel tekrar öneriliyor.',
        priority: 3,
        estimatedTimeMinutes: 10,
        exercisesCount: 3,
        learningObjectives: ['Temel kavramları gözden geçir'],
      } as unknown as T;
    }

    return {} as T;
  }
}
