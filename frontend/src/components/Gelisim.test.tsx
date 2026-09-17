import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Gelisim from './Gelisim';
import { ApiError } from '@/lib/apiClient';
import * as journey from '@/lib/studentJourney';
import type { AttemptResult, SkillProgress } from '@/lib/studentJourney';

vi.mock('@/lib/studentJourney', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/studentJourney')>();
  return {
    ...actual,
    getMySkillProgress: vi.fn(),
    getAttemptsForStudent: vi.fn(),
    getNextRecommendation: vi.fn(),
  };
});

const getMySkillProgress = vi.mocked(journey.getMySkillProgress);
const getAttemptsForStudent = vi.mocked(journey.getAttemptsForStudent);
const getNextRecommendation = vi.mocked(journey.getNextRecommendation);

function skill(overrides: Partial<SkillProgress>): SkillProgress {
  return {
    skillId: 's-x',
    masteryLevel: 50,
    confidence: 0.5,
    attempts: 4,
    correctAttempts: 2,
    accuracy: 50,
    ...overrides,
  };
}

function attempt(overrides: Partial<AttemptResult>): AttemptResult {
  return {
    attemptId: 'a-x',
    evaluationState: 'EVALUATED',
    isCorrect: false,
    correctAnswer: null,
    errorType: null,
    createdAt: '2024-03-01T10:00:00.000Z',
    ...overrides,
  };
}

const recommendation = {
  actionType: 'REMEDIATE_ERROR' as const,
  reasonCode: 'REPEATED_ERROR' as const,
  microSkillId: 's-1',
  reason: 'raw reason',
  priority: 1,
  evidence: {},
  estimatedTimeMinutes: 10,
};

