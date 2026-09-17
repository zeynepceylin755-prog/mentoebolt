import { type ReactNode } from 'react';

/**
 * The product page container.
 *
 * Every authenticated page renders inside this so the horizontal rhythm, the
 * bottom-navigation clearance on mobile and the max line length are identical
 * across the product. It is deliberately plain: a `<section>` with a tuned
 * padding/max-width pair, not a card.
 */
interface PageContainerProps {
  children: ReactNode;
  /** Renders a tighter vertical rhythm for dense pages. */
  size?: 'default' | 'narrow';
  className?: string;
}

export default function PageContainer({
  children,
  size = 'default',
  className = '',
}: PageContainerProps) {
  const width = size === 'narrow' ? 'max-w-3xl' : 'max-w-content';

  return (
    <section className={`px-5 py-10 sm:px-8 sm:py-14 lg:px-12 lg:py-16 ${className}`}>
      <div className={`mx-auto ${width}`}>{children}</div>
    </section>
  );
}
