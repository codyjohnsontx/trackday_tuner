import { HTMLAttributes } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center rounded-lg px-2 py-1 text-xs font-semibold uppercase tracking-wide',
  {
    variants: {
      variant: {
        default: 'border border-zinc-700 bg-zinc-900 text-zinc-300',
        accent: 'border border-cyan-500/30 bg-cyan-400/10 text-cyan-300',
        success: 'border border-emerald-700/40 bg-emerald-950/40 text-emerald-300',
        warning: 'border border-amber-700/40 bg-amber-950/40 text-amber-300',
        error: 'border border-rose-700/40 bg-rose-950/40 text-rose-300',
        info: 'border border-blue-700/40 bg-blue-950/40 text-blue-300',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
);

type BadgeVariant = 'default' | 'accent' | 'success' | 'warning' | 'error' | 'info';

interface BadgeProps extends HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {
  variant?: BadgeVariant;
}

export function Badge({ variant = 'default', className, children, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ variant }), className)} {...props}>
      {children}
    </span>
  );
}
