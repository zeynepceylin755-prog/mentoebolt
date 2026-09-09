// backend/src/domain/interfaces/IErrorAnalyzer.ts
export interface ErrorAnalysisResult {
  errorType: 'concept' | 'skill' | 'prerequisite' | 'operation' | 'reading' | 'calculation' | 'other';
  confidence: number;
  hypothesis: string;
  relatedSkills: string[];
  suggestedValidationQuestion?: string;
}

export interface IErrorAnalyzer {
  analyzeError(
    question: string,
    studentAnswer: string,
    correctAnswer: string,
    skillId: string,
    previousAttempts?: any[]
  ): Promise<ErrorAnalysisResult>;
  
  detectErrorPatterns(
    studentId: string,
    recentAttempts: any[]
  ): Promise<{
    pattern: string;
    frequency: number;
    confidence: number;
  }[]>;
}
