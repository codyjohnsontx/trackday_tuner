import { HTMLAttributes } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const cardVariants = cva('rounded-2xl', {
  variants: {
    variant: {
      default: 'border border-zinc-800 bg-zinc-900/60',
      accent: 'border border-cyan-500/25 bg-cyan-400/5',
      dashed: 'border border-dashed border-zinc-700 bg-zinc-950/50',
      sunken: 'border border-zinc-800 bg-zinc-950',
    },
    padding: {
      none: '',
      sm: 'p-3',
      md: 'p-4',
      lg: 'p-6',
    },
  },
  defaultVariants: {
    variant: 'default',
    padding: 'md',
  },
});

type CardVariant = 'default' | 'accent' | 'dashed' | 'sunken';
type CardPadding = 'sm' | 'md' | 'lg' | 'none';

interface CardProps extends HTMLAttributes<HTMLElement>, VariantProps<typeof cardVariants> {
  variant?: CardVariant;
  padding?: CardPadding;
  as?: 'div' | 'section' | 'article' | 'li';
}

export function Card({
  variant = 'default',
  padding = 'md',
  as: Tag = 'div',
  className,
  children,
  ...props
}: CardProps) {
  return (
    <Tag className={cn(cardVariants({ variant, padding }), className)} {...props}>
      {children}
    </Tag>
  );
}
