import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
// The components import server actions; rendering never calls them, and the
// real module reaches for cookies and a service key at import.
vi.mock('@/lib/actions/ai-question-retention', () => ({
  acknowledgeQuestionRetentionNotice: vi.fn(),
  deleteAllRetainedQuestions: vi.fn(),
  deleteRetainedQuestion: vi.fn(),
  setQuestionRetention: vi.fn(),
}));

import PrivacyPage from '@/app/privacy/page';
import { DayPlanPanel } from '@/components/ai/day-plan-panel';
import { QuestionRetentionLine } from '@/components/ai/question-retention-line';
import { QuestionRetentionNotice } from '@/components/ai/question-retention-notice';
import { TuningAdvicePanel } from '@/components/ai/tuning-advice-panel';
import { QuestionHistorySettings, RiderDate } from '@/components/settings/question-history-settings';
import { QUESTION_RETENTION_COPY as COPY } from '@/lib/ai-question-retention-copy';
import type { RetainedQuestion } from '@/lib/ai-question-retention';
import type { Vehicle } from '@/types';

// The retention notice is said in four places - the privacy page, the line
// under both question boxes, the Settings card and the one-time notice - and
// each reads the one copy module, so the owner's edit to the wording lands in
// all of them. These render every place and read the module's own strings
// back, which fails if a place stops reading the module or a state renders the
// other state's words.

function text(html: string) {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/\s+/g, ' ');
}

const QUESTION: RetainedQuestion = {
  requestId: 'req-1',
  route: 'tuning_advice',
  text: 'Front pushes mid-corner.',
  createdAt: '2026-09-20T12:00:00Z',
  retainUntil: '2026-12-19T12:00:00Z',
};

describe('privacy page', () => {
  it('prints the AI processing section from the copy module, naming Redline', () => {
    const page = text(renderToStaticMarkup(createElement(PrivacyPage)));

    expect(page).toContain(COPY.privacy.heading);
    for (const paragraph of COPY.privacy.paragraphs) expect(page).toContain(paragraph);
    expect(page).toContain('Redline');
    expect(page).toContain('90 days');
  });
});

describe('the line under a question box', () => {
  it('says the question is kept, and links to the switch, for a rider who keeps', () => {
    const html = renderToStaticMarkup(createElement(QuestionRetentionLine, { keeping: true }));
    expect(text(html)).toContain(COPY.inline.keeping);
    expect(text(html)).toContain(COPY.inline.keepingLink);
    expect(html).toContain('href="/settings#question-history"');
    expect(text(html)).not.toContain(COPY.inline.off);
  });

  it('says the question is not kept for a rider who does not', () => {
    const html = text(renderToStaticMarkup(createElement(QuestionRetentionLine, { keeping: false })));
    expect(html).toContain(COPY.inline.off);
    expect(html).not.toContain(COPY.inline.keeping);
  });

  it('is on the Race Engineer question box', () => {
    for (const keeping of [true, false]) {
      const html = text(
        renderToStaticMarkup(
          createElement(TuningAdvicePanel, {
            sessionId: 's1',
            vehicleId: 'v1',
            tier: 'pro',
            keepsQuestionText: keeping,
          }),
        ),
      );
      expect(html).toContain(keeping ? COPY.inline.keeping : COPY.inline.off);
    }
  });

  it('is not on the demo Race Engineer, which keeps nothing', () => {
    for (const keeping of [true, false]) {
      const html = text(
        renderToStaticMarkup(
          createElement(TuningAdvicePanel, {
            sessionId: 's1',
            vehicleId: 'v1',
            tier: 'pro',
            demoMode: true,
            keepsQuestionText: keeping,
          }),
        ),
      );
      expect(html).toContain('Static sample advice from the demo history.');
      expect(html).not.toContain(COPY.inline.keeping);
      expect(html).not.toContain(COPY.inline.off);
    }
  });

  it('is on the Morning Plan form', () => {
    const vehicles = [{ id: 'v1', nickname: 'R6' } as Vehicle];
    for (const keeping of [true, false]) {
      const html = text(
        renderToStaticMarkup(createElement(DayPlanPanel, { vehicles, tier: 'pro', keepsQuestionText: keeping })),
      );
      expect(html).toContain(keeping ? COPY.inline.keeping : COPY.inline.off);
    }
  });

  it('is not on the demo Morning Plan, which keeps nothing', () => {
    const html = text(
      renderToStaticMarkup(
        createElement(DayPlanPanel, {
          vehicles: [{ id: 'v1', nickname: 'R6' } as Vehicle],
          tier: 'pro',
          demoMode: true,
          keepsQuestionText: true,
        }),
      ),
    );
    // The panel renders nothing without a vehicle, which would pass this
    // for the wrong reason; the demo form itself has to be on the page.
    expect(html).toContain('Sample plan shown');
    expect(html).not.toContain(COPY.inline.keeping);
    expect(html).not.toContain(COPY.inline.off);
  });
});

