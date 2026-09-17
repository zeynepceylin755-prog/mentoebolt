import { type ReactNode } from 'react';
import { FolderOpen, BookOpen, TrendingUp, AlertCircle } from 'lucide-react';

type EmptyStateType = 'default' | 'questions' | 'progress' | 'errors';

interface EmptyStateProps {
  type?: EmptyStateType;
  title: string;
  description: string;
  action?: {
    label: string;
    onClick: () => void;
  };
  icon?: ReactNode;
}

const iconMap: Record<EmptyStateType, ReactNode> = {
  default: <FolderOpen className="h-12 w-12 text-muted/40" />,
  questions: <BookOpen className="h-12 w-12 text-muted/40" />,
  progress: <TrendingUp className="h-12 w-12 text-muted/40" />,
  errors: <AlertCircle className="h-12 w-12 text-muted/40" />,
};

export default function EmptyState({ type = 'default', title, description, action, icon }: EmptyStateProps) {
  const displayIcon = icon || iconMap[type];

  return (
    <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
      <div className="mb-6">{displayIcon}</div>
      <h2 className="font-sora text-section-title font-semibold tracking-tight text-ink mb-3">{title}</h2>
      <p className="text-body leading-relaxed text-muted max-w-md mb-8">{description}</p>
      {action && (
        <button
          onClick={action.onClick}
          className="rounded-lg bg-ink px-6 py-3 text-sm font-medium text-bg transition-all duration-200 hover:bg-accent hover:text-ink shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/20 focus-visible:ring-offset-2"
        >
          {action.label}
        </button>
      )}
    </div>
  );
}