import { type InputHTMLAttributes, type TextareaHTMLAttributes, forwardRef } from 'react';

interface BaseInputProps {
  label?: string;
  error?: string;
  helperText?: string;
  required?: boolean;
}

interface InputProps extends BaseInputProps, InputHTMLAttributes<HTMLInputElement> {
  multiline?: never;
  rows?: never;
}

interface TextareaProps extends BaseInputProps, TextareaHTMLAttributes<HTMLTextAreaElement> {
  multiline?: true;
  rows?: number;
}

const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, helperText, required, className = '', id, ...props }, ref) => {
    const inputId = id || `input-${Math.random().toString(36).substr(2, 9)}`;
    const errorId = error ? `${inputId}-error` : undefined;
    const helperId = helperText ? `${inputId}-helper` : undefined;

    return (
      <div className="space-y-2">
        {label && (
          <label
            htmlFor={inputId}
            className="block text-sm font-medium text-muted"
          >
            {label}
            {required && <span className="text-accent ml-1" aria-label="zorunlu">*</span>}
          </label>
        )}
        <input
          ref={ref}
          id={inputId}
          className={`w-full rounded-lg border border-border bg-bg px-4 py-2.5 text-sm text-ink outline-none transition-colors placeholder:text-muted/50 focus:border-accent focus:ring-2 focus:ring-accent/20 focus:ring-offset-2 focus-visible:ring-2 focus-visible:ring-accent/20 focus-visible:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed ${
            error ? 'border-accent focus:border-accent focus:ring-accent/20' : ''
          } ${className}`}
          aria-invalid={error ? 'true' : 'false'}
          aria-describedby={[errorId, helperId].filter(Boolean).join(' ') || undefined}
          aria-required={required}
          {...props}
        />
        {error && (
          <p id={errorId} className="text-sm text-accent" role="alert">
            {error}
          </p>
        )}
        {helperText && !error && (
          <p id={helperId} className="text-sm text-muted">
            {helperText}
          </p>
        )}
      </div>
    );
  }
);

const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ label, error, helperText, required, className = '', id, rows = 3, ...props }, ref) => {
    const inputId = id || `textarea-${Math.random().toString(36).substr(2, 9)}`;
    const errorId = error ? `${inputId}-error` : undefined;
    const helperId = helperText ? `${inputId}-helper` : undefined;

    return (
      <div className="space-y-2">
        {label && (
          <label
            htmlFor={inputId}
            className="block text-sm font-medium text-muted"
          >
            {label}
            {required && <span className="text-accent ml-1" aria-label="zorunlu">*</span>}
          </label>
        )}
        <textarea
          ref={ref}
          id={inputId}
          rows={rows}
          className={`w-full rounded-lg border border-border bg-bg px-4 py-2.5 text-sm text-ink outline-none transition-colors placeholder:text-muted/50 focus:border-accent focus:ring-2 focus:ring-accent/20 focus:ring-offset-2 focus-visible:ring-2 focus-visible:ring-accent/20 focus-visible:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed resize-none ${
            error ? 'border-accent focus:border-accent focus:ring-accent/20' : ''
          } ${className}`}
          aria-invalid={error ? 'true' : 'false'}
          aria-describedby={[errorId, helperId].filter(Boolean).join(' ') || undefined}
          aria-required={required}
          {...props}
        />
        {error && (
          <p id={errorId} className="text-sm text-accent" role="alert">
            {error}
          </p>
        )}
        {helperText && !error && (
          <p id={helperId} className="text-sm text-muted">
            {helperText}
          </p>
        )}
      </div>
    );
  }
);

Input.displayName = 'Input';
Textarea.displayName = 'Textarea';

export default Input;
export { Textarea };