import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { buildLapSummaryLabel } from '@/lib/session-compare';
import { lapEditorValueFrom } from '@/lib/lap-times';
import type { Session, SessionLap, TelemetrySummary } from '@/types';

// Lap time is the headline number of a track session, and the app stored it
// without ever showing it. The session detail page printed "6 included laps"
// and nothing else, and the dashboard and history rows carried no lap data at
// all - the only screens that read a best lap were the comparison page and the
// lap editor, which is a mutation UI.
//
// These render each read surface and assert the numbers are actually there.

// The panel imports the server action module for its save path; the read state
// never calls it, and stubbing keeps `next/headers` out of a node-only suite.
vi.mock('@/lib/actions/sessions', () => ({ replaceSessionLaps: vi.fn() }));
vi.mock('@/lib/product-events.client', () => ({ trackProductEvent: vi.fn() }));

const { SessionLapsPanel } = await import('@/components/sessions/session-laps-panel');
const { LapTimeEditor } = await import('@/components/sessions/lap-time-editor');
const { SessionCard } = await import('@/components/sessions/session-card');
const { SessionHistoryList } = await import('@/components/sessions/session-history-list');

function lap(lapNumber: number, ms: number, included = true): SessionLap {
  return {
    id: `lap-${lapNumber}`,
    user_id: 'user-1',
    session_id: 'session-1',
    lap_number: lapNumber,
    lap_time_ms: ms,
    included,
    source: 'manual',
    created_at: new Date(0).toISOString(),
    updated_at: new Date(0).toISOString(),
  };
}

function render(laps: SessionLap[]): string {
  return renderToStaticMarkup(
    createElement(SessionLapsPanel, {
      sessionId: 'session-1',
      vehicleId: 'vehicle-1',
      initialLaps: laps,
      demoMode: false,
    }),
  );
}

/** The metrics strip, as `label -> value`, read whole so `6` cannot match inside `16`. */
function metrics(html: string): Record<string, string> {
  const cells: Record<string, string> = {};
  const cell =
    /<p class="text-\[10px\] uppercase text-ink-faint">([^<]*)<\/p><p class="text-sm font-semibold">([^<]*)<\/p>/g;
  for (const match of html.matchAll(cell)) cells[match[1]] = match[2];
  return cells;
}

const sixLaps = [
  lap(1, 104620),
  lap(2, 104110),
  lap(3, 103980),
  lap(4, 104250),
  lap(5, 104430),
  lap(6, 104690),
];

