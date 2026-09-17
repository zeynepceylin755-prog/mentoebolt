import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import Card, { CardHeader, CardContent, CardFooter } from './Card';

describe('Card Component', () => {
  it('renders children correctly', () => {
    render(<Card>Card content</Card>);
    expect(screen.getByText('Card content')).toBeInTheDocument();
  });

  it('applies default variant styles', () => {
    render(<Card>Default</Card>);
    const card = screen.getByText('Default').closest('.rounded-lg');
    expect(card).toHaveClass('shadow-soft');
  });

  it('applies bordered variant', () => {
    render(<Card variant="bordered">Bordered</Card>);
    const card = screen.getByText('Bordered').closest('.rounded-lg');
    expect(card).toHaveClass('border', 'border-border', 'shadow-soft');
  });

  it('applies elevated variant', () => {
    render(<Card variant="elevated">Elevated</Card>);
    const card = screen.getByText('Elevated').closest('.rounded-lg');
    expect(card).toHaveClass('shadow-elevated');
  });

  it('applies custom className', () => {
    render(<Card className="custom-card">Custom</Card>);
    const card = screen.getByText('Custom').closest('.rounded-lg');
    expect(card).toHaveClass('custom-card');
  });

  it('renders with custom role', () => {
    render(<Card role="article">Article</Card>);
    const card = screen.getByText('Article').closest('.rounded-lg');
    expect(card).toHaveAttribute('role', 'article');
  });
});

describe('CardHeader Component', () => {
  it('renders children correctly', () => {
    render(<CardHeader>Header content</CardHeader>);
    expect(screen.getByText('Header content')).toBeInTheDocument();
  });

  it('applies header styles', () => {
    render(<CardHeader>Header</CardHeader>);
    const header = screen.getByText('Header').closest('.px-6');
    expect(header).toHaveClass('border-b', 'border-border');
  });
});

describe('CardContent Component', () => {
  it('renders children correctly', () => {
    render(<CardContent>Content</CardContent>);
    expect(screen.getByText('Content')).toBeInTheDocument();
  });

  it('applies content padding', () => {
    render(<CardContent>Content</CardContent>);
    const content = screen.getByText('Content').closest('.p-6');
    expect(content).toBeInTheDocument();
  });
});

describe('CardFooter Component', () => {
  it('renders children correctly', () => {
    render(<CardFooter>Footer</CardFooter>);
    expect(screen.getByText('Footer')).toBeInTheDocument();
  });

  it('applies footer styles', () => {
    render(<CardFooter>Footer</CardFooter>);
    const footer = screen.getByText('Footer').closest('.px-6');
    expect(footer).toHaveClass('border-t', 'border-border');
  });
});