import type { ComponentType, ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * Surface primitives.
 *
 * Separation comes from the lightness ramp in globals.css, not from borders,
 * so these components exist mainly to keep the ramp honest: a `Card` sits on
 * the canvas, a `GroupRow` sits inside a `Card`, and nothing nests deeper than
 * that. If a screen needs a third level, it needs fewer levels instead.
 */

interface CardProps {
  children: ReactNode;
  className?: string;
}

/** A borderless raised panel sitting directly on the canvas. */
export function Card({ children, className }: CardProps) {
  return <div className={cn('rounded-card bg-surface p-5', className)}>{children}</div>;
}

interface EyebrowProps {
  children: ReactNode;
  /** Lucide icon rendered at the start of the label. */
  icon?: ComponentType<{ className?: string }>;
  className?: string;
}

/**
 * The small uppercase label that names what follows. Deliberately quiet —
 * it is scaffolding for the eye, not content.
 */
export function Eyebrow({ children, icon: Icon, className }: EyebrowProps) {
  return (
    <span
      className={cn(
        'flex items-center gap-1.5 text-[0.6875rem] font-semibold uppercase tracking-[0.14em] text-ink-faint',
        className,
      )}
    >
      {Icon ? <Icon className="h-3.5 w-3.5 shrink-0" /> : null}
      {children}
    </span>
  );
}

interface CardGroupProps {
  /** Quiet label above the group title. */
  eyebrow?: ReactNode;
  /** The group's name, in sans — page titles are the only serif on screen. */
  title?: ReactNode;
  icon?: ComponentType<{ className?: string }>;
  /** Rendered at the trailing edge of the header, e.g. a "View all" link. */
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}

/**
 * A labelled container whose children are individually raised rows. This is
 * the workhorse layout: it lets a screen carry several unrelated blocks
 * without a single divider line.
 */
export function CardGroup({
  eyebrow,
  title,
  icon: Icon,
  action,
  children,
  className,
}: CardGroupProps) {
  const hasHeader = Boolean(eyebrow || title || action);

  return (
    <section className={cn('rounded-card bg-surface p-2', className)}>
      {hasHeader ? (
        <div className="flex items-start justify-between gap-3 px-3 pb-1 pt-3">
          <div className="flex min-w-0 items-start gap-2.5">
            {Icon ? <Icon className="mt-0.5 h-4 w-4 shrink-0 text-signal" /> : null}
            <div className="min-w-0">
              {eyebrow ? <Eyebrow>{eyebrow}</Eyebrow> : null}
              {title ? (
                <h2 className="mt-1 truncate text-base font-semibold text-ink">{title}</h2>
              ) : null}
            </div>
          </div>
          {action ? <div className="shrink-0">{action}</div> : null}
        </div>
      ) : null}
      <div className="space-y-2 p-1">{children}</div>
    </section>
  );
}

interface GroupRowProps {
  children: ReactNode;
  className?: string;
}

/** A raised row inside a `CardGroup`. */
export function GroupRow({ children, className }: GroupRowProps) {
  return <div className={cn('rounded-row bg-surface-2 p-4', className)}>{children}</div>;
}

interface SectionHeaderProps {
  children: ReactNode;
  action?: ReactNode;
  className?: string;
}

/**
 * Names a run of cards that are siblings on the canvas rather than nested in
 * a group. Baseline-aligned with its action so the two do not drift apart the
 * way an uppercase label and a sentence-case link otherwise would.
 */
export function SectionHeader({ children, action, className }: SectionHeaderProps) {
  return (
    <div className={cn('flex items-baseline justify-between gap-3 px-1', className)}>
      <Eyebrow>{children}</Eyebrow>
      {action ? <div className="shrink-0 text-sm">{action}</div> : null}
    </div>
  );
}
