import { SelectHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: string;
  error?: string;
  helperText?: string;
}

export function Select({ id, label, error, helperText, className, children, ...props }: SelectProps) {
  const selectId = id ?? label.toLowerCase().replace(/\s+/g, '_');
  const descId = error ? `${selectId}-error` : helperText ? `${selectId}-helper` : undefined;

  return (
    <label htmlFor={selectId} className="block space-y-2">
      <span className="text-sm font-medium text-zinc-200">{label}</span>
      <select
        id={selectId}
        aria-describedby={descId}
        aria-invalid={error ? 'true' : undefined}
        className={cn(
          'w-full rounded-xl border bg-zinc-900 px-4 py-3 text-sm text-zinc-100 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/80 focus-visible:ring-offset-0',
          error ? 'border-rose-600' : 'border-zinc-700',
          className
        )}
        {...props}
      >
        {children}
      </select>
      {error && (
        <p id={`${selectId}-error`} className="text-xs text-rose-400">
          {error}
        </p>
      )}
      {!error && helperText && (
        <p id={`${selectId}-helper`} className="text-xs text-zinc-500">
          {helperText}
        </p>
      )}
    </label>
  );
}
