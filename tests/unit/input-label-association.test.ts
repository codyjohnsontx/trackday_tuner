import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock('@/lib/actions/ai-question-retention', () => ({
  deleteAllRetainedQuestions: vi.fn(),
  deleteRetainedQuestion: vi.fn(),
  setQuestionRetention: vi.fn(),
}));

import { QuestionRetentionNotice } from '@/components/ai/question-retention-notice';
import { TuningAdvicePanel } from '@/components/ai/tuning-advice-panel';
import { QuestionHistorySettings } from '@/components/settings/question-history-settings';
import { Input } from '@/components/ui/input';
import { QUESTION_RETENTION_COPY } from '@/lib/ai-question-retention-copy';

// `Input` once derived its id from the label text, so two fields asking the same
// question collided. The Sag calculator does exactly that: Front and Rear each
// ask for "Fully Extended (L0)", "Bike Only (L1)" and "Rider On Bike (L2)", so
// the page shipped three duplicated ids. `for` resolves to the first match in
// the document, which made tapping a Rear label focus the Front field - on a
// phone at the track, where the label is the biggest tap target next to the
// input, that silently steers rear measurements into the front box. The same
// collision left the Rear inputs with no accessible name at all.
//
// The suite is node-only and has no DOM renderer, so this renders to static
// markup and reads the attributes back. That is enough for the invariant, which
// is structural: distinct ids, and every label pointing at the input it wraps.

interface RenderedField {
  labelFor: string;
  inputId: string;
}

function renderFields(...labels: string[]): RenderedField[] {
  const html = renderToStaticMarkup(
    createElement(
      'form',
      null,
      labels.map((label, index) => createElement(Input, { key: index, label })),
    ),
  );

  return [...html.matchAll(/<label for="([^"]*)"[\s\S]*?<input id="([^"]*)"/g)].map((match) => ({
    labelFor: match[1],
    inputId: match[2],
  }));
}

describe('Input label association', () => {
  it('gives two fields sharing a label distinct ids', () => {
    const fields = renderFields('Fully Extended (L0)', 'Fully Extended (L0)');

    expect(fields).toHaveLength(2);
    expect(fields[0].inputId).not.toBe(fields[1].inputId);
  });

  it('points each label at the input it wraps', () => {
    const fields = renderFields('Fully Extended (L0)', 'Fully Extended (L0)');

    for (const field of fields) {
      expect(field.labelFor).toBe(field.inputId);
    }
  });

  it('still honours an explicitly supplied id', () => {
    const html = renderToStaticMarkup(createElement(Input, { label: 'Email', id: 'email' }));

    expect(html).toContain('<label for="email"');
    expect(html).toContain('<input id="email"');
  });

  it('keeps helper text out of the field\'s accessible name', () => {
    const html = renderToStaticMarkup(
      createElement(Input, {
        label: 'Total Travel (optional)',
        helperText: 'Needed to show sag as a percentage.',
      }),
    );

    const inputId = /<input id="([^"]*)"/.exec(html)?.[1];
    expect(/<label [^>]*>([\s\S]*?)<\/label>/.exec(html)?.[1]).toBe('Total Travel (optional)');
    expect(html).toContain(`aria-describedby="${inputId}-helper"`);
    expect(html).toContain('Needed to show sag as a percentage.');
  });

  it('keeps error text out of the field\'s accessible name', () => {
    const html = renderToStaticMarkup(
      createElement(Input, { label: 'Front Pressure', error: 'Enter a number' }),
    );

    expect(/<label [^>]*>([\s\S]*?)<\/label>/.exec(html)?.[1]).toBe('Front Pressure');
    expect(html).toContain('Enter a number');
  });

  it('keeps error and helper text wired to the field describing them', () => {
    const html = renderToStaticMarkup(
      createElement(Input, { label: 'Front Pressure', error: 'Enter a number' }),
    );

    const inputId = /<input id="([^"]*)"/.exec(html)?.[1];
    expect(inputId).toBeTruthy();
    expect(html).toContain(`aria-describedby="${inputId}-error"`);
    expect(html).toContain(`<p id="${inputId}-error"`);
  });
});

// The question-history controls are buttons rather than labelled inputs, so
// what this checks for them is the same property by other means: every control
// has a name a screen reader can say, and it is the RIGHT one - a row's delete
// names the question it deletes, since "Delete" read out N times in a list says
// nothing about which.
describe('Question history control names', () => {
  const questions = [
    {
      requestId: 'req-1',
      route: 'tuning_advice' as const,
      text: 'Front pushes mid-corner.',
      createdAt: '2026-09-20T12:00:00Z',
      retainUntil: '2026-12-19T12:00:00Z',
    },
    {
      requestId: 'req-2',
      route: 'day_plan' as const,
      text: null,
      createdAt: '2026-09-21T12:00:00Z',
      retainUntil: '2026-12-20T12:00:00Z',
    },
  ];

  it('names the switch group and each of its options', () => {
    const html = renderToStaticMarkup(
      createElement(QuestionHistorySettings, {
        choice: 'keep',
        history: { questions, total: questions.length },
        demoMode: false,
      }),
    );

    expect(html).toContain(`role="group" aria-label="${QUESTION_RETENTION_COPY.settings.title}"`);
    expect(html).toMatch(/aria-pressed="true"[^>]*>Keep for 90 days</);
    expect(html).toMatch(/aria-pressed="false"[^>]*>Do not keep</);
  });

  it('names each row delete after the question it deletes, or its route when the row holds no text', () => {
    const html = renderToStaticMarkup(
      createElement(QuestionHistorySettings, {
        choice: 'keep',
        history: { questions, total: questions.length },
        demoMode: false,
      }),
    );
    const names = [...html.matchAll(/<button[^>]*aria-label="([^"]*)"/g)].map((match) => match[1]);

    expect(names).toEqual(['Delete: Front pushes mid-corner.', 'Delete: Morning Plan']);
  });

  it('gives the list a heading it is labelled by', () => {
    const html = renderToStaticMarkup(
      createElement(QuestionHistorySettings, {
        choice: 'keep',
        history: { questions, total: questions.length },
        demoMode: false,
      }),
    );
    expect(html).toContain('aria-labelledby="question-history-list"');
    expect(html).toContain('id="question-history-list"');
  });

  it('labels the one-time notice by its own title', () => {
    const html = renderToStaticMarkup(createElement(QuestionRetentionNotice));
    expect(html).toContain('aria-labelledby="question-retention-notice-title"');
    expect(html).toContain('id="question-retention-notice-title"');
  });

  it('keeps the retention line out of the Race Engineer question box accessible name', () => {
    const html = renderToStaticMarkup(
      createElement(TuningAdvicePanel, { sessionId: 's1', vehicleId: 'v1', tier: 'pro', keepsQuestionText: true }),
    );
    const label = /<label for="race_engineer_question"[^>]*>([\s\S]*?)<\/label>/.exec(html)?.[1] ?? '';

    expect(label).toContain('What did you feel?');
    expect(label).not.toContain('90 days');
    expect(html).toContain('90 days');
  });
});
