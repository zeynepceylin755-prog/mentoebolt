import { IAIProvider } from '../../../domain/interfaces/ai/IAIProvider.js';
import { AIServiceFactory } from '../../../infrastructure/ai/AIServiceFactory.js';
import { logger } from '../../../infrastructure/logging/logger.js';

export interface RecommendationRequest {
  studentId: string;
  currentMastery: Array<{
    skillId: string;
    masteryLevel: number;
    confidence: number;
    attempts: number;
    correctAttempts: number;
    lastAttemptAt: Date | null;
    trend: string | null;
  }>;
  weakSkills: Array<{
    skillId: string;
    masteryLevel: number;
    confidence: number;
  }>;
  strongSkills: Array<{
    skillId: string;
    masteryLevel: number;
    confidence: number;
  }>;
  recentAttempts: Array<{
    questionId: string;
    skillId: string;
    isCorrect: boolean;
    errorType?: string;
    createdAt: Date;
  }>;
  learningStage: string;
}

export interface RecommendationResult {
  actionType: 'PRACTICE' | 'REVIEW' | 'LEARN' | 'VALIDATE' | 'ASSESS' | 'SPACED_REPETITION';
  focusSkillId: string;
  focusSkillName: string;
  reason: string;
  priority: number;
  estimatedTimeMinutes: number;
  exercisesCount?: number;
  learningObjectives: string[];
  metadata: {
    model: string;
    version: string;
    timestamp: string;
    tokensUsed: number;
    latencyMs: number;
    confidence: number;
  };
}

export class AIRecommendationService {
  private provider: IAIProvider;

  constructor(provider?: IAIProvider) {
    this.provider = provider || AIServiceFactory.getInstance().getProvider();
  }

  async generateRecommendation(request: RecommendationRequest): Promise<RecommendationResult> {
    try {
      const prompt = this.buildPrompt(request);
      const schema = {}; // Empty schema for validation
      const response = await this.provider.completeStructured<RecommendationResult>({
        messages: [
          {
            role: 'system',
            content: `You are an expert learning advisor for a math education platform.
                      You must respond with valid JSON containing:
                      - actionType: one of PRACTICE, REVIEW, LEARN, VALIDATE, ASSESS, SPACED_REPETITION
                      - focusSkillId: the skill ID to focus on
                      - focusSkillName: the name of the skill
                      - reason: clear explanation of why this recommendation
                      - priority: number 1-5 (5 is highest)
                      - estimatedTimeMinutes: number
                      - exercisesCount: optional number of exercises
                      - learningObjectives: array of learning objective descriptions`,
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        temperature: 0.3,
        maxTokens: 600,
        responseFormat: 'json',
      }, schema);

      const result = response.structured;

      if (!result.actionType || !result.focusSkillId || !result.reason) {
        return this.getFallbackResult(request);
      }

      logger.info({
        actionType: result.actionType,
        focusSkillId: result.focusSkillId,
        priority: result.priority,
        confidence: response.confidence,
      }, 'AI recommendation generated');

      return {
        ...result,
        metadata: {
          model: response.model,
          version: response.version,
          timestamp: new Date().toISOString(),
          tokensUsed: response.tokensUsed,
          latencyMs: response.latencyMs,
          confidence: response.confidence || 0.7,
        },
      };
    } catch (error) {
      // Phase 5F.9-A (security): log identifiers/metadata only, never the
      // student's mastery payload.
      logger.error(
        { studentId: request.studentId, error: error instanceof Error ? error.message : String(error) },
        'AI recommendation generation failed'
      );
      return this.getFallbackResult(request);
    }
  }

  private buildPrompt(request: RecommendationRequest): string {
    const masterySummary = request.currentMastery
      .map(s => `- ${s.skillId}: ${Math.round(s.masteryLevel)}% (confidence: ${Math.round(s.confidence * 100)}%)`)
      .join('\n');

    const weakSummary = request.weakSkills
      .map(s => `- ${s.skillId}: ${Math.round(s.masteryLevel)}%`)
      .join('\n');

    const strongSummary = request.strongSkills
      .map(s => `- ${s.skillId}: ${Math.round(s.masteryLevel)}%`)
      .join('\n');

    const recentActivity = request.recentAttempts
      .slice(-10)
      .map(a => `- ${a.skillId}: ${a.isCorrect ? '✓' : '✗'}${a.errorType ? ` (${a.errorType})` : ''}`)
      .join('\n');

    return `
Student Learning State:
Learning Stage: ${request.learningStage}

Current Mastery Levels:
${masterySummary || 'No mastery data available'}

Weak Skills (below 40%):
${weakSummary || 'No weak skills identified'}

Strong Skills (above 70%):
${strongSummary || 'No strong skills identified'}

Recent Activity:
${recentActivity || 'No recent activity'}

Based on this data, what is the best next learning action for this student?
`;
  }

  private getFallbackResult(request: RecommendationRequest): RecommendationResult {
    if (request.weakSkills.length > 0) {
      const skill = request.weakSkills[0];
      return {
        actionType: 'PRACTICE',
        focusSkillId: skill.skillId,
        focusSkillName: `Skill ${skill.skillId}`,
        reason: `This skill needs immediate attention (mastery: ${Math.round(skill.masteryLevel)}%)`,
        priority: 5,
        estimatedTimeMinutes: 15,
        exercisesCount: 5,
        learningObjectives: ['Master the core concepts of this skill'],
        metadata: {
          model: 'fallback',
          version: '1.0',
          timestamp: new Date().toISOString(),
          tokensUsed: 0,
          latencyMs: 0,
          confidence: 0.5,
        },
      };
    }

    return {
      actionType: 'ASSESS',
      focusSkillId: 'general',
      focusSkillName: 'General Assessment',
      reason: 'No specific skill identified. Starting general assessment.',
      priority: 3,
      estimatedTimeMinutes: 20,
      exercisesCount: 10,
      learningObjectives: ['Assess overall understanding'],
      metadata: {
        model: 'fallback',
        version: '1.0',
        timestamp: new Date().toISOString(),
        tokensUsed: 0,
        latencyMs: 0,
        confidence: 0.5,
      },
    };
  }
}
