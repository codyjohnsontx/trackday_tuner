import { TextareaHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: string;
  error?: string;
  helperText?: string;
}

export function Textarea({ id, label, error, helperText, className, ...props }: TextareaProps) {
  const textareaId = id ?? label.toLowerCase().replace(/\s+/g, '_');
  const descId = error ? `${textareaId}-error` : helperText ? `${textareaId}-helper` : undefined;

  return (
    <label htmlFor={textareaId} className="block space-y-2">
      <span className="text-sm font-medium text-zinc-200">{label}</span>
      <textarea
        id={textareaId}
        aria-describedby={descId}
        aria-invalid={error ? 'true' : undefined}
        className={cn(
          'flex w-full rounded-xl border bg-zinc-900 px-4 py-3 text-sm text-zinc-100 placeholder:text-zinc-500 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/80 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 resize-none disabled:cursor-not-allowed disabled:opacity-50',
          error ? 'border-rose-600' : 'border-zinc-700',
          className
        )}
        {...props}
      />
      {error && (
        <p id={`${textareaId}-error`} className="text-xs text-rose-400">
          {error}
        </p>
      )}
      {!error && helperText && (
        <p id={`${textareaId}-helper`} className="text-xs text-zinc-500">
          {helperText}
        </p>
      )}
    </label>
  );
}
