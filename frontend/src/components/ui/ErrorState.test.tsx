import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ErrorState from './ErrorState';

describe('ErrorState Component', () => {
  it('renders message correctly', () => {
    render(<ErrorState message="Something went wrong" />);
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
  });

  it('renders default title when not provided', () => {
    render(<ErrorState message="Error occurred" />);
    expect(screen.getByText('Bir sorun oluştu')).toBeInTheDocument();
  });

  it('renders custom title when provided', () => {
    render(<ErrorState title="Custom Error" message="Error occurred" />);
    expect(screen.getByText('Custom Error')).toBeInTheDocument();
  });

  it('renders retry button when onRetry is provided', () => {
    const handleRetry = vi.fn();
    render(<ErrorState message="Error" onRetry={handleRetry} />);
    expect(screen.getByText('Tekrar dene')).toBeInTheDocument();
  });

  it('calls retry handler when button is clicked', async () => {
    const handleRetry = vi.fn();
    render(<ErrorState message="Error" onRetry={handleRetry} />);
    await userEvent.click(screen.getByText('Tekrar dene'));
    expect(handleRetry).toHaveBeenCalledTimes(1);
  });

  it('does not render retry button when onRetry is not provided', () => {
    render(<ErrorState message="Error" />);
    expect(screen.queryByText('Tekrar dene')).not.toBeInTheDocument();
  });

  it('applies variant-specific styles', () => {
    const { rerender } = render(<ErrorState variant="network" message="Network error" />);
    expect(screen.getByText('Bağlantı hatası')).toBeInTheDocument();

    rerender(<ErrorState variant="auth" message="Auth error" />);
    expect(screen.getByText('Oturum hatası')).toBeInTheDocument();
  });

  it('renders error icon', () => {
    render(<ErrorState message="Error" />);
    const container = screen.getByText('Bir sorun oluştu').parentElement?.parentElement;
    expect(container?.querySelector('svg')).toBeInTheDocument();
  });
});