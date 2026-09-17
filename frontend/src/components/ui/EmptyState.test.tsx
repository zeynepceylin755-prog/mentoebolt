import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import EmptyState from './EmptyState';

describe('EmptyState Component', () => {
  it('renders title and description', () => {
    render(<EmptyState title="No data" description="There is no data available" />);
    expect(screen.getByText('No data')).toBeInTheDocument();
    expect(screen.getByText('There is no data available')).toBeInTheDocument();
  });

  it('renders default icon when type is default', () => {
    render(<EmptyState title="Default" description="Test" />);
    // Default icon should be present (svg icon from lucide-react)
    const container = screen.getByText('Default').parentElement?.parentElement;
    expect(container?.querySelector('svg')).toBeInTheDocument();
  });

  it('renders custom icon when provided', () => {
    render(<EmptyState title="Custom" description="Test" icon={<div data-testid="custom-icon">Icon</div>} />);
    expect(screen.getByTestId('custom-icon')).toBeInTheDocument();
  });

  it('renders action button when action is provided', () => {
    const handleClick = vi.fn();
    render(<EmptyState title="Action" description="Test" action={{ label: 'Click me', onClick: handleClick }} />);
    expect(screen.getByText('Click me')).toBeInTheDocument();
  });

  it('calls action handler when button is clicked', async () => {
    const handleClick = vi.fn();
    render(<EmptyState title="Action" description="Test" action={{ label: 'Click me', onClick: handleClick }} />);
    await userEvent.click(screen.getByText('Click me'));
    expect(handleClick).toHaveBeenCalledTimes(1);
  });

  it('does not render action button when action is not provided', () => {
    render(<EmptyState title="No action" description="Test" />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('renders with different types', () => {
    const { rerender } = render(<EmptyState type="questions" title="Questions" description="Test" />);
    expect(screen.getByText('Questions')).toBeInTheDocument();

    rerender(<EmptyState type="progress" title="Progress" description="Test" />);
    expect(screen.getByText('Progress')).toBeInTheDocument();
  });
});