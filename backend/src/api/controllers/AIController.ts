import { Request, Response, NextFunction } from 'express';
import { AIErrorAnalysisService } from '../../application/services/ai/AIErrorAnalysisService.js';
import { AIRecommendationService } from '../../application/services/ai/AIRecommendationService.js';
import { AIExplanationService } from '../../application/services/ai/AIExplanationService.js';
import { AuthRequest } from '../middleware/auth.js';
import { logger } from '../../infrastructure/logging/logger.js';

export class AIController {
  constructor(
    private readonly errorAnalysisService: AIErrorAnalysisService,
    private readonly recommendationService: AIRecommendationService,
    private readonly explanationService: AIExplanationService
  ) {}

  analyzeError = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { 
        question, 
        studentAnswer, 
        correctAnswer, 
        skillId, 
        difficulty, 
        timeSpentSeconds,
        previousAttempts 
      } = req.body;

      const result = await this.errorAnalysisService.analyzeError({
        question,
        studentAnswer,
        correctAnswer,
        skillId,
        difficulty,
        timeSpentSeconds,
        previousAttempts: previousAttempts || [],
      });

      res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  };

  generateRecommendation = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { 
        studentId,
        currentMastery,
        weakSkills,
        strongSkills,
        recentAttempts,
        learningStage
      } = req.body;

      const result = await this.recommendationService.generateRecommendation({
        studentId,
        currentMastery: currentMastery || [],
        weakSkills: weakSkills || [],
        strongSkills: strongSkills || [],
        recentAttempts: recentAttempts || [],
        learningStage: learningStage || 'discovery',
      });

      res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  };

  generateExplanation = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const {
        concept,
        question,
        studentAnswer,
        correctAnswer,
        skillId,
        difficulty,
        previousAttempts,
        level
      } = req.body;

      const result = await this.explanationService.generateExplanation({
        concept,
        question,
        studentAnswer,
        correctAnswer,
        skillId,
        difficulty,
        previousAttempts: previousAttempts || 0,
        level: level || 'intermediate',
      });

      res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  };
}
