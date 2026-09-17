/**
 * Phase 6.6 Integration Tests
 *
 * These tests verify the real student dashboard functionality:
 * - Authentication flow
 * - API client integration
 * - Data consistency
 * - NOT_EVALUABLE handling
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { apiRequest, ApiError } from '@/lib/apiClient';
import { 
  getNextRecommendation, 
  getMySkillProgress, 
  getAttemptsForStudent,
  type NextRecommendation,
  type SkillProgress
} from '@/lib/studentJourney';

// Mock fetch for API calls
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('Phase 6.6 API Client', () => {
  it('should automatically attach access token from localStorage', async () => {
    vi.clearAllMocks();
    (localStorage.getItem as any).mockReturnValue('test-token');
    
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: { test: 'success' } }),
      text: async () => JSON.stringify({ data: { test: 'success' } })
    });

    await apiRequest('/test');
    
    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer test-token'
        })
      })
    );
  });

  it('should throw ApiError on network failure', async () => {
    vi.clearAllMocks();
    mockFetch.mockRejectedValueOnce(new Error('Network error'));
    
    await expect(apiRequest('/test')).rejects.toThrow(ApiError);
  });
});

describe('Phase 6.6 Student Journey API', () => {
  it('should get next recommendation from backend', async () => {
    vi.clearAllMocks();
    (localStorage.getItem as any).mockReturnValue('test-token');
    
    const mockRecommendation: NextRecommendation = {
      actionType: 'PRACTICE_SKILL',
      reasonCode: 'LOW_MASTERY',
      reason: 'Bu beceride daha fazla pratik yapmalısın',
      priority: 1,
      evidence: { mastery: 30, evidenceCount: 5, trend: 'STABLE' },
      estimatedTimeMinutes: 15,
      microSkillId: 'ms1'
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: mockRecommendation }),
      text: async () => JSON.stringify({ data: mockRecommendation })
    });

    const result = await getNextRecommendation();
    
    expect(result).toEqual(mockRecommendation);
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/recommendations/next'),
      expect.any(Object)
    );
  });

  it('should get skill progress from backend', async () => {
    vi.clearAllMocks();
    (localStorage.getItem as any).mockReturnValue('test-token');
    
    const mockSkills: SkillProgress[] = [
      { skillId: 'ms1', masteryLevel: 75, confidence: 0.8, attempts: 10, correctAttempts: 8, accuracy: 0.8 },
      { skillId: 'ms2', masteryLevel: 45, confidence: 0.6, attempts: 8, correctAttempts: 4, accuracy: 0.5 }
    ];

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: mockSkills }),
      text: async () => JSON.stringify({ data: mockSkills })
    });

    const result = await getMySkillProgress();
    
    expect(result).toEqual(mockSkills);
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/analytics/me/skills'),
      expect.any(Object)
    );
  });

  it('should get attempts from backend', async () => {
    vi.clearAllMocks();
    (localStorage.getItem as any).mockReturnValue('test-token');
    
    const mockAttempts = [
      {
        attemptId: 'a1',
        evaluationState: 'EVALUATED',
        isCorrect: false,
        question: { id: 'q1', content: 'Test question 1' },
        errorAnalysis: { errorType: 'CONCEPT', hypothesis: 'Kavramsal hata', validated: true },
        createdAt: '2024-01-01T00:00:00Z'
      },
      {
        attemptId: 'a2',
        evaluationState: 'NOT_EVALUABLE',
        isCorrect: false,
        question: { id: 'q2', content: 'Test question 2' },
        createdAt: '2024-01-02T00:00:00Z'
      }
    ];

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: mockAttempts }),
      text: async () => JSON.stringify({ data: mockAttempts })
    });

    const result = await getAttemptsForStudent(20);
    
    expect(result).toHaveLength(2);
    expect(result[0].evaluationState).toBe('EVALUATED');
    expect(result[1].evaluationState).toBe('NOT_EVALUABLE');
  });
});

describe('Phase 6.6 Data Consistency', () => {
  it('should use consistent backend state across API calls', async () => {
    vi.clearAllMocks();
    (localStorage.getItem as any).mockReturnValue('test-token');
    
    // Mock consistent backend responses
    mockFetch.mockImplementation((url: string) => {
      if (url.includes('/recommendations/next')) {
        const data = {
          actionType: 'PRACTICE_SKILL',
          reasonCode: 'LOW_MASTERY',
          reason: 'ms1 becerisine odaklan',
          priority: 1,
          evidence: { mastery: 30, evidenceCount: 5 },
          estimatedTimeMinutes: 15,
          microSkillId: 'ms1'
        };
        return Promise.resolve({
          ok: true,
          json: async () => ({ data }),
          text: async () => JSON.stringify({ data })
        });
      }
      if (url.includes('/analytics/me/skills')) {
        const data = [
          { skillId: 'ms1', masteryLevel: 30, confidence: 0.5, attempts: 5, correctAttempts: 2, accuracy: 0.4 }
        ];
        return Promise.resolve({
          ok: true,
          json: async () => ({ data }),
          text: async () => JSON.stringify({ data })
        });
      }
      return Promise.resolve({ 
        ok: true, 
        json: async () => ({ data: [] }),
        text: async () => JSON.stringify({ data: [] })
      });
    });

    const [recommendation, skills] = await Promise.all([
      getNextRecommendation(),
      getMySkillProgress()
    ]);

    expect(recommendation.microSkillId).toBe('ms1');
    expect(skills[0].skillId).toBe('ms1');
    expect(skills[0].masteryLevel).toBe(30);
  });
});
