import type { SetupView } from '@/lib/setup-view';

/**
 * A stored setup as the rows a rider reads.
 *
 * This is the markup the session detail page owned inline, lifted so the
 * vehicle baseline can render the same rows rather than a second copy that
 * drifts. `buildSetupView` decides which rows exist; this decides only how they
 * look, and the two variants are the two places a setup is shown.
 */

interface SetupSectionsProps {
  view: SetupView;
  /**
   * `page` is the session detail page: one card per module on the page
   * background (`canvas` -> `surface`, `rounded-card`). `nested` is a setup
   * shown inside a row that is already on a card, so each module is one more
   * step down both ladders - `surface-2` -> `surface-3`, `rounded-row` ->
   * `rounded-plate` - because the ramp only ever moves one rung at a time.
   */
  variant?: 'page' | 'nested';
}

function SetupRowLine({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <span className="text-sm text-ink-dim">{label}</span>
      <span className="text-sm font-medium text-ink">{value || '—'}</span>
    </div>
  );
}

export function SetupSections({ view, variant = 'page' }: SetupSectionsProps) {
  const nested = variant === 'nested';

  return (
    <>
      {view.groups.map((group) => (
        <section
          key={group.key}
          className={nested ? 'rounded-plate bg-surface-3 p-3' : 'rounded-card bg-surface p-4'}
        >
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-ink-faint">{group.title}</h2>
          <div className="divide-y divide-white/5">
            {group.rows.map((row) => (
              <SetupRowLine key={row.label} label={row.label} value={row.value} />
            ))}
          </div>
        </section>
      ))}

      {view.notes ? (
        <section className={nested ? 'rounded-plate bg-surface-3 p-3' : 'rounded-card bg-surface p-4'}>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-faint">Notes</h2>
          <p className="whitespace-pre-wrap text-sm text-ink">{view.notes}</p>
        </section>
      ) : null}
    </>
  );
}
