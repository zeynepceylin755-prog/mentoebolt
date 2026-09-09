import { PrismaClient } from '@prisma/client';
import { MasteryCalculationService } from '../../../domain/services/learning/MasteryCalculationService.js';
import { logger } from '../../../infrastructure/logging/logger.js';

export class MasteryService {
  private masteryCalculator: MasteryCalculationService;

  constructor(
    private readonly prisma: PrismaClient
  ) {
    this.masteryCalculator = new MasteryCalculationService();
  }

  async updateSkillMastery(
    studentId: string,
    skillId: string,
    attemptId: string,
    isCorrect: boolean,
    difficulty: number,
    timeSpentSeconds: number
  ): Promise<any> {
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

    let recencyDays = 30;
    if (lastAttemptAt) {
      recencyDays = Math.max(0, (Date.now() - new Date(lastAttemptAt).getTime()) / (1000 * 60 * 60 * 24));
    }

    const result = this.masteryCalculator.calculate({
      currentLevel,
      currentConfidence,
      isCorrect,
      difficulty,
      timeSpent: timeSpentSeconds,
      attemptsCount: attempts,
      correctAttempts,
      evidenceCount,
      recencyDays,
    });

    const nextReviewDays = this.calculateNextReview(result.newLevel, result.newConfidence, isCorrect);
    const nextReviewAt = new Date(Date.now() + nextReviewDays * 24 * 60 * 60 * 1000);

    const updatedMastery = await this.prisma.skillMastery.upsert({
      where: {
        studentId_skillId: {
          studentId,
          skillId,
        },
      },
      update: {
        masteryLevel: result.newLevel,
        confidence: result.newConfidence,
        attempts: { increment: 1 },
        correctAttempts: { increment: isCorrect ? 1 : 0 },
        lastAttemptAt: new Date(),
        trend: result.trend,
        nextReviewAt,
        evidenceCount: result.evidenceCount,
      },
      create: {
        studentId,
        skillId,
        masteryLevel: result.newLevel,
        confidence: result.newConfidence,
        attempts: 1,
        correctAttempts: isCorrect ? 1 : 0,
        lastAttemptAt: new Date(),
        trend: result.trend,
        nextReviewAt,
        evidenceCount: 1,
      },
    });

    await this.prisma.learningProgress.create({
      data: {
        studentId,
        skillId,
        date: new Date(),
        masteryLevel: result.newLevel,
        attemptsCount: attempts + 1,
        correctCount: correctAttempts + (isCorrect ? 1 : 0),
      },
    });

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
