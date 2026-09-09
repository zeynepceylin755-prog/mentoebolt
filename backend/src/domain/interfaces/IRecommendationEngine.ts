// backend/src/domain/interfaces/IRecommendationEngine.ts
import { LearningSignal } from '../value-objects/LearningSignal.js';
import { SkillMastery } from '../value-objects/SkillMastery.js';

export interface Recommendation {
  id?: string;
  studentId: string;
  focusSkillId: string;
  focusSkillName: string;
  reason: string;
  estimatedTimeMinutes: number;
  priority: number; // 1-5
  actionType: 'practice' | 'review' | 'learn' | 'validate' | 'assess';
  expiresAt: Date;
  createdAt: Date;
}

export interface IRecommendationEngine {
  generateRecommendations(
    studentId: string,
    skillMasteries: SkillMastery[],
    signals: LearningSignal[]
  ): Promise<Recommendation[]>;
  
  updateRecommendation(
    recommendationId: string,
    studentId: string,
    status: 'accepted' | 'completed' | 'dismissed' | 'expired'
  ): Promise<void>;
}

