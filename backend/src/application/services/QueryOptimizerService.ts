import { PrismaClient } from '@prisma/client';
import { logger } from '../../infrastructure/logging/logger.js';

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttl: number;
}

export class QueryOptimizerService {
  private cache: Map<string, CacheEntry<any>> = new Map();
  private prisma: PrismaClient;
  
  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  // Generic cached query with TTL
  async cachedQuery<T>(
    key: string,
    queryFn: () => Promise<T>,
    ttl: number = 60000 // 1 minute default
  ): Promise<T> {
    const cached = this.cache.get(key);
    const now = Date.now();
    
    if (cached && (now - cached.timestamp) < cached.ttl) {
      logger.debug({ key }, 'Cache hit');
      return cached.data;
    }
    
    logger.debug({ key }, 'Cache miss');
    const result = await queryFn();
    this.cache.set(key, {
      data: result,
      timestamp: now,
      ttl,
    });
    
    return result;
  }

  // Clear cache for a specific key or pattern
  clearCache(keyPattern?: string): void {
    if (keyPattern) {
      for (const key of this.cache.keys()) {
        if (key.includes(keyPattern)) {
          this.cache.delete(key);
        }
      }
    } else {
      this.cache.clear();
    }
    logger.debug({ keyPattern }, 'Cache cleared');
  }

  // Optimized student progress query
  async getStudentProgressOptimized(studentId: string) {
    return this.cachedQuery(
      `progress:${studentId}`,
      async () => {
        const [attempts, sessions, masteries] = await Promise.all([
          this.prisma.questionAttempt.findMany({
            where: { studentId },
            select: {
              isCorrect: true,
              createdAt: true,
              timeSpentSeconds: true,
            },
            orderBy: { createdAt: 'desc' },
            take: 100, // Limit for performance
          }),
          this.prisma.learningSession.findMany({
            where: { studentId },
            select: {
              durationSeconds: true,
              createdAt: true,
            },
            orderBy: { createdAt: 'desc' },
            take: 50,
          }),
          this.prisma.skillMastery.findMany({
            where: { studentId },
            select: {
              skillId: true,
              masteryLevel: true,
              confidence: true,
            },
          }),
        ]);

        return { attempts, sessions, masteries };
      },
      30000 // 30 seconds cache for progress
    );
  }

  // Optimized skill mastery query with batch loading
  async getSkillMasteryBatch(studentIds: string[]): Promise<Map<string, any>> {
    const key = `mastery:batch:${studentIds.sort().join(',')}`;
    
    return this.cachedQuery(
      key,
      async () => {
        const masteries = await this.prisma.skillMastery.findMany({
          where: {
            studentId: { in: studentIds },
          },
          select: {
            studentId: true,
            skillId: true,
            masteryLevel: true,
            confidence: true,
          },
        });
        
        const result = new Map<string, any[]>();
        for (const mastery of masteries) {
          if (!result.has(mastery.studentId)) {
            result.set(mastery.studentId, []);
          }
          result.get(mastery.studentId)!.push(mastery);
        }
        return result;
      },
      60000 // 1 minute cache
    );
  }
}
