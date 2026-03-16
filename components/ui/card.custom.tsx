import { HTMLAttributes } from 'react';

type CardVariant = 'default' | 'accent' | 'dashed' | 'sunken';
type CardPadding = 'sm' | 'md' | 'lg' | 'none';

interface CardProps extends HTMLAttributes<HTMLElement> {
  variant?: CardVariant;
  padding?: CardPadding;
  as?: 'div' | 'section' | 'article' | 'li';
}

const variantClassMap: Record<CardVariant, string> = {
  default: 'border border-zinc-800 bg-zinc-900/60',
  accent: 'border border-cyan-500/25 bg-cyan-400/5',
  dashed: 'border border-dashed border-zinc-700 bg-zinc-950/50',
  sunken: 'border border-zinc-800 bg-zinc-950',
};

const paddingClassMap: Record<CardPadding, string> = {
  none: '',
  sm: 'p-3',
  md: 'p-4',
  lg: 'p-6',
};

export function Card({
  variant = 'default',
  padding = 'md',
  as: Tag = 'div',
  className = '',
  children,
  ...props
}: CardProps) {
  return (
    <Tag
      className={`rounded-2xl ${variantClassMap[variant]} ${paddingClassMap[padding]} ${className}`.trim()}
      {...props}
    >
      {children}
    </Tag>
  );
}
