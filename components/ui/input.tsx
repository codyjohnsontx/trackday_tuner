import { InputHTMLAttributes } from 'react';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string;
  helperText?: string;
}

export function Input({ id, label, error, helperText, className = '', ...props }: InputProps) {
  const inputId = id ?? label.toLowerCase().replace(/\s+/g, '_');
  const descId = error ? `${inputId}-error` : helperText ? `${inputId}-helper` : undefined;

  return (
    <label htmlFor={inputId} className="block space-y-2">
      <span className="text-sm font-medium text-zinc-200">{label}</span>
      <input
        id={inputId}
        aria-describedby={descId}
        aria-invalid={error ? 'true' : undefined}
        className={`w-full rounded-xl border ${error ? 'border-rose-600' : 'border-zinc-700'} bg-zinc-900 px-4 py-3 text-base text-zinc-100 placeholder:text-zinc-500 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/80 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 ${className}`.trim()}
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
