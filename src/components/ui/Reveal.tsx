import { type ReactNode } from 'react';
import { useReveal } from '@/hooks/useReveal';

type RevealProps = {
  children: ReactNode;
  className?: string;
  delay?: 1 | 2 | 3 | 4;
  as?: 'div' | 'section' | 'article' | 'li' | 'span';
};

export default function Reveal({ children, className = '', delay, as = 'div' }: RevealProps) {
  const { ref, isVisible } = useReveal();
  const delayClass = delay ? `reveal-delay-${delay}` : '';
  const Tag = as;

  return (
    <Tag
      ref={ref as never}
      className={`reveal ${delayClass} ${isVisible ? 'is-visible' : ''} ${className}`}
    >
      {children}
    </Tag>
  );
}
