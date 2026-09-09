import { IAIProvider } from '../../../domain/interfaces/ai/IAIProvider.js';
import { AIServiceFactory } from '../../../infrastructure/ai/AIServiceFactory.js';
import { logger } from '../../../infrastructure/logging/logger.js';

export interface ExplanationRequest {
  concept: string;
  question?: string;
  studentAnswer?: string;
  correctAnswer?: string;
  skillId: string;
  difficulty: number;
  previousAttempts: number;
  level: 'beginner' | 'intermediate' | 'advanced';
}

export interface ExplanationResult {
  explanation: string;
  stepByStep: string[];
  examples: string[];
  keyPoints: string[];
  practiceSuggestion: string;
  metadata: {
    model: string;
    version: string;
    timestamp: string;
    tokensUsed: number;
    latencyMs: number;
  };
}

export class AIExplanationService {
  private provider: IAIProvider;

  constructor(provider?: IAIProvider) {
    this.provider = provider || AIServiceFactory.getInstance().getProvider();
  }

  async generateExplanation(request: ExplanationRequest): Promise<ExplanationResult> {
    try {
      const prompt = this.buildPrompt(request);
      const schema = {};
      const response = await this.provider.completeStructured<ExplanationResult>({
        messages: [
          {
            role: 'system',
            content: `You are an expert math tutor explaining concepts clearly.
                      You must respond with valid JSON containing:
                      - explanation: clear, friendly explanation
                      - stepByStep: array of step-by-step instructions
                      - examples: array of example problems
                      - keyPoints: array of key takeaways
                      - practiceSuggestion: suggestion for practice`,
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        temperature: 0.5,
        maxTokens: 800,
        responseFormat: 'json',
      }, schema);

      const result = response.structured;

      if (!result.explanation || !result.stepByStep) {
        return this.getFallbackResult(request);
      }

      logger.info({
        skillId: request.skillId,
        tokensUsed: response.tokensUsed,
        latencyMs: response.latencyMs,
      }, 'AI explanation generated');

      return {
        ...result,
        metadata: {
          model: response.model,
          version: response.version,
          timestamp: new Date().toISOString(),
          tokensUsed: response.tokensUsed,
          latencyMs: response.latencyMs,
        },
      };
    } catch (error) {
      logger.error({ error, request }, 'AI explanation generation failed');
      return this.getFallbackResult(request);
    }
  }

  private buildPrompt(request: ExplanationRequest): string {
    let context = `Concept: ${request.concept}
Difficulty: ${request.difficulty}
Level: ${request.level}
Previous attempts: ${request.previousAttempts}
`;

    if (request.question) {
      context += `\nQuestion: ${request.question}`;
    }

    if (request.studentAnswer) {
      context += `\nStudent Answer: ${request.studentAnswer}`;
    }

    if (request.correctAnswer) {
      context += `\nCorrect Answer: ${request.correctAnswer}`;
    }

    return `
${context}

Please explain this concept in a way that is:
1. Clear and easy to understand
2. Step-by-step
3. Includes examples
4. Highlights key points
5. Suggests next steps for practice
`;
  }

  private getFallbackResult(request: ExplanationRequest): ExplanationResult {
    return {
      explanation: `Let's break down ${request.concept} step by step. This is an important concept that builds on what you already know.`,
      stepByStep: [
        'Step 1: Understand the basic definition',
        'Step 2: Work through a simple example',
        'Step 3: Identify the key patterns',
        'Step 4: Practice with a similar problem',
        'Step 5: Apply what you learned to the original question',
      ],
      examples: [
        'Example 1: Start with a simple case',
        'Example 2: Try a slightly harder problem',
        'Example 3: Apply to the original question',
      ],
      keyPoints: [
        'Focus on understanding the core concept',
        'Practice regularly to build confidence',
        'Ask questions when something is unclear',
      ],
      practiceSuggestion: `Try solving 3-5 practice problems about ${request.concept} to reinforce your understanding.`,
      metadata: {
        model: 'fallback',
        version: '1.0',
        timestamp: new Date().toISOString(),
        tokensUsed: 0,
        latencyMs: 0,
      },
    };
  }
}
