import { PrismaClient } from '@prisma/client';

export class ProgressService {
  constructor(private readonly prisma: PrismaClient) {}

  async getStudentProgress(studentId: string): Promise<any> {
    const attempts = await this.prisma.questionAttempt.findMany({
      where: { studentId },
      take: 100,
    });

    const sessions = await this.prisma.learningSession.findMany({
      where: { studentId },
      take: 50,
    });

    const masteries = await this.prisma.skillMastery.findMany({
      where: { studentId },
    });

    return {
      totalAttempts: attempts.length,
      totalSessions: sessions.length,
      masteries,
      recentAttempts: attempts.slice(0, 10),
    };
  }
}
