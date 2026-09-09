import { PrismaClient } from '@prisma/client';
import { logger } from '../../../infrastructure/logging/logger.js';

export class NextLearningActionService {
  constructor(private readonly prisma: PrismaClient) {}

  async getNextAction(studentId: string): Promise<any> {
    const skillMasteries = await this.prisma.skillMastery.findMany({
      where: { studentId },
    });

    if (skillMasteries.length === 0) {
      return {
        actionType: 'ASSESS',
        reason: 'No skill data available. Starting diagnostic assessment.',
        estimatedTimeMinutes: 15,
        priority: 5,
      };
    }

    const weakSkills = skillMasteries.filter(s => s.masteryLevel < 40);
    const strongSkills = skillMasteries.filter(s => s.masteryLevel >= 70 && s.confidence >= 0.6);

    const dueForReview = skillMasteries.filter(
      s => s.nextReviewAt && new Date(s.nextReviewAt) <= new Date()
    );

    const activeSession = await this.prisma.learningSession.findFirst({
      where: {
        studentId,
        status: 'ACTIVE',
      },
    });

    if (activeSession) {
      const pendingQuestions = await this.prisma.learningSessionQuestion.findMany({
        where: {
          sessionId: activeSession.id,
          status: 'PENDING',
        },
        take: 1,
      });

      if (pendingQuestions.length > 0) {
        return {
          actionType: 'CONTINUE_SESSION',
          sessionId: activeSession.id,
          reason: 'Continue with current session',
          estimatedTimeMinutes: 5,
          priority: 4,
        };
      }

      return {
        actionType: 'COMPLETE_SESSION',
        sessionId: activeSession.id,
        reason: 'Complete current session',
        estimatedTimeMinutes: 2,
        priority: 4,
      };
    }

    if (dueForReview.length > 0) {
      const skill = dueForReview[0];
      return {
        actionType: 'SPACED_REPETITION',
        focusSkillId: skill.skillId,
        reason: `Due for spaced repetition review`,
        estimatedTimeMinutes: 10,
        priority: 5,
      };
    }

    if (weakSkills.length > 0) {
      const sorted = weakSkills.sort((a, b) => a.masteryLevel - b.masteryLevel);
      const skill = sorted[0];
      return {
        actionType: 'PRACTICE',
        focusSkillId: skill.skillId,
        reason: `Practice weak skill (mastery: ${Math.round(skill.masteryLevel)}%)`,
        estimatedTimeMinutes: 15,
        priority: 4,
      };
    }

    const developing = skillMasteries.filter(
      s => s.masteryLevel >= 40 && s.masteryLevel < 70
    );

    if (developing.length > 0) {
      const skill = developing[0];
      return {
        actionType: 'PRACTICE',
        focusSkillId: skill.skillId,
        reason: `Continue developing skill (mastery: ${Math.round(skill.masteryLevel)}%)`,
        estimatedTimeMinutes: 10,
        priority: 3,
      };
    }

    if (strongSkills.length > 0) {
      const skill = strongSkills[0];
      return {
        actionType: 'REVIEW',
        focusSkillId: skill.skillId,
        reason: `Maintain strong skill (mastery: ${Math.round(skill.masteryLevel)}%)`,
        estimatedTimeMinutes: 5,
        priority: 2,
      };
    }

    return {
      actionType: 'LEARN',
      reason: 'No specific skill identified. Start new learning session.',
      estimatedTimeMinutes: 20,
      priority: 3,
    };
  }

  async generateRecommendation(studentId: string): Promise<any> {
    const action = await this.getNextAction(studentId);

    const existing = await this.prisma.recommendation.findFirst({
      where: {
        studentId,
        status: 'PENDING',
        focusSkillId: action.focusSkillId || '',
      },
      orderBy: { createdAt: 'desc' },
    });

    if (existing && !existing.expiresAt) {
      return existing;
    }

    const recommendation = await this.prisma.recommendation.create({
      data: {
        studentId,
        focusSkillId: action.focusSkillId || 'unknown',
        focusSkillName: action.focusSkillId || 'General Practice',
        reason: action.reason,
        estimatedTimeMinutes: action.estimatedTimeMinutes,
        priority: action.priority,
        actionType: action.actionType,
        status: 'PENDING',
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    });

    return recommendation;
  }
}
