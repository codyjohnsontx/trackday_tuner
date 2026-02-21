import { InputHTMLAttributes } from 'react';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
}

export function Input({ id, label, className = '', ...props }: InputProps) {
  const inputId = id ?? label.toLowerCase().replace(/\s+/g, '_');

  return (
    <label htmlFor={inputId} className="block space-y-2">
      <span className="text-sm font-medium text-zinc-200">{label}</span>
      <input
        id={inputId}
        className={`w-full rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-3 text-base text-zinc-100 placeholder:text-zinc-500 ${className}`.trim()}
        {...props}
      />
    </label>
  );
}
