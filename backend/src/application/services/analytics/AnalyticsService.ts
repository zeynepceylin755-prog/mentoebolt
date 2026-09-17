import { PrismaClient } from '@prisma/client';
import { logger } from '../../../infrastructure/logging/logger.js';
import { isAnalyticsEligibleAttempt } from '../../../domain/questions/questionQuality.js';

export interface AnalyticsSummary {
  totalStudents: number;
  totalSessions: number;
  totalQuestions: number;
  averageAccuracy: number;
  averageMastery: number;
  topSkills: Array<{ skillId: string; averageMastery: number }>;
  weakSkills: Array<{ skillId: string; averageMastery: number }>;
  activityTrend: Array<{ date: string; sessions: number; attempts: number }>;
}

export class AnalyticsService {
  constructor(private readonly prisma: PrismaClient) {}

  async getStudentAnalytics(studentId: string): Promise<any> {
    // Phase 7.2: analytics must not be contaminated by fixture questions or by
    // unevaluable (NOT_EVALUABLE) attempts, which carry no correctness signal.
    const allAttempts = await this.prisma.questionAttempt.findMany({
      where: { studentId },
      include: { question: true },
    });
    const attempts = allAttempts.filter(isAnalyticsEligibleAttempt);

    const sessions = await this.prisma.learningSession.count({
      where: { studentId },
    });

    const masteries = await this.prisma.skillMastery.findMany({
      where: { studentId },
    });

    const totalQuestions = attempts.length;
    const correctQuestions = attempts.filter(a => a.isCorrect).length;
    const accuracy = totalQuestions > 0 ? (correctQuestions / totalQuestions) * 100 : 0;

    const errors = attempts.filter(a => !a.isCorrect);
    const errorTypes: Record<string, number> = {};
    for (const error of errors) {
      const type = error.errorType || 'OTHER';
      errorTypes[type] = (errorTypes[type] || 0) + 1;
    }

    const topErrorTypes = Object.entries(errorTypes)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([type, count]) => ({ type, count }));

    const skillMastery = masteries.map(m => ({
      skillId: m.skillId,
      masteryLevel: m.masteryLevel,
      confidence: m.confidence,
    }));

    const averageMastery = masteries.length > 0
      ? masteries.reduce((sum, m) => sum + m.masteryLevel, 0) / masteries.length
      : 0;

    const totalTimeMinutes = 0; // Calculate from sessions

    return {
      totalQuestions,
      correctQuestions,
      accuracy,
      totalSessions: sessions,
      totalTimeMinutes,
      averageMastery,
      skillMastery,
      topErrorTypes,
      errorCount: errors.length,
    };
  }

  async getSystemAnalytics(startDate?: Date, endDate?: Date): Promise<AnalyticsSummary> {
    const where: any = {};
    if (startDate && endDate) {
      where.createdAt = { gte: startDate, lte: endDate };
    }

    const students = await this.prisma.studentProfile.count();
    const sessions = await this.prisma.learningSession.count({ where });
    const allAttempts = await this.prisma.questionAttempt.findMany({
      where,
      include: { question: true },
    });
    // Phase 7.2: fixture-question attempts and unevaluable attempts are excluded
    // from system accuracy/mastery analytics — they are not real learning signals.
    const attempts = allAttempts.filter((a) => isAnalyticsEligibleAttempt(a));

    const totalQuestions = attempts.length;
    const correctQuestions = attempts.filter(a => a.isCorrect).length;
    const averageAccuracy = totalQuestions > 0 ? (correctQuestions / totalQuestions) * 100 : 0;

    const skillStats: Record<string, { total: number; count: number }> = {};
    for (const attempt of attempts) {
      const skillId = attempt.question.skillId;
      if (!skillStats[skillId]) {
        skillStats[skillId] = { total: 0, count: 0 };
      }
      skillStats[skillId].total += attempt.isCorrect ? 1 : 0;
      skillStats[skillId].count++;
    }

    const skillPerformance = Object.entries(skillStats).map(([skillId, stats]) => ({
      skillId,
      averageMastery: stats.count > 0 ? (stats.total / stats.count) * 100 : 0,
    }));

    const topSkills = skillPerformance
      .sort((a, b) => b.averageMastery - a.averageMastery)
      .slice(0, 5);

    const weakSkills = skillPerformance
      .sort((a, b) => a.averageMastery - b.averageMastery)
      .slice(0, 5);

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const recentAttemptsRaw = await this.prisma.questionAttempt.findMany({
      where: {
        createdAt: { gte: thirtyDaysAgo },
      },
      orderBy: { createdAt: 'asc' },
      include: { question: true },
    });
    const recentAttempts = recentAttemptsRaw.filter((a) => isAnalyticsEligibleAttempt(a));

    const dailyActivity: Record<string, { sessions: Set<string>; attempts: number }> = {};
    for (const attempt of recentAttempts) {
      const date = new Date(attempt.createdAt).toISOString().split('T')[0];
      if (!dailyActivity[date]) {
        dailyActivity[date] = { sessions: new Set(), attempts: 0 };
      }
      dailyActivity[date].attempts++;
      if (attempt.sessionId) {
        dailyActivity[date].sessions.add(attempt.sessionId);
      }
    }

    const activityTrend = Object.entries(dailyActivity).map(([date, stats]) => ({
      date,
      sessions: stats.sessions.size,
      attempts: stats.attempts,
    }));

    return {
      totalStudents: students,
      totalSessions: sessions,
      totalQuestions,
      averageAccuracy,
      averageMastery: skillPerformance.reduce((sum, s) => sum + s.averageMastery, 0) / (skillPerformance.length || 1),
      topSkills,
      weakSkills,
      activityTrend,
    };
  }

  async getStudentLearningTrends(studentId: string, days: number = 30): Promise<any> {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const allAttempts = await this.prisma.questionAttempt.findMany({
      where: {
        studentId,
        createdAt: { gte: startDate },
      },
      orderBy: { createdAt: 'asc' },
      include: { question: true },
    });
    // Phase 7.2: trends exclude fixture and unevaluable attempts.
    const attempts = allAttempts.filter((a) => isAnalyticsEligibleAttempt(a));

    const dailyStats: Record<string, { 
      correct: number; 
      total: number; 
      time: number;
      skills: Set<string>;
    }> = {};

    for (const attempt of attempts) {
      const date = new Date(attempt.createdAt).toISOString().split('T')[0];
      if (!dailyStats[date]) {
        dailyStats[date] = { correct: 0, total: 0, time: 0, skills: new Set() };
      }
      dailyStats[date].total++;
      if (attempt.isCorrect) dailyStats[date].correct++;
      dailyStats[date].time += attempt.timeSpentSeconds;
      dailyStats[date].skills.add(attempt.question.skillId);
    }

    const result = [];
    for (const [date, stats] of Object.entries(dailyStats)) {
      result.push({
        date,
        accuracy: stats.total > 0 ? (stats.correct / stats.total) * 100 : 0,
        attempts: stats.total,
        correct: stats.correct,
        timeMinutes: Math.round(stats.time / 60),
        skills: Array.from(stats.skills),
      });
    }

    return result;
  }
}
