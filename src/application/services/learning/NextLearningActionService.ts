import { PrismaClient } from '@prisma/client';

export class NextLearningActionService {
  constructor(private readonly prisma: PrismaClient) {}

  async getNextAction(studentId: string): Promise<any> {
    const masteries = await this.prisma.skillMastery.findMany({
      where: { studentId },
      orderBy: { masteryLevel: 'asc' },
    });

    if (masteries.length === 0) {
      return {
        actionType: 'ASSESS',
        reason: 'No skill data available. Starting diagnostic assessment.',
        estimatedTimeMinutes: 15,
        priority: 5,
      };
    }

    // Find weakest skill
    const weakest = masteries[0];
    if (weakest.masteryLevel < 40) {
      return {
        actionType: 'PRACTICE',
        focusSkillId: weakest.skillId,
        reason: `Weak skill needs practice (mastery: ${Math.round(weakest.masteryLevel)}%)`,
        estimatedTimeMinutes: 15,
        priority: 4,
      };
    }

    // Check for skills due for review
    const dueForReview = masteries.filter(
      s => s.nextReviewAt && new Date(s.nextReviewAt) <= new Date()
    );

    if (dueForReview.length > 0) {
      const skill = dueForReview[0];
      return {
        actionType: 'SPACED_REPETITION',
        focusSkillId: skill.skillId,
        reason: 'Due for spaced repetition review',
        estimatedTimeMinutes: 10,
        priority: 5,
      };
    }

    return {
      actionType: 'PRACTICE',
      reason: 'Continue practicing to maintain skills',
      estimatedTimeMinutes: 10,
      priority: 3,
    };
  }
}
