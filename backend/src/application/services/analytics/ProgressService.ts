import { PrismaClient } from '@prisma/client';
import { logger } from '../../../infrastructure/logging/logger.js';

export interface ProgressSummary {
  totalSessions: number;
  totalQuestions: number;
  correctQuestions: number;
  accuracy: number;
  totalTimeMinutes: number;
  skillsMastered: number;
  skillsDeveloping: number;
  skillsWeak: number;
  learningStreak: number;
  consistency: number;
  lastActivity: Date | null;
}

export interface SkillProgress {
  skillId: string;
  /**
   * Phase 7.4 — the student-facing curriculum label for this skill.
   *
   * Resolved from the row's authoritative MicroSkill relation. It is `null` when
   * no MicroSkill can be resolved (no `microSkillId`, the row is inactive, or the
   * microSkill was deleted), and the UI must then say "henüz etiketlenmedi"
   * rather than print an internal identifier.
   *
   * It is deliberately NOT seeded with `skillId`: the previous behaviour made the
   * browser render raw ids such as `ms-1` as if they were curriculum names.
   */
  skillName: string | null;
  masteryLevel: number;
  confidence: number;
  attempts: number;
  correctAttempts: number;
  accuracy: number;
  trend: 'UP' | 'DOWN' | 'STABLE';
  lastAttemptAt: Date | null;
}

export interface TimeRange {
  startDate: Date;
  endDate: Date;
}

export class ProgressService {
  constructor(private readonly prisma: PrismaClient) {}

  async getStudentProgress(studentId: string): Promise<ProgressSummary> {
    // Get all question attempts
    const attempts = await this.prisma.questionAttempt.findMany({
      where: { studentId },
      orderBy: { createdAt: 'asc' },
    });

    // Get all sessions
    const sessions = await this.prisma.learningSession.findMany({
      where: { studentId },
    });

    // Get skill mastery
    const masteries = await this.prisma.skillMastery.findMany({
      where: { studentId },
    });

    const totalQuestions = attempts.length;
    const correctQuestions = attempts.filter(a => a.isCorrect).length;
    const accuracy = totalQuestions > 0 ? (correctQuestions / totalQuestions) * 100 : 0;

    const totalTimeMinutes = sessions.reduce((sum, s) => {
      const duration = s.durationSeconds || 0;
      return sum + duration;
    }, 0) / 60;

    const skillsMastered = masteries.filter(s => s.masteryLevel >= 80 && s.confidence >= 0.7).length;
    const skillsDeveloping = masteries.filter(s => s.masteryLevel >= 40 && s.masteryLevel < 80).length;
    const skillsWeak = masteries.filter(s => s.masteryLevel < 40).length;

    const learningStreak = await this.calculateLearningStreak(studentId);
    const consistency = await this.calculateConsistency(studentId);
    const lastActivity = attempts.length > 0 ? attempts[attempts.length - 1].createdAt : null;

    return {
      totalSessions: sessions.length,
      totalQuestions,
      correctQuestions,
      accuracy,
      totalTimeMinutes,
      skillsMastered,
      skillsDeveloping,
      skillsWeak,
      learningStreak,
      consistency,
      lastActivity,
    };
  }

  async getSkillProgress(studentId: string, skillId: string): Promise<SkillProgress | null> {
    const mastery = await this.prisma.skillMastery.findUnique({
      where: {
        studentId_skillId: {
          studentId,
          skillId,
        },
      },
      include: { microSkill: true },
    });

    if (!mastery) return null;

    return this.toSkillProgress(mastery);
  }

  async getAllSkillProgress(studentId: string): Promise<SkillProgress[]> {
    // The microSkill relation is included so every row can carry a real
    // curriculum label instead of an internal id (Phase 7.4).
    const masteries = await this.prisma.skillMastery.findMany({
      where: { studentId },
      include: { microSkill: true },
    });

    return masteries.map((mastery) => this.toSkillProgress(mastery));
  }

  /**
   * Map a persisted mastery row onto the student-facing progress shape.
   *
   * Single source of truth for the projection so `getSkillProgress` and
   * `getAllSkillProgress` can never disagree about a field.
   */
  private toSkillProgress(mastery: {
    skillId: string;
    masteryLevel: number;
    confidence: number;
    attempts: number;
    correctAttempts: number;
    trend: string | null;
    lastAttemptAt: Date | null;
    microSkill?: { name: string; isActive: boolean } | null;
  }): SkillProgress {
    const accuracy =
      mastery.attempts > 0 ? (mastery.correctAttempts / mastery.attempts) * 100 : 0;

    // An inactive microSkill is treated as unresolved: a retired curriculum node
    // must not be presented to a student as their current topic.
    const microSkill = mastery.microSkill;
    const resolvedName =
      microSkill && microSkill.isActive && microSkill.name.trim().length > 0
        ? microSkill.name.trim()
        : null;

    return {
      skillId: mastery.skillId,
      skillName: resolvedName,
      masteryLevel: mastery.masteryLevel,
      confidence: mastery.confidence,
      attempts: mastery.attempts,
      correctAttempts: mastery.correctAttempts,
      accuracy,
      trend: (mastery.trend as 'UP' | 'DOWN' | 'STABLE') || 'STABLE',
      lastAttemptAt: mastery.lastAttemptAt,
    };
  }

