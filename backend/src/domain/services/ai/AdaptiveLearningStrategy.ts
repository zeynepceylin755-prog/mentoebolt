export interface StudentState {
  masteryLevels: Map<string, number>;
  confidenceLevels: Map<string, number>;
  recentPerformance: Array<{
    skillId: string;
    isCorrect: boolean;
    difficulty: number;
    timestamp: Date;
  }>;
  weakSkills: string[];
  strongSkills: string[];
  learningStage: 'discovery' | 'practice' | 'mastery' | 'review' | 'assessment';
  lastActivityDays: number;
  totalAttempts: number;
  errorPatterns: Map<string, number>;
}

export interface LearningAction {
  type: 'PRACTICE' | 'REVIEW' | 'LEARN' | 'VALIDATE' | 'ASSESS' | 'SPACED_REPETITION';
  skillId: string;
  difficulty: number;
  priority: number;
  reason: string;
  estimatedDuration: number;
}

export interface StrategyResult {
  action: LearningAction;
  confidence: number;
  evidence: string[];
}

export class AdaptiveLearningStrategy {
  selectNextAction(state: StudentState): StrategyResult {
    const actions: Array<{ action: LearningAction; score: number; evidence: string[] }> = [];

    // 1. Check for skills due for review (spaced repetition)
    const dueSkills = this.getDueForReview(state);
    for (const skillId of dueSkills) {
      actions.push({
        action: {
          type: 'SPACED_REPETITION',
          skillId,
          difficulty: this.getSkillDifficulty(state, skillId),
          priority: 5,
          reason: 'Due for spaced repetition review',
          estimatedDuration: 10,
        },
        score: this.calculateReviewScore(state, skillId),
        evidence: [`Skill ${skillId} is due for review`, 'Spaced repetition schedule suggests review'],
      });
    }

    // 2. Check for weak skills
    for (const skillId of state.weakSkills) {
      const mastery = state.masteryLevels.get(skillId) || 0;
      actions.push({
        action: {
          type: 'PRACTICE',
          skillId,
          difficulty: this.getSkillDifficulty(state, skillId),
          priority: 4,
          reason: `Weak skill (mastery: ${Math.round(mastery)}%) needs practice`,
          estimatedDuration: 15,
        },
        score: this.calculatePracticeScore(state, skillId),
        evidence: [`Skill ${skillId} is below mastery threshold (${Math.round(mastery)}%)`],
      });
    }

    // 3. Check for developing skills
    const developingSkills = this.getDevelopingSkills(state);
    for (const skillId of developingSkills) {
      const mastery = state.masteryLevels.get(skillId) || 0;
      actions.push({
        action: {
          type: 'PRACTICE',
          skillId,
          difficulty: this.getSkillDifficulty(state, skillId),
          priority: 3,
          reason: `Developing skill (mastery: ${Math.round(mastery)}%) needs reinforcement`,
          estimatedDuration: 10,
        },
        score: this.calculatePracticeScore(state, skillId) * 0.8,
        evidence: [`Skill ${skillId} is developing but not yet mastered`],
      });
    }

    // 4. Check if assessment is needed
    if (this.needsAssessment(state)) {
      const assessmentSkills = this.getAssessmentTargets(state);
      for (const skillId of assessmentSkills) {
        actions.push({
          action: {
            type: 'ASSESS',
            skillId,
            difficulty: this.getSkillDifficulty(state, skillId),
            priority: 2,
            reason: 'Assessment needed to gauge progress',
            estimatedDuration: 20,
          },
          score: 0.6,
          evidence: ['Assessment needed to update mastery estimates'],
        });
      }
    }

    // 5. If no specific action, suggest review of strongest skill
    if (actions.length === 0) {
      const strongestSkill = state.strongSkills[0] || 'general';
      actions.push({
        action: {
          type: 'REVIEW',
          skillId: strongestSkill,
          difficulty: 3,
          priority: 1,
          reason: 'Maintain strong skills',
          estimatedDuration: 5,
        },
        score: 0.3,
        evidence: ['No specific skill needs attention', 'Reviewing strong skills maintains mastery'],
      });
    }

    // Select the best action
    const bestAction = actions.reduce((best, current) => 
      current.score > best.score ? current : best
    );

    return {
      action: bestAction.action,
      confidence: bestAction.score / 5,
      evidence: bestAction.evidence,
    };
  }

  private getDueForReview(state: StudentState): string[] {
    // In a real implementation, this would check nextReviewAt dates
    return [];
  }

  private getSkillDifficulty(state: StudentState, skillId: string): number {
    // Base difficulty on mastery level - lower mastery = lower difficulty
    const mastery = state.masteryLevels.get(skillId) || 0;
    if (mastery < 30) return 1;
    if (mastery < 50) return 2;
    if (mastery < 70) return 3;
    if (mastery < 85) return 4;
    return 5;
  }

  private calculateReviewScore(state: StudentState, skillId: string): number {
    const mastery = state.masteryLevels.get(skillId) || 0;
    const confidence = state.confidenceLevels.get(skillId) || 0;
    return 3 + (1 - mastery / 100) + confidence * 2;
  }

  private calculatePracticeScore(state: StudentState, skillId: string): number {
    const mastery = state.masteryLevels.get(skillId) || 0;
    const recentPerformance = state.recentPerformance
      .filter(p => p.skillId === skillId)
      .slice(-5);
    
    const correctRate = recentPerformance.length > 0
      ? recentPerformance.filter(p => p.isCorrect).length / recentPerformance.length
      : 0.5;

    // Urgency factor: lower mastery = higher urgency
    const urgency = 1 - (mastery / 100);
    
    // Performance factor: poor recent performance = higher urgency
    const performanceFactor = 1 - correctRate;
    
    return 3 + urgency * 2 + performanceFactor * 1;
  }

  private getDevelopingSkills(state: StudentState): string[] {
    const result: string[] = [];
    for (const [skillId, mastery] of state.masteryLevels) {
      if (mastery >= 40 && mastery < 70) {
        result.push(skillId);
      }
    }
    return result;
  }

  private needsAssessment(state: StudentState): boolean {
    // Check if we have enough data to be confident
    return state.totalAttempts > 10 && state.weakSkills.length === 0;
  }

  private getAssessmentTargets(state: StudentState): string[] {
    // Return skills that need assessment
    const targets: string[] = [];
    for (const [skillId, mastery] of state.masteryLevels) {
      if (mastery >= 50 && mastery < 80) {
        targets.push(skillId);
      }
    }
    return targets.slice(0, 3);
  }
}
