import { InputHTMLAttributes } from 'react';
import { cva } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const inputVariants = cva(
  // Fields are surfaces, not outlines: the fill is what says "you can type
  // here". A ring appears only for the error and focus states, where a border
  // is carrying real information.
  'flex w-full rounded-row bg-surface-2 px-4 py-3 text-base text-ink placeholder:text-ink-faint transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal/80 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas disabled:cursor-not-allowed disabled:opacity-50',
  {
    variants: {
      error: {
        true: 'ring-2 ring-slower/70',
        false: '',
      },
    },
    defaultVariants: {
      error: false,
    },
  },
);

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string;
  helperText?: string;
}

export function Input({ id, label, error, helperText, className, ...props }: InputProps) {
  const inputId = id ?? label.toLowerCase().replace(/\s+/g, '_');
  const descId = error ? `${inputId}-error` : helperText ? `${inputId}-helper` : undefined;
  const { 'aria-describedby': ariaDescribedBy, ...inputProps } = props;
  const finalDescId = [ariaDescribedBy, descId].filter(Boolean).join(' ') || undefined;

  return (
    <label htmlFor={inputId} className="block space-y-2">
      <span className="text-sm font-medium text-ink-dim">{label}</span>
      <input
        id={inputId}
        aria-describedby={finalDescId}
        aria-invalid={error ? 'true' : undefined}
        className={cn(inputVariants({ error: Boolean(error) }), className)}
        {...inputProps}
      />
      {error && (
        <p id={`${inputId}-error`} className="text-xs text-slower">
          {error}
        </p>
      )}
      {!error && helperText && (
        <p id={`${inputId}-helper`} className="text-xs text-ink-faint">
          {helperText}
        </p>
      )}
    </label>
  );
}
