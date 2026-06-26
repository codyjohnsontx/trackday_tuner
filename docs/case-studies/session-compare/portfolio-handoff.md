# Portfolio Handoff: Session Compare

## App

Track Tuner

## Case Study Summary

This is a PM case study package for a planned Session Compare extension. It expands Track Tuner's existing previous-session setup diff into a richer manual-first comparison workflow for lap pace, consistency, setup deltas, context warnings, and next-session takeaways.

This is a concept extension, not a claim that the full feature is already shipped.

## Repo-Backed Evidence

Current Track Tuner repo evidence:

- Basic previous-session setup comparison exists in `components/sessions/session-compare.tsx`.
- Session detail renders comparison in `app/(app)/sessions/[id]/page.tsx`.
- Pro analytics summaries exist in `components/sessions/session-analytics-panel.tsx`.
- CSV export exists in `lib/session-export.ts`.
- AI tuning advice and RAG context are active.
- `telemetry_summaries` exists in schema/types for future telemetry context.

## Suggested Portfolio Placement

Project card:

- Add Session Compare as a planned or in-progress product direction, not a shipped full feature.

Case study:

- Add a focused section showing the problem, v1 scope, user stories, workflow, chart strategy, wireframes, tradeoffs, and metrics.

Changelog/update feed:

- Mention creation of a PM case study package for Session Compare.

Screenshots/media:

- Use the generated deck and text wireframes as portfolio assets.
- Add real product screenshots only if the portfolio clearly labels which screens exist today and which are planned.

Metrics/results:

- No measured result yet.
- Impact to validate after release.

PRD/decision links:

- Link to the PRD, user stories, workflow, chart spec, wireframes, and deck source if the portfolio supports artifact links.

Tech tags:

- Next.js
- Supabase
- TypeScript
- Product strategy
- PRD
- User stories
- Data visualization
- AI/RAG context

## Suggested Public Copy

I planned a richer Session Compare experience for Track Tuner, expanding the existing previous-session diff into a manual-first comparison workflow. The feature helps drivers compare lap pace, consistency, setup changes, and conditions without pretending lap time alone proves causation.

The case study covers the PRD, user stories, acceptance criteria, workflow, chart strategy, text wireframes, tradeoffs, success metrics, and future roadmap.

## Missing Info / Follow-Up

Do not guess:

- Whether the full Session Compare feature is shipped.
- Measured adoption, conversion, retention, or performance impact.
- Specific telemetry import support.
- Coach/shop workspace permissions.
- Public driver benchmarks.

## Copy-Paste Prompt For Portfolio Agent

Use this prompt with the portfolio agent:

```text
Update Cody's portfolio with a new Track Tuner case study asset for "Session Compare."

This is a planned product extension, not a shipped full feature. Preserve Cody's voice: direct, plain, practical, and specific. Do not make it sound like AI marketing copy.

App: Track Tuner

Current repo-backed context:
- Track Tuner already has session setup logging.
- It has a basic previous-session setup diff in `components/sessions/session-compare.tsx`.
- Session detail renders that comparison in `app/(app)/sessions/[id]/page.tsx`.
- It has pro analytics summaries, CSV export, AI/RAG setup advice, and telemetry summary schema/types.
- It does not yet have the full lap-by-lap Session Compare workflow.

Case study summary:
Cody planned a richer Session Compare experience that expands the existing previous-session diff into a manual-first comparison workflow. The concept helps drivers compare lap pace, consistency, setup changes, and conditions while warning them not to overread weak comparisons.

What changed in the portfolio:
- Add or update the Track Tuner case study with a section for Session Compare.
- Show this as product planning and PM execution, not as a fully shipped feature.
- Include links or references to the PRD, user stories, workflows, chart spec, wireframes, and deck.
- Add the generated presentation as a supporting artifact if the portfolio supports downloadable or viewable files.

Suggested public copy:
"I planned a richer Session Compare experience for Track Tuner, expanding the existing previous-session diff into a manual-first comparison workflow. The feature helps drivers compare lap pace, consistency, setup changes, and conditions without pretending lap time alone proves causation."

Where to update:
- Track Tuner project card: mention Session Compare as a planned/in-progress product direction.
- Track Tuner case study: add a section covering the problem, v1 scope, user stories, workflow, chart strategy, wireframes, tradeoffs, metrics, and roadmap.
- Changelog/update feed: add a short note that a Session Compare PM case study package was created.

Screenshot/media needs:
- Use the generated PPTX deck as the main presentation artifact.
- Use text wireframes as supporting visuals or convert them into portfolio-styled visuals later.
- If using real app screenshots, label current screens versus planned concept screens clearly.

Warnings:
- Do not claim measured impact. Say "No measured result yet" or "Impact to validate after release."
- Do not claim the full feature is shipped.
- Do not claim telemetry or sector analysis is supported in v1.
- Do not overstate coach/shop comparison; it is a future phase.
```
