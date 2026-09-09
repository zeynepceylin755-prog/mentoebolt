import { PrismaClient } from '@prisma/client';

export class ProgressService {
  constructor(private readonly prisma: PrismaClient) {}

  async getStudentProgress(studentId: string, skillId?: string): Promise<any> {
    const where: any = { studentId };
    if (skillId) {
      where.skillId = skillId;
    }

    return this.prisma.learningProgress.findMany({
      where,
      orderBy: { date: 'asc' },
    });
  }

  async getStudentProgressSummary(studentId: string): Promise<any> {
    const skills = await this.prisma.skillMastery.findMany({
      where: { studentId },
    });

    const totalSkills = skills.length;
    const mastered = skills.filter(s => s.masteryLevel >= 80 && s.confidence >= 0.7);
    const developing = skills.filter(s => s.masteryLevel >= 40 && s.masteryLevel < 80);
    const weak = skills.filter(s => s.masteryLevel < 40);

    return {
      totalSkills,
      masteredCount: mastered.length,
      developingCount: developing.length,
      weakCount: weak.length,
      averageMastery: skills.reduce((sum, s) => sum + s.masteryLevel, 0) / (skills.length || 1),
    };
  }
}
