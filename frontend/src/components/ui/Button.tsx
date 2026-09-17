import { type ReactNode, type ButtonHTMLAttributes } from 'react';
import { Loader2 } from 'lucide-react';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /**
   * Which surface the button sits on. `onInk` is the inverted treatment used on
   * the dark closing band of the public landing page; everything inside the
   * student product keeps the default tone.
   */
  tone?: 'default' | 'onInk';
  loading?: boolean;
  fullWidth?: boolean;
  children: ReactNode;
}

const variantStyles: Record<ButtonVariant, string> = {
  // Disabled states are explicit rather than a low-opacity dark fill: the
  // primary button on "Soru Getir" starts disabled, and a muddy block there
  // reads as broken rather than as "not yet".
  primary:
    'bg-ink bg-terracotta text-bg shadow-sm hover:bg-terracotta-dark disabled:bg-surface disabled:text-muted disabled:shadow-none',
  secondary:
    'bg-surface text-ink border-border hover:border-accent hover:bg-accent/5 disabled:text-muted disabled:border-border',
  ghost: 'text-nav hover:text-ink hover:bg-surface disabled:text-muted',
  danger:
    'bg-accent/10 text-accent border-accent/20 hover:bg-accent hover:text-ink disabled:bg-surface disabled:text-muted disabled:border-border',
};

const sizeStyles: Record<ButtonSize, string> = {
  sm: 'px-4 py-2 text-sm min-h-[40px]',
  md: 'px-5 py-2.5 text-sm min-h-[44px]',
  lg: 'px-6 py-3 text-base min-h-[48px]',
};

const toneStyles: Record<'default' | 'onInk', string> = {
  default: '',
  // On the landing page's deep-ink band the same button must invert: an ivory
  // fill with ink text, warming slightly to the sage accent on hover.
  onInk: 'bg-bg text-ink hover:bg-card hover:text-ink focus-visible:ring-bg/60 focus-visible:ring-offset-ink',
};

export default function Button({
  variant = 'primary',
  size = 'md',
  tone = 'default',
  loading = false,
  fullWidth = false,
  disabled,
  children,
  className = '',
  ...props
}: ButtonProps) {
  // A disabled primary button is the first thing a student sees on "Soru Getir",
  // so it must still read as a real, deliberate state rather than a muddy fill.
  // The tinted surface + muted text keeps it legible and clearly inert without
  // relying on a low-opacity dark block.
  const baseStyles =
    'inline-flex items-center justify-center gap-2 rounded-full font-medium transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:ring-offset-2 disabled:cursor-not-allowed';
  const widthClass = fullWidth ? 'w-full' : '';
  const toneClass = tone === 'onInk' ? toneStyles.onInk : toneStyles.default;

  return (
    <button
      className={`${baseStyles} ${toneClass} ${variantStyles[variant]} ${sizeStyles[size]} ${widthClass} ${className}`}
      disabled={disabled || loading}
      aria-busy={loading}
      aria-disabled={disabled || loading}
      {...props}
    >
      {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
      {children}
    </button>
  );
}