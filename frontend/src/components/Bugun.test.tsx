import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Bugun from './Bugun';
import { ApiError } from '@/lib/apiClient';
import * as journey from '@/lib/studentJourney';

vi.mock('@/lib/studentJourney', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/studentJourney')>();
  return {
    ...actual,
    getNextRecommendation: vi.fn(),
    getMySkillProgress: vi.fn(),
    getAttemptsForStudent: vi.fn(),
  };
});

const mockedRecommendation = vi.mocked(journey.getNextRecommendation);
const mockedSkills = vi.mocked(journey.getMySkillProgress);
const mockedAttempts = vi.mocked(journey.getAttemptsForStudent);

const baseRecommendation = {
  actionType: 'REMEDIATE_ERROR' as const,
  reasonCode: 'REPEATED_ERROR' as const,
  microSkillId: 'skill-1',
  topicName: 'Bileşke fonksiyon',
  reason: 'Bileşke fonksiyonda tekrar eden bir zorlanma görüldü.',
  priority: 1,
  evidence: { repeatedErrorPattern: true, recentIncorrectCount: 3 },
  estimatedTimeMinutes: 10,
};

describe('Bugun', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedSkills.mockResolvedValue([]);
    mockedAttempts.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('leads with the question "Bugün ne yapmalıyım?"', async () => {
    mockedRecommendation.mockResolvedValue(baseRecommendation);
    render(<Bugun />);

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Bugün ne yapmalıyım?' })
    ).toBeInTheDocument();
  });

  it('shows the topic name prominently in the recommendation card', async () => {
    mockedRecommendation.mockResolvedValue(baseRecommendation);
    render(<Bugun />);

    expect(
      await screen.findByRole('heading', { name: 'Bileşke fonksiyon' })
    ).toBeInTheDocument();
  });

  it('uses real evidence from the recommendation', async () => {
    mockedRecommendation.mockResolvedValue(baseRecommendation);
    render(<Bugun />);

    expect(
      await screen.findByText('Son denemelerinde burada 3 kez takıldın.')
    ).toBeInTheDocument();
  });

  it('renders the honest empty state when the backend has no evidence yet', async () => {
    mockedRecommendation.mockResolvedValue({
      actionType: 'ONBOARDING',
      reasonCode: 'INSUFFICIENT_EVIDENCE',
      reason: 'Henüz yeterli veri yok.',
      priority: 0,
      evidence: {},
      estimatedTimeMinutes: 0,
    });
    render(<Bugun onMeasureReadiness={vi.fn()} />);

    expect(
      await screen.findByText('Henüz seni yeterince tanımıyoruz.')
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'İlk sorumu getir' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Hazırbulunuşluğumu ölç' })).toBeInTheDocument();
  });

  it('never shows vanity metrics such as XP or streaks', async () => {
    mockedRecommendation.mockResolvedValue(baseRecommendation);
    const { container } = render(<Bugun />);
    await screen.findByRole('heading', { name: 'Bugün ne yapmalıyım?' });

    const text = container.textContent ?? '';
    for (const forbidden of ['XP', 'Seri', 'Streak', 'Puan', '%']) {
      expect(text).not.toContain(forbidden);
    }
  });

  it('shows an error state with a retry action when loading fails', async () => {
    mockedRecommendation.mockRejectedValue(new ApiError('Sunucu hatası', 500));
    render(<Bugun />);

    expect(await screen.findByText('Bugün planına ulaşamadık')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /tekrar dene/i })).toBeInTheDocument();
  });

  it('retries the request when the retry button is pressed', async () => {
    const user = userEvent.setup();
    mockedRecommendation
      .mockRejectedValueOnce(new ApiError('Sunucu hatası', 500))
      .mockResolvedValueOnce(baseRecommendation);

    render(<Bugun />);
    await screen.findByText('Bugün planına ulaşamadık');

    await user.click(screen.getByRole('button', { name: /tekrar dene/i }));

    await waitFor(() => expect(mockedRecommendation).toHaveBeenCalledTimes(2));
    expect(
      await screen.findByRole('heading', { name: 'Bileşke fonksiyon' })
    ).toBeInTheDocument();
  });

  it('shows recent mistakes when available', async () => {
    mockedRecommendation.mockResolvedValue(baseRecommendation);
    mockedAttempts.mockResolvedValue([
      {
        attemptId: 'a1',
        evaluationState: 'EVALUATED',
        isCorrect: false,
        correctAnswer: null,
        errorType: 'CONCEPT',
        skillName: 'Bileşke fonksiyon',
        errorAnalysis: { errorType: 'CONCEPT', hypothesis: null, validated: true },
        answer: '12',
        createdAt: '2024-03-01T10:00:00.000Z',
      },
    ]);
    render(<Bugun />);

    expect(await screen.findByText('Son soruların')).toBeInTheDocument();
    expect(screen.getAllByText('Bileşke fonksiyon')[0]).toBeInTheDocument();
    expect(screen.getByText('Tekrar önerildi')).toBeInTheDocument();
  });

  it('navigates to Soru Getir, the product main action', async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    mockedRecommendation.mockResolvedValue(baseRecommendation);
    render(<Bugun onNavigate={onNavigate} />);

    await screen.findByRole('heading', { name: 'Bugün ne yapmalıyım?' });
    await user.click(screen.getByRole('button', { name: /Soruyla çalışmaya başla/ }));

    expect(onNavigate).toHaveBeenCalledWith('soru-getir');
  });

  it('navigates to Tekrarlarım when clicking "Hepsini gör"', async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    mockedRecommendation.mockResolvedValue(baseRecommendation);
    mockedAttempts.mockResolvedValue([
      {
        attemptId: 'a1',
        evaluationState: 'EVALUATED',
        isCorrect: false,
        correctAnswer: null,
        errorType: null,
        skillName: 'Bileşke fonksiyon',
        answer: '12',
        createdAt: '2024-03-01T10:00:00.000Z',
      },
    ]);
    render(<Bugun onNavigate={onNavigate} />);

    await screen.findByText('Son soruların');
    await user.click(screen.getByRole('button', { name: 'Tekrarları gör' }));

    expect(onNavigate).toHaveBeenCalledWith('tekrarlarim');
  });

  it('explains that AI does not choose the next step', async () => {
    mockedRecommendation.mockResolvedValue(baseRecommendation);
    render(<Bugun />);

    expect(
      await screen.findByText(/Yapay zekâ yalnızca açıklama metninde kullanılır/)
    ).toBeInTheDocument();
  });

  it('fixes the typo from BÜGÜN to BUGÜN', async () => {
    mockedRecommendation.mockResolvedValue(baseRecommendation);
    const { container } = render(<Bugun />);
    await screen.findByRole('heading', { name: 'Bugün ne yapmalıyım?' });
    expect(container.textContent).not.toContain('BÜGÜN');
    expect(container.textContent).toContain('BUGÜN');
  });
});