describe('session detail lap read view', () => {
  it('shows best, average, spread and count without entering the editor', () => {
    expect(metrics(render(sixLaps))).toEqual({
      Count: '6',
      Best: '1:43.980',
      Average: '1:44.347',
      Spread: '0.710s',
    });
  });

  it('lists every stored lap time and marks the fastest one', () => {
    const html = render(sixLaps);

    for (const time of ['1:44.620', '1:44.110', '1:43.980', '1:44.250', '1:44.430', '1:44.690']) {
      expect(html).toContain(time);
    }
    expect(html).toContain('Show every lap (6)');
    // Exactly one Best badge - `text-faster` is what distinguishes it from the
    // metrics strip's own "Best" label - and it sits on the fastest lap's row.
    expect(html.match(/text-faster">Best</g) ?? []).toHaveLength(1);
    expect(html).toMatch(/1:43\.980<\/span>.{0,120}text-faster">Best</s);
  });

  it('leaves excluded laps out of the metrics but still on screen, labelled', () => {
    // Lap 1 is the out lap and is the slowest; excluding it must move average
    // and spread, and must never be the source of the Best figure.
    const html = render([lap(1, 130000, false), lap(2, 104110), lap(3, 103980)]);

    expect(metrics(html)).toEqual({
      Count: '2',
      Best: '1:43.980',
      Average: '1:44.045',
      Spread: '0.130s',
    });
    expect(html).toContain('2 included laps');
    expect(html).toContain('1 not counted');
    expect(html).toContain('Not counted');
    // The excluded lap is still listed, so a rider can see what they dropped.
    expect(html).toContain('2:10.000');
  });

  it('reads in the singular for a single lap', () => {
    expect(render([lap(1, 104110)])).toContain('1 included lap<');
  });

  it('offers to add laps rather than rendering an empty metrics strip', () => {
    const html = render([]);

    expect(html).toContain('Add Lap Times');
    expect(metrics(html)).toEqual({});
  });
});

function telemetry(metrics: Record<string, unknown>): TelemetrySummary {
  return { metrics } as unknown as TelemetrySummary;
}

describe('buildLapSummaryLabel', () => {
  it('reads best lap and lap count off a stored summary', () => {
    expect(buildLapSummaryLabel(telemetry({ best_lap_ms: 103980, lap_count: 6 }))).toBe(
      'Best 1:43.980 · 6 laps',
    );
  });

  it('falls back to the stored lap times when the aggregates are missing', () => {
    expect(buildLapSummaryLabel(telemetry({ lap_times_ms: [104110, 103980] }))).toBe(
      'Best 1:43.980 · 2 laps',
    );
  });

  it('reads in the singular for a single lap', () => {
    expect(buildLapSummaryLabel(telemetry({ best_lap_ms: 103980, lap_count: 1 }))).toBe(
      'Best 1:43.980 · 1 lap',
    );
  });

  it('is null for a session with no lap data, so the row omits the line', () => {
    expect(buildLapSummaryLabel(null)).toBeNull();
    expect(buildLapSummaryLabel(telemetry({}))).toBeNull();
  });
});

const listedSession = {
  id: 'session-1',
  vehicle_id: 'vehicle-1',
  track_name: 'MSR Cresson 1.7',
  date: '2026-05-18',
  start_time: '11:30:00',
  session_number: 3,
  conditions: 'sunny',
  notes: null,
  tires: { front: { pressure: '33 psi hot' }, rear: { pressure: '26 psi hot' } },
  suspension: {
    front: { preload: '5 turns', compression: '12 clicks', rebound: '10 clicks' },
    rear: { preload: '8 mm', compression: '11 clicks', rebound: '12 clicks' },
  },
} as unknown as Session;

describe('session rows', () => {
  it('shows the lap headline on a dashboard row', () => {
    const html = renderToStaticMarkup(
      createElement(SessionCard, {
        session: listedSession,
        vehicleNickname: 'R6 Track Bike',
        lapSummary: 'Best 1:43.980 · 6 laps',
      }),
    );

    expect(html).toContain('Best 1:43.980 · 6 laps');
  });

  it('shows the lap headline on a history row, and omits the line without one', () => {
    const render = (lapSummary: string | null) =>
      renderToStaticMarkup(
        createElement(SessionHistoryList, {
          items: [
            { session: listedSession, vehicleNickname: 'R6 Track Bike', environment: null, lapSummary },
          ],
        }),
      );

    expect(render('Best 1:43.980 · 6 laps')).toContain('Best 1:43.980 · 6 laps');
    expect(render(null)).not.toContain('Best');
  });
});

describe('lap editor metrics strip', () => {
  // The strip moved out of the editor so the read view could reuse it. The
  // editor has to keep showing the same four numbers it always did.
  it('shows the same four metrics the read view does', () => {
    const html = renderToStaticMarkup(
      createElement(LapTimeEditor, {
        value: lapEditorValueFrom(
          sixLaps.map(({ lap_number, lap_time_ms, included }) => ({ lap_number, lap_time_ms, included })),
        ),
        onChange: () => {},
      }),
    );

    expect(metrics(html)).toEqual({
      Count: '6',
      Best: '1:43.980',
      Average: '1:44.347',
      Spread: '0.710s',
    });
  });
});
