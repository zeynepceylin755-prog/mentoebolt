export interface QuestionSelectionCriteria {
  skillIds?: string[];
  topicIds?: string[];
  difficultyRange?: { min: number; max: number };
  excludeQuestionIds?: string[];
  limit: number;
}

export interface SelectedQuestion {
  questionId: string;
  skillId: string;
  difficulty: number;
  order: number;
}

export class QuestionSelector {
  selectQuestions(
    availableQuestions: Array<{
      id: string;
      skillId: string;
      difficulty: number;
      topicId?: string;
      learningObjectiveId?: string;
    }>,
    criteria: QuestionSelectionCriteria
  ): SelectedQuestion[] {
    let filtered = [...availableQuestions];

    if (criteria.skillIds && criteria.skillIds.length > 0) {
      filtered = filtered.filter(q => criteria.skillIds!.includes(q.skillId));
    }

    if (criteria.topicIds && criteria.topicIds.length > 0) {
      filtered = filtered.filter(q => q.topicId && criteria.topicIds!.includes(q.topicId));
    }

    if (criteria.difficultyRange) {
      filtered = filtered.filter(q => 
        q.difficulty >= criteria.difficultyRange!.min &&
        q.difficulty <= criteria.difficultyRange!.max
      );
    }

    if (criteria.excludeQuestionIds && criteria.excludeQuestionIds.length > 0) {
      filtered = filtered.filter(q => !criteria.excludeQuestionIds!.includes(q.id));
    }

    const shuffled = this.shuffle(filtered);
    const selected = shuffled.slice(0, criteria.limit);

    return selected.map((q, index) => ({
      questionId: q.id,
      skillId: q.skillId,
      difficulty: q.difficulty,
      order: index + 1,
    }));
  }

  selectDiagnosticQuestions(
    availableQuestions: Array<{
      id: string;
      skillId: string;
      difficulty: number;
      topicId?: string;
      learningObjectiveId?: string;
    }>,
    skillIds: string[],
    maxQuestions: number = 20
  ): SelectedQuestion[] {
    const questionsPerSkill = Math.max(2, Math.floor(maxQuestions / skillIds.length));
    
    const criteria: QuestionSelectionCriteria = {
      skillIds,
      limit: maxQuestions,
      difficultyRange: { min: 1, max: 5 },
    };

    let selected: SelectedQuestion[] = [];
    const remainingQuestions = [...availableQuestions];

    for (const skillId of skillIds) {
      const skillQuestions = remainingQuestions.filter(q => q.skillId === skillId);
      const shuffled = this.shuffle(skillQuestions);
      const count = Math.min(questionsPerSkill, skillQuestions.length);
      
      for (let i = 0; i < count && selected.length < maxQuestions; i++) {
        const q = shuffled[i];
        selected.push({
          questionId: q.id,
          skillId: q.skillId,
          difficulty: q.difficulty,
          order: selected.length + 1,
        });
      }
    }

    if (selected.length < maxQuestions) {
      const usedIds = new Set(selected.map(s => s.questionId));
      const remaining = availableQuestions.filter(q => !usedIds.has(q.id));
      const shuffledRemaining = this.shuffle(remaining);
      
      for (const q of shuffledRemaining) {
        if (selected.length >= maxQuestions) break;
        selected.push({
          questionId: q.id,
          skillId: q.skillId,
          difficulty: q.difficulty,
          order: selected.length + 1,
        });
      }
    }

    return selected;
  }

  private shuffle<T>(array: T[]): T[] {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  }
}
