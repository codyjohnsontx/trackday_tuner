'use client';

import { ReactNode } from 'react';
import * as ToggleGroup from '@radix-ui/react-toggle-group';
import { cn } from '@/lib/utils';

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
  className,
}: SegmentedControlProps<T>) {
  return (
    <ToggleGroup.Root
      type="single"
      value={value}
      onValueChange={(v) => {
        if (v) onChange(v as T);
      }}
      aria-label={name}
      className={cn('grid gap-1 rounded-xl bg-zinc-950 p-1', className)}
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      {options.map((option) => (
        <ToggleGroup.Item
          key={option.value}
          value={option.value}
          aria-label={option.ariaLabel}
          className={cn(
            'rounded-lg py-2 px-2 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/80',
            'data-[state=on]:bg-cyan-400 data-[state=on]:text-zinc-950',
            'text-zinc-400 hover:text-zinc-200'
          )}
        >
          {option.label}
        </ToggleGroup.Item>
      ))}
    </ToggleGroup.Root>
  );
}
