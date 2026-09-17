import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SoruGetir from './SoruGetir';
import { ApiError } from '@/lib/apiClient';
import * as journey from '@/lib/studentJourney';

vi.mock('@/lib/studentJourney', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/studentJourney')>();
  return {
    ...actual,
    uploadAsset: vi.fn(),
    createIngestion: vi.fn(),
    analyzeIngestion: vi.fn(),
    transitionIngestion: vi.fn(),
    createCanonicalQuestion: vi.fn(),
    submitAnswer: vi.fn(),
    getAttempt: vi.fn(),
    requestGuidance: vi.fn(),
  };
});

const uploadAsset = vi.mocked(journey.uploadAsset);
const createIngestion = vi.mocked(journey.createIngestion);
const analyzeIngestion = vi.mocked(journey.analyzeIngestion);
const transitionIngestion = vi.mocked(journey.transitionIngestion);
const createCanonicalQuestion = vi.mocked(journey.createCanonicalQuestion);
const submitAnswer = vi.mocked(journey.submitAnswer);
const getAttempt = vi.mocked(journey.getAttempt);
const requestGuidance = vi.mocked(journey.requestGuidance);

function makeImageFile(name = 'soru.png') {
  return new File([new Uint8Array([1, 2, 3])], name, { type: 'image/png' });
}

const ingestion = {
  id: 'ing-1',
  state: 'INGESTED' as const,
  ingestMethod: 'UPLOAD',
  sourceId: null,
  normalizedText: null,
  ocrConfidence: null,
  requiresReview: false,
  reviewNotes: null,
  resultingQuestionId: null,
};

