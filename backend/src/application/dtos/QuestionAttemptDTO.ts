// backend/src/application/dtos/QuestionAttemptDTO.ts
export interface QuestionAttemptDTO {
  questionId: string;
  answer: string;
  timeSpentSeconds: number;
  sessionId?: string;
}

export interface QuestionAttemptResponseDTO {
  id: string;
  questionId: string;
  isCorrect: boolean;
  correctAnswer: string;
  errorType?: string;
  feedback?: string;
  explanation?: string;
  createdAt: Date;
}

// backend/src/application/dtos/RecommendationDTO.ts
export interface RecommendationDTO {
  id: string;
  studentId: string;
  focusSkillId: string;
  focusSkillName: string;
  reason: string;
  estimatedTimeMinutes: number;
  priority: number;
  actionType: 'practice' | 'review' | 'learn' | 'validate' | 'assess';
  createdAt: Date;
  expiresAt: Date;
}
