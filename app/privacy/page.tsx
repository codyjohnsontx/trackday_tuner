import { QUESTION_RETENTION_COPY } from '@/lib/ai-question-retention-copy';

const AI_PROCESSING = QUESTION_RETENTION_COPY.privacy;

export default function PrivacyPage() {
  return (
    <article className="mx-auto max-w-2xl space-y-5">
      <h1 className="text-3xl font-bold">Privacy</h1>
      <p className="text-ink-dim">
        Trackday Tuner stores the account, vehicle, setup, session, outcome, and optional lap data you provide so the
        product can compare sessions and personalize guidance.
      </p>
      <h2 id="ai-processing" className="text-xl font-semibold">
        {AI_PROCESSING.heading}
      </h2>
      {AI_PROCESSING.paragraphs.map((paragraph) => (
        <p key={paragraph} className="text-ink-dim">
          {paragraph}
        </p>
      ))}
      <h2 className="text-xl font-semibold">Product measurement</h2>
      <p className="text-ink-dim">
        The founding beta records limited first-party usage events such as session creation, comparison views, and
        outcome completion. Event properties exclude email, prompt text, notes, invite codes, and raw IP addresses.
      </p>
      <h2 className="text-xl font-semibold">Control</h2>
      <p className="text-ink-dim">
        You may request correction or deletion of beta data by replying to your invitation contact. This beta notice
        will be reviewed before a paid public launch.
      </p>
    </article>
  );
}
