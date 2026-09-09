export interface DiagnosticAnalysis {
  overallScore: number;
  overallConfidence: number;
  skillResults: Array<{
    skillId: string;
    score: number;
    confidence: number;
    masteryLevel: number;
    status: 'WEAK' | 'DEVELOPING' | 'STRONG' | 'MASTERED';
    attempts: number;
    correctAttempts: number;
  }>;
  topicResults: Array<{
    topicId: string;
    score: number;
    confidence: number;
    masteryLevel: number;
    status: 'WEAK' | 'DEVELOPING' | 'STRONG' | 'MASTERED';
  }>;
  recommendations: string[];
  summary: string;
}

export class DiagnosticAnalyzer {
  analyze(
    attempts: Array<{
      questionId: string;
      skillId: string;
      topicId?: string;
      isCorrect: boolean;
      difficulty: number;
      timeSpentSeconds: number;
    }>,
    skills: Array<{ id: string; name: string }>,
    topics: Array<{ id: string; name: string }>
  ): DiagnosticAnalysis {
    const skillResults = this.analyzeBySkill(attempts, skills);
    const topicResults = this.analyzeByTopic(attempts, topics);

    const overallScore = attempts.length > 0 
      ? (attempts.filter(a => a.isCorrect).length / attempts.length) * 100 
      : 0;

    const overallConfidence = this.calculateOverallConfidence(attempts);
    const recommendations = this.generateRecommendations(skillResults);
    const summary = this.generateSummary(skillResults, topicResults, overallScore);

    return {
      overallScore,
      overallConfidence,
      skillResults,
      topicResults,
      recommendations,
      summary,
    };
  }

  private analyzeBySkill(
    attempts: Array<{
      questionId: string;
      skillId: string;
      isCorrect: boolean;
      difficulty: number;
      timeSpentSeconds: number;
    }>,
    skills: Array<{ id: string; name: string }>
  ): DiagnosticAnalysis['skillResults'] {
    const skillMap: Record<string, { correct: number; total: number; attempts: any[] }> = {};

    for (const attempt of attempts) {
      if (!skillMap[attempt.skillId]) {
        skillMap[attempt.skillId] = { correct: 0, total: 0, attempts: [] };
      }
      skillMap[attempt.skillId].total++;
      if (attempt.isCorrect) skillMap[attempt.skillId].correct++;
      skillMap[attempt.skillId].attempts.push(attempt);
    }

    const results: DiagnosticAnalysis['skillResults'] = [];

    for (const skill of skills) {
      const data = skillMap[skill.id];
      if (!data) {
        results.push({
          skillId: skill.id,
          score: 0,
          confidence: 0,
          masteryLevel: 0,
          status: 'WEAK',
          attempts: 0,
          correctAttempts: 0,
        });
        continue;
      }

      const score = data.total > 0 ? (data.correct / data.total) * 100 : 0;
      const confidence = 0.5;
      const masteryLevel = score;
      const status = this.determineStatus(score);

      results.push({
        skillId: skill.id,
        score,
        confidence,
        masteryLevel,
        status,
        attempts: data.total,
        correctAttempts: data.correct,
      });
    }

    return results;
  }

  private analyzeByTopic(
    attempts: Array<{
      questionId: string;
      skillId: string;
      topicId?: string;
      isCorrect: boolean;
      difficulty: number;
      timeSpentSeconds: number;
    }>,
    topics: Array<{ id: string; name: string }>
  ): DiagnosticAnalysis['topicResults'] {
    const topicMap: Record<string, { correct: number; total: number }> = {};

    for (const attempt of attempts) {
      if (!attempt.topicId) continue;
      if (!topicMap[attempt.topicId]) {
        topicMap[attempt.topicId] = { correct: 0, total: 0 };
      }
      topicMap[attempt.topicId].total++;
      if (attempt.isCorrect) topicMap[attempt.topicId].correct++;
    }

    const results: DiagnosticAnalysis['topicResults'] = [];

    for (const topic of topics) {
      const data = topicMap[topic.id];
      if (!data) {
        results.push({
          topicId: topic.id,
          score: 0,
          confidence: 0,
          masteryLevel: 0,
          status: 'WEAK',
        });
        continue;
      }

      const score = data.total > 0 ? (data.correct / data.total) * 100 : 0;
      const masteryLevel = score;
      const status = this.determineStatus(score);

      results.push({
        topicId: topic.id,
        score,
        confidence: 0.5,
        masteryLevel,
        status,
      });
    }

    return results;
  }

  private determineStatus(score: number): 'WEAK' | 'DEVELOPING' | 'STRONG' | 'MASTERED' {
    if (score < 40) return 'WEAK';
    if (score < 60) return 'DEVELOPING';
    if (score < 80) return 'STRONG';
    return 'MASTERED';
  }

  private calculateOverallConfidence(attempts: any[]): number {
    if (attempts.length < 3) return 0.3;
    if (attempts.length < 6) return 0.5;
    if (attempts.length < 10) return 0.7;
    return 0.8;
  }

  private generateRecommendations(skillResults: any[]): string[] {
    const recommendations: string[] = [];
    const weakSkills = skillResults.filter(s => s.status === 'WEAK');
    const developingSkills = skillResults.filter(s => s.status === 'DEVELOPING');

    if (weakSkills.length > 0) {
      const skillNames = weakSkills.map(s => s.skillId).join(', ');
      recommendations.push(`Focus on strengthening weak skills: ${skillNames}`);
    }

    if (developingSkills.length > 0) {
      const skillNames = developingSkills.map(s => s.skillId).join(', ');
      recommendations.push(`Continue developing: ${skillNames}`);
    }

    if (weakSkills.length === 0 && developingSkills.length === 0) {
      recommendations.push('Great job! Continue with practice to maintain your skills.');
    }

    return recommendations;
  }

  private generateSummary(
    skillResults: any[],
    topicResults: any[],
    overallScore: number
  ): string {
    const weakCount = skillResults.filter(s => s.status === 'WEAK').length;
    const developingCount = skillResults.filter(s => s.status === 'DEVELOPING').length;
    const strongCount = skillResults.filter(s => s.status === 'STRONG').length;
    const masteredCount = skillResults.filter(s => s.status === 'MASTERED').length;

    let summary = `Overall Score: ${Math.round(overallScore)}%. `;
    summary += `Mastered: ${masteredCount}, Strong: ${strongCount}, `;
    summary += `Developing: ${developingCount}, Weak: ${weakCount}. `;

    if (weakCount > 0) {
      summary += `Focus on improving weak areas first.`;
    } else if (developingCount > 0) {
      summary += `Continue practicing to strengthen developing skills.`;
    } else {
      summary += `Excellent progress! Keep up the good work.`;
    }

    return summary;
  }
}
