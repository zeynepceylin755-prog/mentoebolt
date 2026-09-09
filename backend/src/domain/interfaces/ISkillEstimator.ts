
// backend/src/domain/interfaces/ISkillEstimator.ts
export interface MasteryEstimate {
  skillId: string;
  masteryLevel: number;
  confidence: number;
  trend: 'up' | 'down' | 'stable';
  nextAssessment?: Date;
}

export interface ISkillEstimator {
  estimateMastery(
    studentId: string,
    skillId: string,
    attempts: any[]
  ): Promise<MasteryEstimate>;
  
  estimateAllSkills(
    studentId: string
  ): Promise<MasteryEstimate[]>;
  
  updateSkillMastery(
    studentId: string,
    skillId: string,
    attemptResult: boolean,
    timeSpent: number
  ): Promise<MasteryEstimate>;
}
