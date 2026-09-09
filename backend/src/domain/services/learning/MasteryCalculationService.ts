export interface MasteryParams {
  currentLevel: number;
  currentConfidence: number;
  isCorrect: boolean;
  difficulty: number;
  timeSpent: number;
  attemptsCount: number;
  correctAttempts: number;
  evidenceCount: number;
  recencyDays: number;
}

export interface MasteryResult {
  newLevel: number;
  newConfidence: number;
  trend: 'UP' | 'DOWN' | 'STABLE';
  delta: number;
  evidenceCount: number;
}

export class MasteryCalculationService {
  calculate(params: MasteryParams): MasteryResult {
    const { 
      currentLevel, 
      currentConfidence, 
      isCorrect, 
      difficulty,
      timeSpent,
      attemptsCount,
      correctAttempts,
      evidenceCount,
      recencyDays
    } = params;

    const baseAdjustment = 2.5;
    const confidenceMultiplier = Math.max(0.3, 1 - currentConfidence * 0.5);
    const difficultyMultiplier = 0.5 + (difficulty / 10) * 0.5;
    const recencyMultiplier = Math.max(0.5, 1 - (recencyDays / 30) * 0.5);
    const evidenceMultiplier = Math.min(1, 0.5 + (evidenceCount / 20) * 0.5);

    let adjustment = baseAdjustment * confidenceMultiplier * difficultyMultiplier * recencyMultiplier * evidenceMultiplier;

    if (!isCorrect) {
      adjustment = -adjustment;
      const expectedTime = difficulty * 15;
      if (timeSpent < expectedTime * 0.5) {
        adjustment *= 1.3;
      }
    } else {
      const expectedTime = difficulty * 15;
      if (timeSpent > expectedTime * 0.7 && timeSpent < expectedTime * 1.5) {
        adjustment *= 1.2;
      }
    }

    let newLevel = currentLevel + adjustment;
    newLevel = Math.max(0, Math.min(100, newLevel));

    const confidenceDelta = Math.abs(adjustment) / 20;
    let newConfidence = currentConfidence;
    
    if (isCorrect) {
      newConfidence = Math.min(1, currentConfidence + confidenceDelta * 0.2);
    } else {
      newConfidence = Math.max(0.1, currentConfidence - confidenceDelta * 0.3);
    }

    let trend: 'UP' | 'DOWN' | 'STABLE' = 'STABLE';
    if (adjustment > 1) trend = 'UP';
    else if (adjustment < -1) trend = 'DOWN';

    const delta = newLevel - currentLevel;
    const newEvidenceCount = evidenceCount + 1;

    return {
      newLevel,
      newConfidence,
      trend,
      delta,
      evidenceCount: newEvidenceCount,
    };
  }
}
