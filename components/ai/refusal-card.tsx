/**
 * What a rider sees when the AI safety layer withholds an answer.
 *
 * Every AI route can return `advice.refusal` with `recommended_changes: []`,
 * which is structurally identical to a legitimate "no change needed" answer.
 * The difference has to be visible, so a refusal renders here instead of the
 * panel's empty state: the rider is told the answer was withheld and why.
 */
interface RefusalCardProps {
  title: string;
  message: string;
  helpTitle: string;
  examples: string[];
}

export function RefusalCard({ title, message, helpTitle, examples }: RefusalCardProps) {
  return (
    <div className="space-y-3 rounded-row bg-surface-2 p-4">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-ink-faint">{title}</p>
        <p className="mt-1 text-sm text-ink">{message}</p>
      </div>
      <div className="rounded-row bg-surface-3 p-3 text-sm text-ink-dim">
        <p className="font-medium text-ink">{helpTitle}</p>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          {examples.map((example) => (
            <li key={example}>{example}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}
