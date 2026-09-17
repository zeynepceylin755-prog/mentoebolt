import { Loader2 } from 'lucide-react';

export type LoadingState = 'uploading' | 'analyzing' | 'processing' | 'loading';

interface LoadingProps {
  state?: LoadingState;
  message?: string;
  size?: 'sm' | 'md' | 'lg';
  /**
   * Optional ordered step labels. When provided the component renders a real
   * progress list (completed / current / pending) instead of an opaque spinner,
   * which is what makes a multi-second wait feel honest rather than stuck.
   */
  steps?: string[];
  activeStep?: number;
  /** @deprecated There is no fullscreen variant any more; loading renders in flow. */
  fullscreen?: boolean;
}

const stateMessages: Record<LoadingState, string> = {
  uploading: 'Soruyu okuyorum...',
  analyzing: 'Çözümünü inceliyorum...',
  processing: 'Nerede takıldığını buluyorum...',
  loading: 'Yükleniyor...',
};

const sizeStyles: Record<string, string> = {
  sm: 'h-4 w-4',
  md: 'h-6 w-6',
  lg: 'h-7 w-7',
};

/**
 * Loading presentation.
 *
 * There is deliberately no fullscreen scrim: blocking the whole viewport behind
 * a translucent overlay is disorienting on mobile and hides the context the
 * student was just reading. Loading always renders in the page flow.
 *
 * The wrapper is an `aria-live` status region so assistive technology announces
 * the state change instead of silently swapping the page content.
 */
export default function Loading({
  state = 'loading',
  message,
  size = 'md',
  steps,
  activeStep = 0,
}: LoadingProps) {
  const displayMessage = message || stateMessages[state];

  if (steps && steps.length > 0) {
    return (
      <div
        className="mx-auto flex max-w-md flex-col items-center py-12 text-center sm:py-16"
        role="status"
        aria-live="polite"
      >
        <Loader2
          className={`animate-spin text-accent ${sizeStyles[size]}`}
          aria-hidden="true"
        />
        <h2 className="mt-5 font-sora text-card-title font-semibold text-ink">
          {displayMessage}
        </h2>

        <ol className="mt-7 w-full space-y-3 text-left">
          {steps.map((step, index) => {
            const isDone = index < activeStep;
            const isCurrent = index === activeStep;
            // The active step is already announced by the heading above, so it is
            // marked as decorative here to avoid duplicate screen-reader output.
            const duplicateOfHeading = isCurrent && step === displayMessage;

            return (
              <li
                key={step}
                className="flex items-center gap-3"
                aria-hidden={duplicateOfHeading ? 'true' : undefined}
              >
                <span
                  className={[
                    'flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-[11px] font-medium',
                    isDone
                      ? 'bg-success/15 text-success'
                      : isCurrent
                        ? 'bg-accent/15 text-accent'
                        : 'bg-surface text-muted',
                  ].join(' ')}
                  aria-hidden="true"
                >
                  {isDone ? '✓' : index + 1}
                </span>
                <span
                  className={[
                    'text-body-sm',
                    isCurrent ? 'text-ink' : isDone ? 'text-muted' : 'text-muted/70',
                  ].join(' ')}
                >
                  {step}
                  {isCurrent && <span className="sr-only"> (şu anda)</span>}
                  {isDone && <span className="sr-only"> (tamamlandı)</span>}
                </span>
              </li>
            );
          })}
        </ol>
      </div>
    );
  }

  return (
    <div
      className="flex flex-col items-center justify-center gap-4 py-10"
      role="status"
      aria-live="polite"
    >
      <Loader2
        className={`animate-spin text-accent ${sizeStyles[size]}`}
        aria-hidden="true"
      />
      {displayMessage && (
        <p className="text-body leading-relaxed text-muted">{displayMessage}</p>
      )}
    </div>
  );
}