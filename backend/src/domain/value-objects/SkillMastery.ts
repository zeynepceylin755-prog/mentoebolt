// backend/src/domain/value-objects/SkillMastery.ts
export class SkillMastery {
  constructor(
    public readonly skillId: string,
    public readonly masteryLevel: number, // 0-100
    public readonly confidence: number, // 0-1
    public readonly attempts: number,
    public readonly correctAttempts: number,
    public readonly lastAttemptAt: Date,
    public readonly trend?: 'up' | 'down' | 'stable'
  ) {
    if (masteryLevel < 0 || masteryLevel > 100) {
      throw new Error('Mastery level must be between 0 and 100');
    }
    if (confidence < 0 || confidence > 1) {
      throw new Error('Confidence must be between 0 and 1');
    }
  }
  
  get isMastered(): boolean {
    return this.masteryLevel >= 80 && this.confidence >= 0.7;
  }
  
  get isDeveloping(): boolean {
    return this.masteryLevel >= 40 && this.masteryLevel < 80;
  }
  
  get isWeak(): boolean {
    return this.masteryLevel < 40;
  }
}

