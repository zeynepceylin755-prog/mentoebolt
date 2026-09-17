import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Tekrarlarim from './Tekrarlarim';
import { ApiError } from '@/lib/apiClient';
import * as journey from '@/lib/studentJourney';
import type { AttemptResult } from '@/lib/studentJourney';

vi.mock('@/lib/studentJourney', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/studentJourney')>();
  return { ...actual, getAttemptsForStudent: vi.fn() };
});

const getAttemptsForStudent = vi.mocked(journey.getAttemptsForStudent);

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

describe('Tekrarlarim', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('shows a meaningful empty state when nothing has been analysed yet', async () => {
    getAttemptsForStudent.mockResolvedValue([]);
    render(<Tekrarlarim />);

    expect(
      await screen.findByText('Henüz analiz edilmiş bir tekrarın yok.')
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Soru Getir' })).toBeInTheDocument();
  });

  it('groups repeated mistakes by curriculum label and error category', async () => {
    getAttemptsForStudent.mockResolvedValue([
      attempt({ attemptId: 'a1', skillName: 'Bileşke fonksiyon', errorAnalysis: { errorType: 'CONCEPT', hypothesis: null, validated: true }, answer: '12' }),
      attempt({ attemptId: 'a2', skillName: 'Bileşke fonksiyon', errorAnalysis: { errorType: 'CONCEPT', hypothesis: null, validated: true }, answer: '15' }),
      attempt({ attemptId: 'a3', skillName: 'Bileşke fonksiyon', errorAnalysis: { errorType: 'CONCEPT', hypothesis: null, validated: true }, answer: '7' }),
      attempt({ attemptId: 'a4', skillName: 'İşlem önceliği', errorAnalysis: { errorType: 'OPERATION', hypothesis: null, validated: false }, answer: '3' }),
    ]);

    render(<Tekrarlarim />);
    await screen.findByRole('heading', { level: 1 });

    expect(screen.getByText('Bileşke fonksiyon')).toBeInTheDocument();
    expect(screen.getByText('3 kez')).toBeInTheDocument();
    expect(screen.getByText('İşlem önceliği')).toBeInTheDocument();
    expect(screen.getByText('1 kez')).toBeInTheDocument();
  });

  it('messages recurrence rather than counting total mistakes', async () => {
    getAttemptsForStudent.mockResolvedValue([
      attempt({ attemptId: 'a1', skillName: 'Bileşke fonksiyon', answer: '1' }),
      attempt({ attemptId: 'a2', skillName: 'Bileşke fonksiyon', answer: '2' }),
    ]);

    const { container } = render(<Tekrarlarim />);
    await screen.findByRole('heading', { level: 1 });

    expect(screen.getByText('Aynı yerde tekrar takılıyorsun')).toBeInTheDocument();
    expect(container.textContent).not.toContain('yanlışın var');
  });

  it('never presents the canonical correct answer', async () => {
    getAttemptsForStudent.mockResolvedValue([
      attempt({ attemptId: 'a1', skillName: 'Bileşke fonksiyon', correctAnswer: 'GIZLI', answer: '9' }),
    ]);

    const { container } = render(<Tekrarlarim />);
    await screen.findByRole('heading', { level: 1 });

    expect(container.textContent).not.toContain('GIZLI');
  });

  it('shows the student own answers as evidence', async () => {
    getAttemptsForStudent.mockResolvedValue([
      attempt({ attemptId: 'a1', skillName: 'Bileşke fonksiyon', answer: '42x' }),
    ]);

    render(<Tekrarlarim />);
    await screen.findByRole('heading', { level: 1 });

    expect(screen.getByText('Verdiğin cevaplar')).toBeInTheDocument();
    expect(screen.getByText('42x')).toBeInTheDocument();
  });

  it('separates unlabelled attempts instead of guessing a topic', async () => {
    getAttemptsForStudent.mockResolvedValue([
      attempt({ attemptId: 'a1', skillName: null, errorAnalysis: null, answer: '5' }),
    ]);

    render(<Tekrarlarim />);
    await screen.findByRole('heading', { level: 1 });

    expect(screen.getByText('Henüz konuya bağlanmadı')).toBeInTheDocument();
    expect(
      screen.getByText(/Bu sorular henüz bir konuya bağlanmadı/)
    ).toBeInTheDocument();
  });

  it('excludes correct attempts', async () => {
    getAttemptsForStudent.mockResolvedValue([
      attempt({ attemptId: 'ok', isCorrect: true, skillName: 'Bileşke fonksiyon' }),
      attempt({ attemptId: 'bad', skillName: 'Tanım kümesi' }),
    ]);

    render(<Tekrarlarim />);
    await screen.findByRole('heading', { level: 1 });

    expect(screen.getByText('Tanım kümesi')).toBeInTheDocument();
    expect(screen.queryByText('Bileşke fonksiyon')).not.toBeInTheDocument();
  });

  it('excludes attempts the backend could not evaluate', async () => {
    getAttemptsForStudent.mockResolvedValue([
      attempt({ attemptId: 'ne', evaluationState: 'NOT_EVALUABLE', skillName: 'Bileşke fonksiyon' }),
    ]);

    render(<Tekrarlarim />);

    expect(
      await screen.findByText('Henüz analiz edilmiş bir tekrarın yok.')
    ).toBeInTheDocument();
  });

  it('shows an error state with retry when the list cannot be loaded', async () => {
    getAttemptsForStudent.mockRejectedValue(new ApiError('Sunucu hatası', 500));
    render(<Tekrarlarim />);

    expect(await screen.findByText('Tekrarlarına ulaşamadık')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /tekrar dene/i })).toBeInTheDocument();
  });

  it('offers a next step towards a new question', async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    getAttemptsForStudent.mockResolvedValue([
      attempt({ attemptId: 'a1', skillName: 'Bileşke fonksiyon', answer: '1' }),
    ]);

    render(<Tekrarlarim onNavigate={onNavigate} />);
    await screen.findByRole('heading', { level: 1 });

    await user.click(
      screen.getByRole('button', { name: /Bu noktayı birlikte netleştirelim/ })
    );
    expect(onNavigate).toHaveBeenCalledWith('soru-getir');
  });
});