describe('Settings card', () => {
  function render(props: Partial<Parameters<typeof QuestionHistorySettings>[0]> = {}) {
    return renderToStaticMarkup(
      createElement(QuestionHistorySettings, {
        choice: 'keep',
        history: { questions: [], total: 0 },
        demoMode: false,
        ...props,
      }),
    );
  }

  it('carries the title, description and both options from the copy module', () => {
    const html = text(render());
    expect(html).toContain(COPY.settings.title);
    expect(html).toContain(COPY.settings.description);
    expect(html).toContain(COPY.settings.options.keep);
    expect(html).toContain(COPY.settings.options.off);
  });

  it('presses the stored choice, and presses nothing before the rider has chosen', () => {
    expect(render({ choice: 'off' })).toMatch(/aria-pressed="true"[^>]*>Do not keep</);
    const undecided = render({ choice: null });
    expect(undecided).not.toContain('aria-pressed="true"');
    expect(text(undecided)).toContain(COPY.settings.undecided);
  });

  it('lists each held question with its own delete', () => {
    const html = render({ history: { questions: [QUESTION], total: 1 } });
    expect(text(html)).toContain(QUESTION.text);
    expect(text(html)).toContain(COPY.settings.routes.tuning_advice);
    expect(html).toContain(`aria-label="${COPY.settings.deleteRow}: ${QUESTION.text}"`);
    expect(text(html)).toContain(COPY.settings.deleteAll);
    expect(text(html)).not.toContain(COPY.settings.truncated(1, 1));
  });

  it('says when the list shows only the newest of what is held', () => {
    const html = text(render({ history: { questions: [QUESTION], total: 250 } }));
    expect(html).toContain(COPY.settings.truncated(1, 250));
    expect(html).toContain(QUESTION.text);
  });

  it('says it holds nothing only when the read succeeded', () => {
    expect(text(render({ history: { questions: [], total: 0 } }))).toContain(COPY.settings.empty);
    const failed = text(render({ history: null }));
    expect(failed).toContain(COPY.settings.loadFailed);
    expect(failed).not.toContain(COPY.settings.empty);
  });

  it('is disabled in demo, with no list', () => {
    const html = render({ demoMode: true, choice: null });
    expect(text(html)).toContain(COPY.settings.demo);
    expect(text(html)).not.toContain(COPY.settings.listHeading);
    expect(html).toMatch(/<button[^>]*disabled/);
  });
});

describe('RiderDate', () => {
  // The rider's calendar day is only knowable in their browser. A date the
  // server formatted in its own zone stayed on screen after hydration, so the
  // server renders the machine-readable value alone and the text arrives on
  // mount (tests/e2e/ai-question-history.spec.ts checks it in a browser).
  it('renders no server-side calendar day, only the timestamp', () => {
    const html = renderToStaticMarkup(createElement(RiderDate, { iso: '2026-09-25T01:00:00Z' }));
    expect(html).toBe('<time dateTime="2026-09-25T01:00:00Z"></time>');
  });
});

describe('one-time notice', () => {
  it('tells a rider who keeps by default, with a way to decline', () => {
    const html = text(renderToStaticMarkup(createElement(QuestionRetentionNotice, { requiresOptIn: false })));
    expect(html).toContain(COPY.notice.title);
    expect(html).toContain(COPY.notice.body);
    expect(html).toContain(COPY.notice.acknowledge);
    expect(html).toContain(COPY.notice.decline);
    expect(html).toContain('Redline');
  });

  it('asks a rider who starts with it off, and does not claim it is on', () => {
    const html = text(renderToStaticMarkup(createElement(QuestionRetentionNotice, { requiresOptIn: true })));
    expect(html).toContain(COPY.notice.optInTitle);
    expect(html).toContain(COPY.notice.optInBody);
    expect(html).toContain(COPY.notice.optIn);
    expect(html).toContain(COPY.notice.notNow);
    expect(html).not.toContain(COPY.notice.body);
  });
});
