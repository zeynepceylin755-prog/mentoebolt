import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Input, { Textarea } from './Input';

describe('Input Component', () => {
  it('renders input correctly', () => {
    render(<Input label="Email" placeholder="test@example.com" />);
    expect(screen.getByLabelText('Email')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('test@example.com')).toBeInTheDocument();
  });

  it('associates label with input', () => {
    render(<Input label="Username" />);
    const input = screen.getByLabelText('Username');
    expect(input).toBeInTheDocument();
    expect(input.tagName).toBe('INPUT');
  });

  it('shows error message when provided', () => {
    render(<Input label="Email" error="Invalid email" />);
    expect(screen.getByText('Invalid email')).toBeInTheDocument();
    const input = screen.getByLabelText('Email');
    expect(input).toHaveAttribute('aria-invalid', 'true');
  });

  it('shows helper text when provided', () => {
    render(<Input label="Password" helperText="Must be at least 8 characters" />);
    expect(screen.getByText('Must be at least 8 characters')).toBeInTheDocument();
  });

  it('shows required indicator when required', () => {
    render(<Input label="Email" required />);
    const label = screen.getByText('Email');
    expect(label).toBeInTheDocument();
    expect(label).toHaveClass('text-sm');
    expect(screen.getByText('*')).toBeInTheDocument();
    expect(screen.getByText('*')).toHaveClass('text-accent');
  });

  it('handles value changes', async () => {
    render(<Input label="Username" />);
    const input = screen.getByLabelText('Username');
    await userEvent.type(input, 'testuser');
    expect(input).toHaveValue('testuser');
  });

  it('applies custom className', () => {
    render(<Input label="Email" className="custom-input" />);
    expect(screen.getByLabelText('Email')).toHaveClass('custom-input');
  });

  it('is disabled when disabled prop is true', () => {
    render(<Input label="Email" disabled />);
    expect(screen.getByLabelText('Email')).toBeDisabled();
  });
});

describe('Textarea Component', () => {
  it('renders textarea correctly', () => {
    render(<Textarea label="Message" rows={4} />);
    const textarea = screen.getByLabelText('Message');
    expect(textarea).toBeInTheDocument();
    expect(textarea).toHaveAttribute('rows', '4');
  });

  it('handles value changes', async () => {
    render(<Textarea label="Message" />);
    const textarea = screen.getByLabelText('Message');
    await userEvent.type(textarea, 'Hello world');
    expect(textarea).toHaveValue('Hello world');
  });

  it('shows error message when provided', () => {
    render(<Textarea label="Message" error="Message is required" />);
    expect(screen.getByText('Message is required')).toBeInTheDocument();
  });

  it('has resize-none class by default', () => {
    render(<Textarea label="Message" />);
    expect(screen.getByLabelText('Message')).toHaveClass('resize-none');
  });
});