import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function truncateAtWordBoundary(text: string, max: number): string {
  if (text.length <= max) return text;
  const window = text.slice(0, max);
  const boundary = Math.max(
    window.lastIndexOf(' '),
    window.lastIndexOf('\n'),
    window.lastIndexOf('.'),
    window.lastIndexOf(','),
    window.lastIndexOf(';'),
  );
  const cut = boundary > max * 0.6 ? window.slice(0, boundary).trimEnd() : window.trimEnd();
  return `${cut}\u2026`;
}