describe('SoruGetir', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // jsdom does not implement object URLs.
    Object.defineProperty(URL, 'createObjectURL', { writable: true, value: vi.fn(() => 'blob:preview') });
    Object.defineProperty(URL, 'revokeObjectURL', { writable: true, value: vi.fn() });

    analyzeIngestion.mockResolvedValue({});
    transitionIngestion.mockResolvedValue(ingestion);
    createCanonicalQuestion.mockResolvedValue({
      question: { id: 'q-1', content: 'f(x)=2x+3 ise f(5) kaçtır?', type: 'OPEN' },
      instance: { id: 'inst-1' },
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('presents the main action as bringing a question', () => {
    render(<SoruGetir />);
    expect(screen.getByRole('heading', { level: 1, name: 'Bir soru getir' })).toBeInTheDocument();
  });

  it('offers camera capture and gallery upload as the two primary actions', () => {
    render(<SoruGetir />);
    expect(screen.getByRole('button', { name: /Kamerayla çek/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Fotoğraf yükle/ })).toBeInTheDocument();
  });

  it('exposes a camera input with capture="environment" for mobile', () => {
    const { container } = render(<SoruGetir />);
    const cameraInput = container.querySelector('input[capture="environment"]');
    expect(cameraInput).not.toBeNull();
    expect(cameraInput).toHaveAttribute('accept', 'image/*');
  });

  it('rejects an unsupported file type with human language', async () => {
    const { container } = render(<SoruGetir />);

    // fireEvent bypasses the DOM `accept` filter so the component's own
    // validation is what gets exercised.
    await fireEvent.change(container.querySelector('input[type="file"]') as HTMLInputElement, {
      target: { files: [new File(['x'], 'notes.txt', { type: 'text/plain' })] },
    });

    expect(await screen.findByText(/Bu dosya türünü okuyamıyorum/)).toBeInTheDocument();
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('rejects an oversized file', async () => {
    const { container } = render(<SoruGetir />);

    await fireEvent.change(container.querySelector('input[type="file"]') as HTMLInputElement, {
      target: { files: [new File([new Uint8Array(8 * 1024 * 1024)], 'big.png', { type: 'image/png' })] },
    });

    expect(await screen.findByText(/Dosya çok büyük/)).toBeInTheDocument();
  });

  it('shows a preview with a meaningful alt text after selecting a photo', async () => {
    const user = userEvent.setup();
    const { container } = render(<SoruGetir />);

    const galleryInput = container.querySelectorAll('input[type="file"]')[1] as HTMLInputElement;
    await user.upload(galleryInput, makeImageFile('soru-1.png'));

    const image = await screen.findByRole('img');
    expect(image).toHaveAttribute('alt', 'Seçtiğin soru fotoğrafı: soru-1.png');
    expect(screen.getByRole('button', { name: 'Seçilen fotoğrafı kaldır' })).toBeInTheDocument();
  });

  it('run the real upload path when a file is selected', async () => {
    const user = userEvent.setup();
    uploadAsset.mockResolvedValue({
      ingestion,
      asset: { mimeType: 'image/png', sizeBytes: 3, contentHash: 'abc' },
    });

    const { container } = render(<SoruGetir />);
    const galleryInput = container.querySelectorAll('input[type="file"]')[1] as HTMLInputElement;
    await user.upload(galleryInput, makeImageFile());

    await user.click(screen.getByRole('button', { name: /Soruyu incele/ }));

    await waitFor(() => expect(uploadAsset).toHaveBeenCalledTimes(1));
    expect(createIngestion).not.toHaveBeenCalled();
  });

  it('stops honestly when a photo yields no readable text', async () => {
    const user = userEvent.setup();
    uploadAsset.mockResolvedValue({
      ingestion,
      asset: { mimeType: 'image/png', sizeBytes: 3, contentHash: 'abc' },
    });

    const { container } = render(<SoruGetir />);
    const galleryInput = container.querySelectorAll('input[type="file"]')[1] as HTMLInputElement;
    await user.upload(galleryInput, makeImageFile());
    await user.click(screen.getByRole('button', { name: /Soruyu incele/ }));

    expect(
      await screen.findByText(/Fotoğraftaki soruyu okuyamadım/)
    ).toBeInTheDocument();
    // No placeholder sentence is ever sent for analysis on the student's behalf.
    expect(analyzeIngestion).not.toHaveBeenCalled();
  });

  it('shows progressive, human progress steps while analysing', async () => {
    const user = userEvent.setup();
    let resolveAnalysis: (() => void) | undefined;
    analyzeIngestion.mockImplementation(
      () => new Promise<void>((resolve) => { resolveAnalysis = resolve; })
    );

    const { container } = render(<SoruGetir />);
    const textarea = screen.getByLabelText('Soruyu yazmak istersen');
    await user.type(textarea, 'f(x)=2x+3 ise f(5) kaçtır?');

    createIngestion.mockResolvedValue(ingestion);
    await user.click(screen.getByRole('button', { name: /Soruyu incele/ }));

    const status = await screen.findByRole('status');
    // The current step is announced once, via the live-region heading.
    expect(within(status).getAllByText('Çözümünü inceliyorum...')).toHaveLength(2);
    expect(within(status).getByText('Soruyu okuyorum...')).toBeInTheDocument();
    expect(within(status).getByText('Nerede takıldığını buluyorum...')).toBeInTheDocument();
    expect(within(status).getByRole('heading')).toHaveTextContent('Çözümünü inceliyorum...');

    resolveAnalysis?.();
    await waitFor(() => expect(createCanonicalQuestion).toHaveBeenCalled());
  });

  it('asks for the student answer once the question exists', async () => {
    const user = userEvent.setup();
    createIngestion.mockResolvedValue(ingestion);

    render(<SoruGetir />);
    await user.type(
      screen.getByLabelText('Soruyu yazmak istersen'),
      'f(x)=2x+3 ise f(5) kaçtır?'
    );
    await user.click(screen.getByRole('button', { name: /Soruyu incele/ }));

    expect(
      await screen.findByRole('heading', { name: 'Şimdi cevabını yaz' })
    ).toBeInTheDocument();
    expect(screen.getByText('f(x)=2x+3 ise f(5) kaçtır?')).toBeInTheDocument();
  });

  it('requires an answer before submitting', async () => {
    const user = userEvent.setup();
    createIngestion.mockResolvedValue(ingestion);

    render(<SoruGetir />);
    await user.type(screen.getByLabelText('Soruyu yazmak istersen'), 'Bir soru');
    await user.click(screen.getByRole('button', { name: /Soruyu incele/ }));
    await screen.findByRole('heading', { name: 'Şimdi cevabını yaz' });

    expect(screen.getByRole('button', { name: /Cevabı gönder/ })).toBeDisabled();
  });

  it('presents an incorrect attempt as a small missed distinction, not a failure', async () => {
    const user = userEvent.setup();
    createIngestion.mockResolvedValue(ingestion);
    submitAnswer.mockResolvedValue({
      attemptId: 'a-1',
      evaluationState: 'EVALUATED',
      isCorrect: false,
      correctAnswer: null,
      errorType: 'CONCEPT',
      createdAt: '2024-01-01T00:00:00.000Z',
    });
    getAttempt.mockResolvedValue({
      attemptId: 'a-1',
      evaluationState: 'EVALUATED',
 isCorrect: false,
      correctAnswer: null,
      errorType: 'CONCEPT',
      skillName: 'Bileşke fonksiyon',
      errorAnalysis: { errorType: 'CONCEPT', hypothesis: 'Tanım kümesi ayrımı kaçmış.', validated: true },
      createdAt: '2024-01-01T00:00:00.000Z',
    });

    render(<SoruGetir />);
    await user.type(screen.getByLabelText('Soruyu yazmak istersen'), 'Bir soru');
    await user.click(screen.getByRole('button', { name: /Soruyu incele/ }));
    await screen.findByRole('heading', { name: 'Şimdi cevabını yaz' });

    await user.type(screen.getByLabelText('Cevabın'), '12');
    await user.click(screen.getByRole('button', { name: /Cevabı gönder/ }));

    expect(
      await screen.findByRole('heading', { name: 'Nerede takıldığını bulduk' })
    ).toBeInTheDocument();
    // Structured pedagogical sections, never a chat transcript.
    expect(screen.getByRole('heading', { name: 'Soruda ne oldu?' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Nerede takıldın?' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Bu neyle ilgili?' })).toBeInTheDocument();
    expect(screen.getByText('Tanım kümesi ayrımı kaçmış.')).toBeInTheDocument();
    expect(screen.getByText('Bileşke fonksiyon')).toBeInTheDocument();
  });

  it('never shames the student after an incorrect answer', async () => {
    const user = userEvent.setup();
    createIngestion.mockResolvedValue(ingestion);
    submitAnswer.mockResolvedValue({
      attemptId: 'a-1',
      evaluationState: 'EVALUATED',
      isCorrect: false,
      correctAnswer: null,
      errorType: null,
      createdAt: '2024-01-01T00:00:00.000Z',
    });
    getAttempt.mockResolvedValue({
      attemptId: 'a-1',
      evaluationState: 'EVALUATED',
      isCorrect: false,
      correctAnswer: null,
      errorType: null,
      errorAnalysis: null,
      createdAt: '2024-01-01T00:00:00.000Z',
    });

    const { container } = render(<SoruGetir />);
    await user.type(screen.getByLabelText('Soruyu yazmak istersen'), 'Bir soru');
    await user.click(screen.getByRole('button', { name: /Soruyu incele/ }));
    await screen.findByRole('heading', { name: 'Şimdi cevabını yaz' });
    await user.type(screen.getByLabelText('Cevabın'), '12');
    await user.click(screen.getByRole('button', { name: /Cevabı gönder/ }));
    await screen.findByRole('heading', { name: 'Nerede takıldığını bulduk' });

    const text = container.textContent ?? '';
    expect(text).not.toContain('Yanlış yaptın');
    expect(text).toContain('küçük bir ayrım kaçmış');
  });

  it('celebrates a correct attempt without gamification', async () => {
    const user = userEvent.setup();
    createIngestion.mockResolvedValue(ingestion);
    submitAnswer.mockResolvedValue({
      attemptId: 'a-2',
      evaluationState: 'EVALUATED',
      isCorrect: true,
      correctAnswer: null,
      errorType: null,
      createdAt: '2024-01-01T00:00:00.000Z',
    });
    getAttempt.mockResolvedValue({
      attemptId: 'a-2',
      evaluationState: 'EVALUATED',
      isCorrect: true,
      correctAnswer: null,
      errorType: null,
      errorAnalysis: null,
      createdAt: '2024-01-01T00:00:00.000Z',
    });

    const { container } = render(<SoruGetir />);
    await user.type(screen.getByLabelText('Soruyu yazmak istersen'), 'Bir soru');
    await user.click(screen.getByRole('button', { name: /Soruyu incele/ }));
    await screen.findByRole('heading', { name: 'Şimdi cevabını yaz' });
    await user.type(screen.getByLabelText('Cevabın'), '13');
    await user.click(screen.getByRole('button', { name: /Cevabı gönder/ }));

    expect(
      await screen.findByRole('heading', { name: 'Bu soruyu doğru çözdün' })
    ).toBeInTheDocument();
    const text = container.textContent ?? '';
    expect(text).not.toContain('XP');
    expect(text).not.toContain('Tebrikler!');
  });

  it('reports a NOT_EVALUABLE attempt honestly instead of guessing', async () => {
    const user = userEvent.setup();
    createIngestion.mockResolvedValue(ingestion);
    submitAnswer.mockResolvedValue({
      attemptId: 'a-3',
      evaluationState: 'NOT_EVALUABLE',
      isCorrect: false,
      correctAnswer: null,
      errorType: null,
      createdAt: '2024-01-01T00:00:00.000Z',
    });
    getAttempt.mockResolvedValue({
      attemptId: 'a-3',
      evaluationState: 'NOT_EVALUABLE',
      isCorrect: false,
      correctAnswer: null,
      errorType: null,
      errorAnalysis: null,
      createdAt: '2024-01-01T00:00:00.000Z',
    });

    render(<SoruGetir />);
    await user.type(screen.getByLabelText('Soruyu yazmak istersen'), 'Bir soru');
    await user.click(screen.getByRole('button', { name: /Soruyu incele/ }));
    await screen.findByRole('heading', { name: 'Şimdi cevabını yaz' });
    await user.type(screen.getByLabelText('Cevabın'), 'belirsiz');
    await user.click(screen.getByRole('button', { name: /Cevabı gönder/ }));

    expect(
      await screen.findByRole('heading', { name: 'Bu cevabı değerlendiremedik' })
    ).toBeInTheDocument();
    expect(screen.getByText(/kesin bir şey söylemek istemiyoruz/)).toBeInTheDocument();
  });

  it('requests guidance progressively without exposing an answer', async () => {
    const user = userEvent.setup();
    createIngestion.mockResolvedValue(ingestion);
    submitAnswer.mockResolvedValue({
      attemptId: 'a-4',
      evaluationState: 'EVALUATED',
      isCorrect: false,
      correctAnswer: null,
      errorType: 'CONCEPT',
      createdAt: '2024-01-01T00:00:00.000Z',
    });
    getAttempt.mockResolvedValue({
      attemptId: 'a-4',
      evaluationState: 'EVALUATED',
      isCorrect: false,
      correctAnswer: null,
      errorType: 'CONCEPT',
      errorAnalysis: { errorType: 'CONCEPT', hypothesis: null, validated: false },
      createdAt: '2024-01-01T00:00:00.000Z',
    });
    requestGuidance.mockResolvedValue({
      explanation: 'Önce içteki fonksiyonun değerini bulmayı dene.',
      stepByStep: ['İçteki ifadeyi hesapla', 'Sonucu dıştaki ifadeye koy'],
      examples: [],
      keyPoints: [],
      practiceSuggestion: 'Benzer bir soruyla tekrar dene.',
      mode: 'HINT',
      metadata: {
        model: 'm',
        version: '1',
        timestamp: '2024-01-01T00:00:00.000Z',
        tokensUsed: 1,
        latencyMs: 1,
        source: 'provider',
        safety: 'clear',
      },
    });

    render(<SoruGetir />);
    await user.type(screen.getByLabelText('Soruyu yazmak istersen'), 'Bir soru');
    await user.click(screen.getByRole('button', { name: /Soruyu incele/ }));
    await screen.findByRole('heading', { name: 'Şimdi cevabını yaz' });
    await user.type(screen.getByLabelText('Cevabın'), '12');
    await user.click(screen.getByRole('button', { name: /Cevabı gönder/ }));
    await screen.findByRole('heading', { name: 'Nerede takıldığını bulduk' });

    await user.click(screen.getByRole('button', { name: 'Bir ipucu' }));

    expect(await screen.findByText('Önce içteki fonksiyonun değerini bulmayı dene.')).toBeInTheDocument();
    expect(requestGuidance).toHaveBeenCalledWith('a-4', 'HINT');
    expect(screen.getByText('İçteki ifadeyi hesapla')).toBeInTheDocument();
  });

  it('surfaces a network failure with a retry that replays the analysis', async () => {
    const user = userEvent.setup();
    createIngestion.mockRejectedValueOnce(new ApiError('boom', 0));
    createIngestion.mockResolvedValueOnce(ingestion);

    render(<SoruGetir />);
    await user.type(screen.getByLabelText('Soruyu yazmak istersen'), 'Bir soru');
    await user.click(screen.getByRole('button', { name: /Soruyu incele/ }));

    expect(
      await screen.findByText(/Bağlantı kurulamadı/)
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /tekrar dene/i }));
    await waitFor(() => expect(createIngestion).toHaveBeenCalledTimes(2));
  });

  it('never exposes backend or provider internals in an error state', async () => {
    const user = userEvent.setup();
    createIngestion.mockRejectedValue(
      new ApiError('PrismaClientKnownRequestError: Unique constraint failed', 500)
    );

    const { container } = render(<SoruGetir />);
    await user.type(screen.getByLabelText('Soruyu yazmak istersen'), 'Bir soru');
    await user.click(screen.getByRole('button', { name: /Soruyu incele/ }));
    await screen.findByRole('heading', { name: 'Soruyu şu anda analiz edemedik' });

    const text = container.textContent ?? '';
    for (const forbidden of ['Prisma', 'stack', 'provider', 'API']) {
      expect(text).not.toContain(forbidden);
    }
  });

  it('lets the student start over from a finished analysis', async () => {
    const user = userEvent.setup();
    createIngestion.mockResolvedValue(ingestion);
    submitAnswer.mockResolvedValue({
      attemptId: 'a-5',
      evaluationState: 'EVALUATED',
      isCorrect: true,
      correctAnswer: null,
      errorType: null,
      createdAt: '2024-01-01T00:00:00.000Z',
    });
    getAttempt.mockResolvedValue({
      attemptId: 'a-5',
      evaluationState: 'EVALUATED',
      isCorrect: true,
      correctAnswer: null,
      errorType: null,
      errorAnalysis: null,
      createdAt: '2024-01-01T00:00:00.000Z',
    });

    render(<SoruGetir />);
    await user.type(screen.getByLabelText('Soruyu yazmak istersen'), 'Bir soru');
    await user.click(screen.getByRole('button', { name: /Soruyu incele/ }));
    await screen.findByRole('heading', { name: 'Şimdi cevabını yaz' });
    await user.type(screen.getByLabelText('Cevabın'), '13');
    await user.click(screen.getByRole('button', { name: /Cevabı gönder/ }));
    await screen.findByRole('heading', { name: 'Bu soruyu doğru çözdün' });

    await user.click(screen.getByRole('button', { name: 'Yeni Soru Getir' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Bir soru getir' })).toBeInTheDocument();
  });
});
