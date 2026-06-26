# Session Compare for Track Tuner

Editable source for `session-compare-pm-case-study.pptx`.

## Slide 1: Title

Session Compare for Track Tuner

Planning the next step from setup logging to trackside decision support.

Positioning: PM case study, concept extension, not a shipped full feature.

## Slide 2: Problem

Drivers log changes but still struggle to know what actually helped.

Lap time is useful, but it can be misleading when traffic, temperature, tire state, fuel load, and driver consistency change between sessions.

Product question: what decision should the driver make differently before the next session?

## Slide 3: User

Primary v1 user: advanced track-day driver or amateur racer comparing their own sessions.

Future users: coaches and shops managing multiple drivers.

Entry-level users still benefit because v1 starts with manual lap times and notes, not telemetry hardware.

## Slide 4: Current State

Track Tuner already has:

- Session setup logging.
- Previous-session setup diff.
- Pro analytics summaries.
- CSV export.
- AI/RAG setup advice.
- Telemetry summary schema for future data.

Gap: no full lap-by-lap comparison flow that connects pace, setup, context, and next-session decisions.

## Slide 5: Product Opportunity

Turn setup history into a decision tool.

The comparison should answer:

- Was I faster once, or faster overall?
- Was I more consistent?
- What changed mechanically?
- Did conditions make this comparison weaker?
- What should I test next?

## Slide 6: V1 Scope + User Stories

Manual-first v1:

- Compare two sessions.
- Prioritize same vehicle and same track/layout.
- Show lap metrics, setup deltas, and context warnings.
- Save a takeaway or next-session focus.

Representative story:

As a driver reviewing my session history, I want to see best lap, average lap, lap count, and consistency side by side, so that I can tell whether I was truly better or only had one good lap.

## Slide 7: Workflow

Primary workflow:

```text
Open session detail
-> Tap Compare
-> Choose comparison session
-> App checks compatibility
-> Review summary
-> Inspect charts
-> Review setup and condition deltas
-> Read confidence warnings
-> Save takeaway
-> Create next-session plan
```

## Slide 8: Charts

Each chart answers a decision question:

- Lap Time Trend: did pace improve, fade, or stabilize?
- Best / Average / Consistency: was the user faster once or repeatably better?
- Lap Delta Bars: which laps gained or lost time?
- Setup Delta Summary: what changed mechanically?
- Confidence Flags: can the user trust this comparison?

## Slide 9: Wireframes

Key screens:

- Session detail with Compare CTA.
- Compare session picker.
- Comparison overview.
- Pace charts.
- Setup delta.
- Confidence warnings.
- Saved takeaway.

Wireframe principle: the user should leave with a next-session decision, not just a chart.

## Slide 10: Tradeoffs, Metrics, Roadmap

Tradeoffs:

- Manual-first v1 keeps the feature usable without telemetry hardware.
- Warnings reduce false certainty.
- Coach/shop workflows wait until permissions and benchmark ownership are defined.

Metrics to validate:

- Compare starts from session detail.
- Takeaways saved.
- Repeat comparison usage.
- Pro conversion from compare/export/analytics users.

Roadmap:

- V1.5 CSV import.
- V2 coach/shop comparison.
- V3 telemetry and sector analysis.
