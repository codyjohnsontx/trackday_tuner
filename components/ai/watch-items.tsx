/**
 * The "things to watch rather than change" list that sits under a prediction.
 *
 * `SYSTEM_PROMPT` tells the model to put monitoring guidance in
 * `prediction.watch_items` rather than in a recommended change - see
 * `describeComponentVocabulary()` in `lib/rag/component-vocabulary.ts` - so a
 * panel that prints only `expected_effect` and `day_trend` discards the very
 * content the prompt asked for. Race Engineer rendered the list and the day plan
 * did not, which is the omission RefusalCard and SafetyBanner were lifted to
 * stop: shared, a panel cannot quietly leave it out.
 *
 * An empty list renders nothing rather than an empty container, because a model
 * with nothing to flag is the ordinary case.
 */
export function WatchItems({ items }: { items: string[] }) {
  if (items.length === 0) return null;
  return (
    <ul className="list-disc space-y-1 pl-5">
      {items.map((item, idx) => (
        <li key={idx}>{item}</li>
      ))}
    </ul>
  );
}
