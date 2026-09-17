import { type ReactNode } from 'react';

/**
 * Page header — the single typography entry point for every product page.
 *
 * It exists so that the eyebrow / title / lead hierarchy can never drift between
 * pages: the spacing, sizes and colours are defined once here.
 */
interface PageHeaderProps {
  /** Small uppercase context label, e.g. "Bugün". */
  eyebrow?: string;
  title: string;
  /** Optional supporting sentence shown under the title. */
  lead?: string;
  /** Optional right-aligned slot (a single primary action at most). */
  action?: ReactNode;
  className?: string;
}

export default function PageHeader({
  eyebrow,
  title,
  lead,
  action,
  className = '',
}: PageHeaderProps) {
  return (
    <header className={`mb-8 sm:mb-10 ${className}`}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          {eyebrow && (
            <p className="editorial-kicker">
              {eyebrow}
            </p>
          )}
          <h1 className="mt-4 font-display text-[2.35rem] font-medium leading-[1.08] tracking-tight text-ink sm:text-[3rem]">
            {title}
          </h1>
          {lead && (
            <p className="mt-4 max-w-2xl text-base leading-relaxed text-muted sm:text-lg">{lead}</p>
          )}
        </div>
        {action && <div className="flex-shrink-0">{action}</div>}
      </div>
    </header>
  );
}
