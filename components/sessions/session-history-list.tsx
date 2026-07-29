'use client';

import Link from 'next/link';
import { ChevronDown, ExternalLink } from 'lucide-react';
import { useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { DataPlate } from '@/components/ui/condition';
import { Eyebrow } from '@/components/ui/surface';
import { buildSessionHistorySummary } from '@/lib/session-history';
import { cn } from '@/lib/utils';
import type { Session, SessionEnvironment } from '@/types';

export interface SessionHistoryListItem {
  session: Session;
  vehicleNickname: string;
  environment: SessionEnvironment | null;
}

interface SessionHistoryListProps {
  items: SessionHistoryListItem[];
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <span className="text-sm text-ink-faint">{label}</span>
      <span className="text-right text-sm font-medium text-ink">{value}</span>
    </div>
  );
}

export function SessionHistoryList({ items }: SessionHistoryListProps) {
  const [openSessionId, setOpenSessionId] = useState<string | null>(null);
  const listId = useId();

  return (
    <ul className="space-y-3">
      {items.map(({ session, vehicleNickname, environment }) => {
        const summary = buildSessionHistorySummary(session, environment);
        const isOpen = openSessionId === session.id;
        const contentId = `${listId}-${session.id}`;

        return (
          <li
            key={session.id}
            className={cn(
              'overflow-hidden rounded-card border bg-surface transition',
              isOpen ? 'border-signal/30' : 'border-white/5',
            )}
          >
            <button
              type="button"
              aria-expanded={isOpen}
              aria-controls={contentId}
              onClick={() => setOpenSessionId((current) => (current === session.id ? null : session.id))}
              className="flex w-full items-center justify-between gap-3 px-4 py-4 text-left transition hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal/80"
            >
              <div className="min-w-0 flex-1">
                <Eyebrow>
                  {summary.dateLabel}
                  {summary.timeLabel ? ` · ${summary.timeLabel}` : ''}
                </Eyebrow>
                <p className="mt-1.5 truncate font-semibold text-ink">
                  {session.track_name ?? 'Unknown Track'}
                </p>
                <p className="mt-0.5 truncate text-sm text-ink-dim">{vehicleNickname}</p>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                {/* Same plate as the dashboard rows — one session reads the same
                    way wherever it appears. The ring matches this card's fill. */}
                <DataPlate
                  value={session.session_number ? `S${session.session_number}` : null}
                  condition={session.conditions}
                  ringClass="ring-surface"
                />
                <span
                  className={cn(
                    'inline-flex min-h-10 min-w-10 items-center justify-center rounded-plate bg-surface-3 text-ink-dim transition',
                    isOpen ? 'text-signal' : 'text-ink-dim',
                  )}
                  aria-hidden="true"
                >
                  <ChevronDown className={cn('h-4 w-4 transition-transform', isOpen ? 'rotate-180' : '')} />
                </span>
              </div>
            </button>

            <div
              id={contentId}
              hidden={!isOpen}
              className="border-t border-white/5 px-4 py-4"
            >
              <div className="grid gap-4 md:grid-cols-2">
                <section className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-wider text-ink-faint">
                    Quick Summary
                  </p>
                  <div className="divide-y divide-white/5 rounded-row bg-surface-3 px-3">
                    <SummaryRow label="Condition" value={summary.conditionLabel} />
                    <SummaryRow label="Front Tire" value={summary.tireRows[0]?.value ?? 'Not logged'} />
                    <SummaryRow label="Rear Tire" value={summary.tireRows[1]?.value ?? 'Not logged'} />
                    <SummaryRow label="Front Susp." value={summary.suspensionRows[0]?.value ?? 'Not logged'} />
                    <SummaryRow label="Rear Susp." value={summary.suspensionRows[1]?.value ?? 'Not logged'} />
                  </div>
                </section>

                <section className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-wider text-ink-faint">
                    Environment
                  </p>
                  {summary.environmentRows.length > 0 ? (
                    <div className="divide-y divide-white/5 rounded-row bg-surface-3 px-3">
                      {summary.environmentRows.map((row) => (
                        <SummaryRow key={row.label} label={row.label} value={row.value} />
                      ))}
                    </div>
                  ) : (
                    <div className="rounded-row border border-dashed border-white/5 bg-canvas px-3 py-3 text-sm text-ink-faint">
                      No environment snapshot logged.
                    </div>
                  )}
                </section>
              </div>

              <section className="mt-4 space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wider text-ink-faint">Notes</p>
                <div className="rounded-row bg-surface-3 px-3 py-3 text-sm text-ink-dim">
                  {summary.notesPreview ?? 'No notes logged for this session.'}
                </div>
              </section>

              <div className="mt-4">
                <Button asChild variant="secondary" className="w-full justify-center gap-2 sm:w-auto">
                  <Link href={`/sessions/${session.id}`}>
                    <ExternalLink className="h-4 w-4" aria-hidden />
                    Open Full Session
                  </Link>
                </Button>
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
