import { PrismaClient } from '@prisma/client';
import { logger } from '../../../infrastructure/logging/logger.js';

export class MasteryService {
  constructor(private readonly prisma: PrismaClient) {}

  async updateSkillMastery(
    studentId: string,
    skillId: string,
    attemptId: string,
    isCorrect: boolean,
    difficulty: number,
    timeSpentSeconds: number
  ): Promise<any> {
    // Get current mastery
    let mastery = await this.prisma.skillMastery.findUnique({
      where: {
        studentId_skillId: {
          studentId,
          skillId,
        },
      },
    });

    let currentLevel = 0;
    let currentConfidence = 0;
    let attempts = 0;
    let correctAttempts = 0;
    let evidenceCount = 0;
    let lastAttemptAt: Date | null = null;

    if (mastery) {
      currentLevel = mastery.masteryLevel;
      currentConfidence = mastery.confidence;
      attempts = mastery.attempts;
      correctAttempts = mastery.correctAttempts;
      evidenceCount = mastery.evidenceCount;
      lastAttemptAt = mastery.lastAttemptAt;
    }

    // Calculate days since last attempt
    let recencyDays = 30;
    if (lastAttemptAt) {
      recencyDays = Math.max(0, (Date.now() - new Date(lastAttemptAt).getTime()) / (1000 * 60 * 60 * 24));
    }

    // Simple mastery calculation
    const adjustment = isCorrect ? 3 : -3;
    const difficultyFactor = 1 + (difficulty - 3) * 0.1;
    const recencyFactor = Math.max(0.5, 1 - (recencyDays / 30) * 0.5);
    const confidenceFactor = Math.max(0.3, 1 - currentConfidence * 0.5);

    const totalAdjustment = adjustment * difficultyFactor * recencyFactor * confidenceFactor;
    let newLevel = Math.max(0, Math.min(100, currentLevel + totalAdjustment));
    let newConfidence = Math.min(1, currentConfidence + (isCorrect ? 0.05 : -0.05));

    // Calculate next review date
    const nextReviewDays = this.calculateNextReview(newLevel, newConfidence, isCorrect);
    const nextReviewAt = new Date(Date.now() + nextReviewDays * 24 * 60 * 60 * 1000);

    // Update mastery
    const updatedMastery = await this.prisma.skillMastery.upsert({
      where: {
        studentId_skillId: {
          studentId,
          skillId,
        },
      },
      update: {
        masteryLevel: newLevel,
        confidence: newConfidence,
        attempts: { increment: 1 },
        correctAttempts: { increment: isCorrect ? 1 : 0 },
        lastAttemptAt: new Date(),
        nextReviewAt,
        evidenceCount: { increment: 1 },
      },
      create: {
        studentId,
        skillId,
        masteryLevel: newLevel,
        confidence: newConfidence,
        attempts: 1,
        correctAttempts: isCorrect ? 1 : 0,
        lastAttemptAt: new Date(),
        nextReviewAt,
        evidenceCount: 1,
      },
    });

    // Record progress
    await this.prisma.learningProgress.create({
      data: {
        studentId,
        skillId,
        date: new Date(),
        masteryLevel: newLevel,
        attemptsCount: attempts + 1,
        correctCount: correctAttempts + (isCorrect ? 1 : 0),
      },
    });

    logger.info({
      studentId,
      skillId,
      previousLevel: currentLevel,
      newLevel,
      isCorrect,
    }, 'Skill mastery updated');

    return updatedMastery;
  }

  private calculateNextReview(level: number, confidence: number, isCorrect: boolean): number {
    let baseDays = 1;
    
    if (level >= 80 && confidence >= 0.7) {
      baseDays = 30;
    } else if (level >= 60 && confidence >= 0.5) {
      baseDays = 14;
    } else if (level >= 40) {
      baseDays = 7;
    } else {
      baseDays = 3;
    }

    if (!isCorrect) {
      baseDays = Math.max(1, Math.floor(baseDays / 2));
    }

    const variance = 0.8 + Math.random() * 0.4;
    return Math.round(baseDays * variance);
  }

  async getStudentMastery(studentId: string): Promise<any[]> {
    return this.prisma.skillMastery.findMany({
      where: { studentId },
      orderBy: { masteryLevel: 'desc' },
    });
  }
}
