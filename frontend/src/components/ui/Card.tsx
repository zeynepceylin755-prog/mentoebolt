import { type ReactNode } from 'react';

interface CardProps {
  children: ReactNode;
  className?: string;
  variant?: 'default' | 'elevated' | 'bordered';
  role?: string;
}

const variantStyles: Record<string, string> = {
  default: 'bg-card shadow-soft',
  elevated: 'bg-card shadow-elevated shadow-[0_2px_24px_rgba(23,23,23,0.06)]',
  bordered: 'bg-card border border-border shadow-soft',
};

export default function Card({ children, className = '', variant = 'default', role }: CardProps) {
  return (
    <div className={`rounded-lg ${variantStyles[variant]} ${className}`} role={role}>
      {children}
    </div>
  );
}

export function CardHeader({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`px-6 py-4 border-b border-border ${className}`}>{children}</div>;
}

export function CardContent({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`p-6 ${className}`}>{children}</div>;
}

export function CardFooter({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`px-6 py-4 border-t border-border ${className}`}>{children}</div>;
}