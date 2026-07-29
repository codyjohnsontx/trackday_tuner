import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * Shared so sub-pages that build their own header row (a back link, a title,
 * and an action) still land on the same display treatment as `PageHeader`.
 */
export const pageTitleClass =
  'font-display text-[2.125rem] leading-[1.1] tracking-[-0.01em] text-ink';

interface PageHeaderProps {
  title: string;
  /**
   * A trailing word carried at the same size but in faint ink. Use it when a
   * screen has a natural pair ("Sessions History", "Track Library") — the
   * contrast does the work a subtitle would otherwise have to.
   */
  muted?: string;
  sub?: ReactNode;
  action?: ReactNode;
  className?: string;
}

/**
 * The only serif on any screen. It marks where a page begins, which is why no
 * card or row is allowed to use the display face — if everything is editorial,
 * nothing is.
 */
export function PageHeader({ title, muted, sub, action, className }: PageHeaderProps) {
  return (
    <header className={cn('flex items-start justify-between gap-4 px-1', className)}>
      <div className="min-w-0">
        <h1 className={pageTitleClass}>
          {title}
          {muted ? <span className="text-ink-faint"> {muted}</span> : null}
        </h1>
        {sub ? <p className="mt-1.5 text-sm text-ink-dim">{sub}</p> : null}
      </div>
      {action ? <div className="shrink-0 pt-1">{action}</div> : null}
    </header>
  );
}
