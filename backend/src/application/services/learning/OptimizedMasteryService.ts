import { PrismaClient } from '@prisma/client';
import { MasteryCalculationService } from '../../../domain/services/learning/MasteryCalculationService.js';
import { CacheService } from '../../../infrastructure/cache/CacheService.js';
import { PerformanceMonitor } from '../../../infrastructure/monitoring/PerformanceMonitor.js';
import { logger } from '../../../infrastructure/logging/logger.js';

export class OptimizedMasteryService {
  private masteryCalculator: MasteryCalculationService;
  private cache: CacheService;
  private monitor: PerformanceMonitor;
  private batchQueue: Array<{
    studentId: string;
    skillId: string;
    attemptId: string;
    isCorrect: boolean;
    difficulty: number;
    timeSpentSeconds: number;
  }> = [];
  private batchTimeout: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: PrismaClient
  ) {
    this.masteryCalculator = new MasteryCalculationService();
    this.cache = CacheService.getInstance();
    this.monitor = PerformanceMonitor.getInstance();
  }

  async updateSkillMastery(
    studentId: string,
    skillId: string,
    attemptId: string,
    isCorrect: boolean,
    difficulty: number,
    timeSpentSeconds: number
  ): Promise<any> {
    return this.monitor.measure('mastery.update', async () => {
      // Try cache first
      const cacheKey = `mastery:${studentId}:${skillId}`;
      let mastery = await this.cache.get<any>(cacheKey);

      if (!mastery) {
        mastery = await this.prisma.skillMastery.findUnique({
          where: {
            studentId_skillId: {
              studentId,
              skillId,
            },
          },
        });
      }

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

      // Batch update for better performance
      this.batchQueue.push({
        studentId,
        skillId,
        attemptId,
        isCorrect,
        difficulty,
        timeSpentSeconds,
      });

      // Process batch immediately for critical operations
      await this.processBatch();

      // Update cache
      const updatedMastery = {
        masteryLevel: result.newLevel,
        confidence: result.newConfidence,
        attempts: attempts + 1,
        correctAttempts: correctAttempts + (isCorrect ? 1 : 0),
        lastAttemptAt: new Date(),
        trend: result.trend,
        nextReviewAt,
        evidenceCount: result.evidenceCount,
      };
      
      await this.cache.set(cacheKey, updatedMastery, 300); // 5 minute cache

      logger.debug({
        studentId,
        skillId,
        previousLevel: currentLevel,
        newLevel: result.newLevel,
        delta: result.delta,
      }, 'Mastery updated (batched)');

      return updatedMastery;
    });
  }

  async processBatch(): Promise<void> {
    if (this.batchQueue.length === 0) return;

    const batch = [...this.batchQueue];
    this.batchQueue = [];

    try {
      const updates = batch.map((item) => {
        const upsertData = {
          studentId: item.studentId,
          skillId: item.skillId,
          attempts: { increment: 1 },
          correctAttempts: { increment: item.isCorrect ? 1 : 0 },
          lastAttemptAt: new Date(),
          evidenceCount: { increment: 1 },
        };

        return this.prisma.skillMastery.upsert({
          where: {
            studentId_skillId: {
              studentId: item.studentId,
              skillId: item.skillId,
            },
          },
          update: upsertData,
          create: {
            studentId: item.studentId,
            skillId: item.skillId,
            masteryLevel: 0,
            confidence: 0,
            attempts: 1,
            correctAttempts: item.isCorrect ? 1 : 0,
            lastAttemptAt: new Date(),
            evidenceCount: 1,
          },
        });
      });

      await this.prisma.$transaction(updates);

      // Record progress in batch
      const progressData = batch.map(item => ({
        studentId: item.studentId,
        skillId: item.skillId,
        date: new Date(),
        masteryLevel: 0, // Will be updated by background job
        attemptsCount: 1,
        correctCount: item.isCorrect ? 1 : 0,
      }));

      await this.prisma.learningProgress.createMany({
        data: progressData,
        skipDuplicates: true,
      });

      logger.debug({
        batchSize: batch.length,
      }, 'Batch mastery updates processed');

    } catch (error) {
      logger.error({ error, batchSize: batch.length }, 'Batch processing failed');
      // Re-queue failed items
      this.batchQueue = [...batch, ...this.batchQueue];
    }
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
    return this.monitor.measure('mastery.get', async () => {
      const cacheKey = `mastery:all:${studentId}`;
      const cached = await this.cache.get<any[]>(cacheKey);
      
      if (cached) {
        return cached;
      }

      const masteries = await this.prisma.skillMastery.findMany({
        where: { studentId },
        orderBy: { masteryLevel: 'desc' },
      });

      await this.cache.set(cacheKey, masteries, 60); // 1 minute cache
      return masteries;
    });
  }
}