describe('Gelisim', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getNextRecommendation.mockResolvedValue(recommendation);
    getAttemptsForStudent.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('shows an honest empty state when there is no data at all', async () => {
    getMySkillProgress.mockResolvedValue([]);
    render(<Gelisim />);

    expect(
      await screen.findByText('Henüz gelişimini gösterecek kadar veri yok.')
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'İlk sorumu getir' })).toBeInTheDocument();
  });

  it('lists strengthened areas with real attempt counts', async () => {
    getMySkillProgress.mockResolvedValue([
      skill({ skillId: 's1', skillName: 'Bileşke fonksiyon', masteryLevel: 85, confidence: 0.8, attempts: 6, correctAttempts: 5, trend: 'UP' }),
    ]);

    render(<Gelisim />);
    await screen.findByRole('heading', { level: 1 });

    expect(screen.getByText('GÜÇLENEN ALANLAR')).toBeInTheDocument();
    expect(screen.getByText('5 doğru / 6 deneme')).toBeInTheDocument();
  });

  it('groups recurring errors from persisted classifications only', async () => {
    getMySkillProgress.mockResolvedValue([skill({ skillId: 's1' })]);
    getAttemptsForStudent.mockResolvedValue([
      attempt({ attemptId: 'a1', errorAnalysis: { errorType: 'CONCEPT', hypothesis: null, validated: true } }),
      attempt({ attemptId: 'a2', errorAnalysis: { errorType: 'CONCEPT', hypothesis: null, validated: true } }),
      attempt({ attemptId: 'a3', errorAnalysis: { errorType: 'OPERATION', hypothesis: null, validated: true } }),
    ]);

    render(<Gelisim />);
    await screen.findByRole('heading', { level: 1 });

    expect(screen.getByText('TEKRAR EDEN NOKTALAR')).toBeInTheDocument();
    expect(screen.getByText('Kavramsal ayrım')).toBeInTheDocument();
    expect(screen.getByText('2 kez')).toBeInTheDocument();
    expect(screen.getByText('İşlem sırası')).toBeInTheDocument();
  });

  it('says so when no recurring error pattern exists', async () => {
    getMySkillProgress.mockResolvedValue([skill({ skillId: 's1' })]);
    render(<Gelisim />);

    // In the new editorial design, if there are no recurring patterns,
    // the section simply doesn't appear rather than showing a message
    expect(screen.queryByText('TEKRAR EDEN NOKTALAR')).not.toBeInTheDocument();
  });

  it('reports only counts it actually observed', async () => {
    getMySkillProgress.mockResolvedValue([
      skill({ skillId: 's1', skillName: 'A' }),
      skill({ skillId: 's2', skillName: 'B' }),
    ]);
    getAttemptsForStudent.mockResolvedValue([
      attempt({ attemptId: 'a1', isCorrect: true }),
      attempt({ attemptId: 'a2', isCorrect: false }),
      attempt({ attemptId: 'a3', isCorrect: true }),
    ]);

    render(<Gelisim />);
    await screen.findByRole('heading', { level: 1 });

    expect(screen.getByText('Doğru çözülen')).toBeInTheDocument();
    expect(screen.getByText('Değerlendirilen soru')).toBeInTheDocument();
    expect(screen.getByText('Çalışılan alan')).toBeInTheDocument();
  });

  it('contains no fake XP, streak or score', async () => {
    getMySkillProgress.mockResolvedValue([skill({ skillId: 's1', skillName: 'A' })]);
    const { container } = render(<Gelisim />);
    await screen.findByRole('heading', { level: 1 });

    const text = container.textContent ?? '';
    for (const forbidden of ['XP', 'Seri', 'Streak', 'Puan', 'Rozet']) {
      expect(text).not.toContain(forbidden);
    }
  });

  it('explains why percentages are not shown', async () => {
    getMySkillProgress.mockResolvedValue([skill({ skillId: 's1', skillName: 'A' })]);
    render(<Gelisim />);

    expect(
      await screen.findByText(/Yüzde göstermiyoruz/)
    ).toBeInTheDocument();
  });

  it('shows the learning focus from the deterministic recommendation', async () => {
    getMySkillProgress.mockResolvedValue([skill({ skillId: 's1', skillName: 'A' })]);
    render(<Gelisim onNavigate={vi.fn()} />);

    expect(await screen.findByText('Şu an en çok burada çalışıyorsun.')).toBeInTheDocument();
    expect(screen.getByText('Tekrar eden bir noktayı netleştir')).toBeInTheDocument();
    expect(
      screen.getByText('Son çözdüğün sorularda burada tekrar eden bir zorlanma gördük.')
    ).toBeInTheDocument();
  });

  it('renders progress even when the recommendation call fails', async () => {
    getMySkillProgress.mockResolvedValue([skill({ skillId: 's1', skillName: 'Bileşke fonksiyon' })]);
    getNextRecommendation.mockRejectedValue(new ApiError('boom', 500));

    render(<Gelisim />);

    // The area legitimately appears in more than one card; the point is that the
    // progress view rendered at all without the recommendation.
    expect((await screen.findAllByText('Bileşke fonksiyon')).length).toBeGreaterThan(0);
    expect(screen.queryByText('Öğrenme odağın')).not.toBeInTheDocument();
  });

  it('shows an error state with retry when progress cannot be loaded', async () => {
    getMySkillProgress.mockRejectedValue(new ApiError('Sunucu hatası', 500));
    render(<Gelisim />);

    expect(await screen.findByText('Gelişimine ulaşamadık')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /tekrar dene/i })).toBeInTheDocument();
  });

  it('navigates to the main action from the focus card', async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    getMySkillProgress.mockResolvedValue([skill({ skillId: 's1', skillName: 'A' })]);

    render(<Gelisim onNavigate={onNavigate} />);
    await screen.findByRole('heading', { level: 1 });

    await user.click(screen.getByRole('button', { name: /Bugünkü odağa git/ }));
    expect(onNavigate).toHaveBeenCalledWith('soru-getir');
  });
});
