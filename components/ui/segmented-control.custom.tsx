'use client';

import { ReactNode } from 'react';

interface SegmentOption<T extends string> {
  value: T;
  label: ReactNode;
  ariaLabel?: string;
}

interface SegmentedControlProps<T extends string> {
  options: SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  name: string;
  className?: string;
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  name,
  className = '',
}: SegmentedControlProps<T>) {
  return (
    <div
      role="radiogroup"
      aria-label={name}
      className={`grid gap-1 rounded-xl bg-zinc-950 p-1 ${className}`.trim()}
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          aria-label={option.ariaLabel}
          onClick={() => onChange(option.value)}
          className={`rounded-lg py-2 px-2 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/80 ${
            value === option.value
              ? 'bg-cyan-400 text-zinc-950'
              : 'text-zinc-400 hover:text-zinc-200'
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
