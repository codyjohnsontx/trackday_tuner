/**
 * Every word a rider reads about keeping the text of their AI questions.
 *
 * The notice appears in four places - the privacy page, the line under both
 * question boxes, the Settings card and the one-time in-app notice - and they
 * must never say different things, so all four read from this one object.
 * Editing the wording means editing this file and nothing else.
 *
 * The wording is the owner's to edit (decision D6 of the retention plan). What
 * it must stay true to is fixed elsewhere and is not a copy decision:
 * `supabase/migrations/20260924001700_add_ai_request_text.sql` caps a row at 90
 * days and states the keep rule, and `lib/actions/ai-question-retention.ts`
 * deletes what is held the moment a rider turns keeping off.
 */
export const QUESTION_RETENTION_COPY = {
  privacy: {
    heading: 'AI processing and question history',
    paragraphs: [
      'When you ask Race Engineer a question or generate a Morning Plan, the text you type is sent to our AI provider to produce the answer. That text is your question, any symptom tags and change intent you pick, and for a Morning Plan the track name and conditions you enter. Recommendations and their outcomes are kept so your future guidance can learn from them.',
      "If you turn on question history, we also keep a copy of that text for 90 days so we can re-test Race Engineer's safety checks against real questions when we change them. It is off until you turn it on. Before the copy is saved, email addresses, phone numbers, web links and long numbers are replaced with placeholders. It is used only to test and improve those safety checks, including in Redline, our separate safety-testing project run by the same person who runs Track Tuner. The text is never published, never used to train a model, never shown to another rider, and never sold. Aggregate results, such as how often a check refuses a question, may be published without any question text.",
      'You can turn question history on or off, see the questions we hold, and delete any of them under Settings > Race Engineer question history. Turning it off deletes what we hold. Each question is deleted automatically after 90 days, and deleting your account deletes them straight away. Do not enter secrets or information you do not want processed.',
    ],
  },
  inline: {
    keeping: "Kept for 90 days to re-test Race Engineer's safety checks.",
    keepingLink: 'See or turn off in Settings.',
    off: 'Question history is off. This question is not kept after it is answered.',
  },
  settings: {
    title: 'Race Engineer question history',
    description:
      'If you turn this on, we keep the text of your Race Engineer questions and Morning Plan details for 90 days so our safety checks can be re-tested against real questions when they change. It is off until you turn it on. Email addresses, phone numbers and links are masked before saving. Turning it off deletes the questions we hold.',
    label: 'Question history',
    options: { keep: 'Keep for 90 days', off: 'Do not keep' },
    undecided: 'Off until you choose. Nothing of yours is kept.',
    demo: 'Demo accounts keep no questions.',
    listHeading: 'Questions we hold',
    empty: 'We hold no questions of yours right now.',
    truncated: (shown: number, total: number) =>
      `Showing the newest ${shown} of the ${total} questions we hold. "Hold to delete all" deletes every one of them.`,
    loadFailed: 'Your question history could not be loaded. Reload the page to try again.',
    deleteRow: 'Delete',
    deleteAll: 'Hold to delete all',
    deleteAllHolding: 'Keep holding…',
    deletedUntil: 'Deleted automatically on',
    routes: { tuning_advice: 'Race Engineer', day_plan: 'Morning Plan' },
  },
  // Retention is off until each rider turns it on (owner, 2026-09-25), so the
  // notice always asks.
  notice: {
    optInTitle: 'Keep your Race Engineer questions?',
    optInBody:
      "If you turn this on, we keep the text of your Race Engineer questions and Morning Plan details for 90 days, so our safety checks can be re-tested against real questions when they change - including in Redline, our separate safety-testing project. Email addresses, phone numbers and links are masked first. It stays off unless you turn it on, and you can change it at any time in Settings.",
    optIn: 'Keep for 90 days',
    notNow: 'Not now',
    privacyLink: 'Read the privacy notice',
  },
} as const;
