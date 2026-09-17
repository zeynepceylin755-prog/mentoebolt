import { AlertCircle, RefreshCw } from 'lucide-react';

interface ErrorStateProps {
  title?: string;
  message: string;
  onRetry?: () => void;
  variant?: 'default' | 'network' | 'auth';
}

const variantStyles: Record<string, { title: string; icon: string }> = {
  default: {
    title: 'Bir sorun oluştu',
    icon: 'text-accent',
  },
  network: {
    title: 'Bağlantı hatası',
    icon: 'text-accent',
  },
  auth: {
    title: 'Oturum hatası',
    icon: 'text-accent',
  },
};

export default function ErrorState({ title, message, onRetry, variant = 'default' }: ErrorStateProps) {
  const styles = variantStyles[variant];
  const displayTitle = title || styles.title;

  return (
    <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
      <div className={`mb-6 ${styles.icon}`}>
        <AlertCircle className="h-12 w-12" />
      </div>
      <h3 className="font-sora text-section-title font-semibold tracking-tight text-ink mb-3">{displayTitle}</h3>
      <p className="text-body leading-relaxed text-muted max-w-md mb-8">{message}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="inline-flex items-center gap-2 rounded-lg border border-border bg-surface px-6 py-3 text-sm font-medium text-ink transition-all duration-200 hover:border-accent hover:bg-accent/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/20 focus-visible:ring-offset-2"
        >
          <RefreshCw className="h-4 w-4" aria-hidden="true" />
          Tekrar dene
        </button>
      )}
    </div>
  );
}