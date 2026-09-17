import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import Loading from './Loading';

describe('Loading', () => {
  it('renders a spinner and the default message', () => {
    render(<Loading />);
    expect(screen.getByText('Yükleniyor...')).toBeInTheDocument();
    expect(screen.getByRole('status').querySelector('svg')).toBeInTheDocument();
  });

  it('renders a custom message when provided', () => {
    render(<Loading message="Bugün planı hazırlanıyor..." />);
    expect(screen.getByText('Bugün planı hazırlanıyor...')).toBeInTheDocument();
  });

  it('uses student-facing language for each state', () => {
    const { rerender } = render(<Loading state="uploading" />);
    expect(screen.getByText('Soruyu okuyorum...')).toBeInTheDocument();

    rerender(<Loading state="analyzing" />);
    expect(screen.getByText('Çözümünü inceliyorum...')).toBeInTheDocument();

    rerender(<Loading state="processing" />);
    expect(screen.getByText('Nerede takıldığını buluyorum...')).toBeInTheDocument();
  });

  it('never leaks technical implementation wording', () => {
    const { container } = render(<Loading state="processing" />);
    const text = container.textContent ?? '';
    for (const forbidden of ['OCR', 'API', 'AI request', 'Processing']) {
      expect(text).not.toContain(forbidden);
    }
  });

  it('applies size variants to the spinner', () => {
    const { rerender } = render(<Loading size="sm" />);
    expect(screen.getByRole('status').querySelector('svg')).toHaveClass('h-4', 'w-4');

    rerender(<Loading size="lg" />);
    expect(screen.getByRole('status').querySelector('svg')).toHaveClass('h-7', 'w-7');
  });

  it('announces loading state through a live region', () => {
    render(<Loading message="Matematik yolun hazırlanıyor..." />);
    const status = screen.getByRole('status');
    expect(status).toHaveAttribute('aria-live', 'polite');
  });

  it('renders an ordered step list when steps are provided', () => {
    render(
      <Loading
        message="Soruyu okuyorum..."
        steps={['Soruyu okuyorum...', 'Çözümünü inceliyorum...', 'Nerede takıldığını buluyorum...']}
        activeStep={1}
      />
    );

    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(3);
    // Completed step is marked, current step is announced to assistive tech.
    expect(screen.getByText(/şu anda/)).toBeInTheDocument();
    expect(screen.getByText(/tamamlandı/)).toBeInTheDocument();
  });

  it('does not render a blocking fullscreen overlay', () => {
    const { container } = render(<Loading fullscreen />);
    expect(container.querySelector('.fixed')).toBeNull();
  });
});