  async getTimeSeriesProgress(
    studentId: string,
    timeRange: TimeRange
  ): Promise<Array<{ date: string; accuracy: number; attempts: number; mastery: number }>> {
    const attempts = await this.prisma.questionAttempt.findMany({
      where: {
        studentId,
        createdAt: {
          gte: timeRange.startDate,
          lte: timeRange.endDate,
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    const progress = await this.prisma.learningProgress.findMany({
      where: {
        studentId,
        date: {
          gte: timeRange.startDate,
          lte: timeRange.endDate,
        },
      },
      orderBy: { date: 'asc' },
    });

    // Group by date
    const dailyStats: Record<string, { correct: number; total: number; masterySum: number; masteryCount: number }> = {};

    for (const attempt of attempts) {
      const date = new Date(attempt.createdAt).toISOString().split('T')[0];
      if (!dailyStats[date]) {
        dailyStats[date] = { correct: 0, total: 0, masterySum: 0, masteryCount: 0 };
      }
      dailyStats[date].total++;
      if (attempt.isCorrect) dailyStats[date].correct++;
    }

    for (const p of progress) {
      const date = new Date(p.date).toISOString().split('T')[0];
      if (dailyStats[date]) {
        dailyStats[date].masterySum += p.masteryLevel;
        dailyStats[date].masteryCount++;
      }
    }

    const result = [];
    for (const [date, stats] of Object.entries(dailyStats)) {
      const accuracy = stats.total > 0 ? (stats.correct / stats.total) * 100 : 0;
      const mastery = stats.masteryCount > 0 ? stats.masterySum / stats.masteryCount : 0;

      result.push({
        date,
        accuracy,
        attempts: stats.total,
        mastery,
      });
    }

    return result.sort((a, b) => a.date.localeCompare(b.date));
  }

  async getWeeklyProgress(studentId: string): Promise<any> {
    const endDate = new Date();
    const startDate = new Date(endDate);
    startDate.setDate(startDate.getDate() - 7);

    const progress = await this.getTimeSeriesProgress(studentId, { startDate, endDate });

    return {
      startDate,
      endDate,
      progress,
    };
  }

  async getMonthlyProgress(studentId: string): Promise<any> {
    const endDate = new Date();
    const startDate = new Date(endDate);
    startDate.setDate(startDate.getDate() - 30);

    const progress = await this.getTimeSeriesProgress(studentId, { startDate, endDate });

    return {
      startDate,
      endDate,
      progress,
    };
  }

  private async calculateLearningStreak(studentId: string): Promise<number> {
    const attempts = await this.prisma.questionAttempt.findMany({
      where: { studentId },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });

    if (attempts.length === 0) return 0;

    let streak = 1;
    let currentDate = new Date(attempts[0].createdAt);
    currentDate.setHours(0, 0, 0, 0);

    for (let i = 1; i < attempts.length; i++) {
      const attemptDate = new Date(attempts[i].createdAt);
      attemptDate.setHours(0, 0, 0, 0);

      const diffDays = Math.floor((currentDate.getTime() - attemptDate.getTime()) / (1000 * 60 * 60 * 24));

      if (diffDays === 1) {
        streak++;
        currentDate = attemptDate;
      } else if (diffDays > 1) {
        break;
      }
    }

    return streak;
  }

  private async calculateConsistency(studentId: string): Promise<number> {
    const attempts = await this.prisma.questionAttempt.findMany({
      where: { studentId },
      orderBy: { createdAt: 'asc' },
      select: { createdAt: true },
    });

    if (attempts.length < 3) return 0;

    // Calculate average time between attempts
    let totalGap = 0;
    let gaps = 0;

    for (let i = 1; i < attempts.length; i++) {
      const gap = (new Date(attempts[i].createdAt).getTime() - new Date(attempts[i-1].createdAt).getTime()) / (1000 * 60 * 60 * 24);
      if (gap < 7) { // Only count gaps up to 7 days
        totalGap += gap;
        gaps++;
      }
    }

    if (gaps === 0) return 0;

    const avgGap = totalGap / gaps;
    // Score: 1 day gap = 1.0, 7 day gap = 0.0
    const consistency = Math.max(0, 1 - (avgGap / 7));

    return Math.round(consistency * 100);
  }
}
