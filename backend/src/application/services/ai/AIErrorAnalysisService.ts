import { IAIProvider } from '../../../domain/interfaces/ai/IAIProvider.js';
import { AIServiceFactory } from '../../../infrastructure/ai/AIServiceFactory.js';
import { logger } from '../../../infrastructure/logging/logger.js';

export interface ErrorAnalysisRequest {
  question: string;
  studentAnswer: string;
  correctAnswer: string;
  skillId: string;
  difficulty: number;
  previousAttempts: Array<{
    isCorrect: boolean;
    errorType?: string;
    timeSpentSeconds: number;
  }>;
  timeSpentSeconds: number;
}

export interface ErrorAnalysisResult {
  errorType: 'CONCEPT' | 'SKILL' | 'PREREQUISITE' | 'OPERATION' | 'READING' | 'CALCULATION' | 'ATTENTION' | 'OTHER';
  confidence: number;
  hypothesis: string;
  relatedSkills: string[];
  suggestion: string;
  metadata: {
    model: string;
    version: string;
    timestamp: string;
    tokensUsed: number;
    latencyMs: number;
  };
}

export class AIErrorAnalysisService {
  private provider: IAIProvider;

  constructor(provider?: IAIProvider) {
    this.provider = provider || AIServiceFactory.getInstance().getProvider();
  }

  async analyzeError(request: ErrorAnalysisRequest): Promise<ErrorAnalysisResult> {
    try {
      const prompt = this.buildPrompt(request);
      const schema = {}; // Empty schema for validation
      const response = await this.provider.completeStructured<ErrorAnalysisResult>({
        messages: [
          {
            role: 'system',
            content: `You are an expert math tutor analyzing student errors.
                      You must respond with valid JSON containing:
                      - errorType: one of CONCEPT, SKILL, PREREQUISITE, OPERATION, READING, CALCULATION, ATTENTION, OTHER
                      - confidence: number between 0 and 1
                      - hypothesis: string explaining why the student made this error
                      - relatedSkills: array of skill IDs that might be related
                      - suggestion: string with actionable advice for the student`,
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        temperature: 0.3,
        maxTokens: 500,
        responseFormat: 'json',
      }, schema);

      const result = response.structured;

      if (!result.errorType || !result.confidence || !result.hypothesis) {
        return this.getFallbackResult(request);
      }

      logger.info({
        errorType: result.errorType,
        confidence: result.confidence,
        tokensUsed: response.tokensUsed,
        latencyMs: response.latencyMs,
      }, 'AI error analysis completed');

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
      logger.error({ error, request }, 'AI error analysis failed');
      return this.getFallbackResult(request);
    }
  }

  private buildPrompt(request: ErrorAnalysisRequest): string {
    const previousAttempts = request.previousAttempts
      .slice(-5)
      .map((a, i) => `Attempt ${i + 1}: ${a.isCorrect ? 'Correct' : 'Incorrect'}${a.errorType ? ` (${a.errorType})` : ''}`)
      .join('\n');

    return `
Question: ${request.question}
Correct Answer: ${request.correctAnswer}
Student Answer: ${request.studentAnswer}
Difficulty: ${request.difficulty}
Time Spent: ${request.timeSpentSeconds} seconds
Previous Attempts:
${previousAttempts || 'None'}

Analyze this student's error and provide a detailed diagnosis.
Consider:
1. What type of error is this?
2. Why might the student have made this error?
3. What skills might be related?
4. What should the student do next?
`;
  }

  private getFallbackResult(request: ErrorAnalysisRequest): ErrorAnalysisResult {
    return {
      errorType: 'OTHER',
      confidence: 0.3,
      hypothesis: 'Unable to analyze error. Please try again or seek help from a teacher.',
      relatedSkills: [request.skillId],
      suggestion: 'Review the question and try again carefully.',
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
