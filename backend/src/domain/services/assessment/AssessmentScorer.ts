export interface ScoringResult {
  score: number;
  maxScore: number;
  percentageScore: number;
  results: Array<{
    questionId: string;
    skillId: string;
    points: number;
    maxPoints: number;
    isCorrect: boolean;
  }>;
}

export interface ScoringConfig {
  equalWeighting: boolean;
  skillWeights?: Record<string, number>;
}

export class AssessmentScorer {
  score(
    answers: Array<{
      questionId: string;
      answer: string;
      correctAnswer: string;
      skillId: string;
      points: number;
      maxPoints: number;
      isCorrect: boolean;
    }>,
    config: ScoringConfig = { equalWeighting: true }
  ): ScoringResult {
    const results = answers.map(a => ({
      questionId: a.questionId,
      skillId: a.skillId,
      points: a.isCorrect ? a.points : 0,
      maxPoints: a.maxPoints,
      isCorrect: a.isCorrect,
    }));

    const totalScore = results.reduce((sum, r) => sum + r.points, 0);
    const totalMaxScore = results.reduce((sum, r) => sum + r.maxPoints, 0);

    return {
      score: totalScore,
      maxScore: totalMaxScore,
      percentageScore: totalMaxScore > 0 ? (totalScore / totalMaxScore) * 100 : 0,
      results,
    };
  }
}
