import { InputHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string;
  helperText?: string;
}

export function Input({ id, label, error, helperText, className, ...props }: InputProps) {
  const inputId = id ?? label.toLowerCase().replace(/\s+/g, '_');
  const descId = error ? `${inputId}-error` : helperText ? `${inputId}-helper` : undefined;

  return (
    <label htmlFor={inputId} className="block space-y-2">
      <span className="text-sm font-medium text-zinc-200">{label}</span>
      <input
        id={inputId}
        aria-describedby={descId}
        aria-invalid={error ? 'true' : undefined}
        className={cn(
          'flex w-full rounded-xl border bg-zinc-900 px-4 py-3 text-base text-zinc-100 placeholder:text-zinc-500 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/80 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 disabled:cursor-not-allowed disabled:opacity-50',
          error ? 'border-rose-600' : 'border-zinc-700',
          className
        )}
        {...props}
      />
      {error && (
        <p id={`${inputId}-error`} className="text-xs text-rose-400">
          {error}
        </p>
      )}
      {!error && helperText && (
        <p id={`${inputId}-helper`} className="text-xs text-zinc-500">
          {helperText}
        </p>
      )}
    </label>
  );
}
