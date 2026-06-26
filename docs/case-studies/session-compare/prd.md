# Session Compare PRD

## Problem

Track Tuner users already log setup changes, conditions, and notes, but the current comparison experience only shows a basic previous-session field diff. Advanced track-day drivers, coaches, and shops need a clearer way to understand what changed between sessions and whether that change is worth acting on.

Lap time alone is not enough. Traffic, track temperature, tire state, fuel load, weather, and the driver's own consistency can explain a faster or slower session. A useful comparison tool should help the user see the signal without pretending it proves causation.

## User

Primary v1 user:

- Advanced track-day driver or amateur racer comparing their own sessions.

Secondary future users:

- Coaches reviewing a driver's progression.
- Shops managing setup changes across multiple drivers or vehicles.
- Entry-level users who manually log lap times and notes but still want a simple answer to "was this session better?"

## Goal

Help users compare two sessions side by side so they can understand:

- Whether pace improved.
- Whether consistency improved.
- What setup, condition, or note changes may matter.
- Whether the comparison is strong enough to guide the next session.

The product outcome is not "prove this setup was faster." The outcome is "help the user make a better next-session decision."

## Non-goals

- Real-time telemetry analysis.
- Full sector-by-sector telemetry review.
- Driver-vs-driver coach dashboards in v1.
- Automatic setup prescriptions.
- Public benchmark sharing.
- Claiming a setup caused lap-time improvement without enough context.
- Replacing coaching judgment or mechanical inspection.

## Current State

Repo-backed current state:

- `components/sessions/session-compare.tsx` compares the current session against the previous session and shows changed setup fields.
- `app/(app)/sessions/[id]/page.tsx` renders the comparison on session detail.
- `components/sessions/session-analytics-panel.tsx` summarizes pro analytics such as session counts, track history, module coverage, tire pressure trends, and environment snapshots.
- `lib/session-export.ts` supports CSV export of flattened session data.
- AI tuning advice and RAG context are active.
- `telemetry_summaries` exists in schema/types, but the app does not yet provide a full lap-by-lap comparison UI.

This case study plans the next product step from that baseline.

## V1 Scope

V1 should focus on manual-first two-session comparison:

- Compare two sessions.
- Strongly prefer same vehicle and same track/layout.
- Allow mismatched comparisons with visible warnings.
- Use manual lap times, setup data, conditions, and notes.
- Show best lap, average lap, lap count, consistency, setup deltas, and context warnings.
- Show changed setup fields by default.
- Allow users to save a takeaway or next-session focus.
- Avoid causal language unless the evidence is strong.

## Requirements

### Functional Requirements

1. A user can start a comparison from a session detail page.
2. A user can select another session for the same vehicle.
3. Sessions from the same track/layout are prioritized in the picker.
4. The comparison overview shows best lap, average lap, lap count, and consistency when lap data exists.
5. The comparison shows changed setup fields by default.
6. The comparison allows unchanged fields to be expanded.
7. The comparison shows condition and context differences.
8. The comparison warns when the sessions are weak matches.
9. A user can save a takeaway and optional next-session focus.
10. Missing data produces an empty state, not guessed values.

### Content Requirements

- Summary language must use "comparison signal" language when context is incomplete.
- The product must not state that one setup caused a faster lap unless the supporting data is explicit.
- Warnings should be short enough to read trackside.

### Access Requirements

- Free tier can keep the existing basic previous-session comparison.
- Pro tier can unlock choose-any-two-session comparison, saved takeaways, richer charts, and future import support.

## Data Inputs

V1 manual-first inputs:

- Session id.
- Vehicle id.
- Track id or track name.
- Date and start time.
- Session number.
- Manual lap times by lap number.
- Setup modules: tires, suspension, alignment, geometry, drivetrain, aero.
- Conditions: weather, surface, ambient temperature, track temperature, humidity.
- Tire condition.
- Notes.

Future inputs:

- CSV import.
- Telemetry summaries.
- Sector times.
- Coach annotations.
- Driver or team membership.

## Comparison Confidence Rules

The comparison should show a confidence/context label, not a false precision score.

Suggested labels:

- Strong comparison: same vehicle, same track/layout, both sessions have lap data, key conditions are similar.
- Useful comparison: same vehicle and track, but some context differs or data is missing.
- Weak comparison: different track, different vehicle, missing lap data, major weather/temperature differences, or unclear tire state.

Warnings to detect:

- Different vehicle.
- Different track or unknown layout.
- Missing lap data in one or both sessions.
- Large ambient or track temperature difference.
- Different tire condition or compound.
- Notes mention traffic, mechanical issues, rain, off-day, or limited laps.
- Different session length or lap count.

## Edge Cases

- One session has no lap times.
- Lap counts do not match.
- Sessions are from different tracks.
- Track layout is unknown.
- Vehicle changed between sessions.
- Driver had traffic, a red flag, or an off-track event.
- Conditions are not logged.
- Setup modules differ because one session used fewer modules.
- A user manually enters malformed lap times.
- A session has only one flying lap.
- A user wants to compare a morning session to a hotter afternoon session.

## Success Metrics

No measured result yet. These are validation targets after release.

Behavior metrics:

- Percentage of eligible session detail views that start a comparison.
- Percentage of comparisons where users save a takeaway.
- Percentage of new sessions that lead to a suggested comparison.
- Repeat usage of comparison after first use.

Quality metrics:

- User-rated helpfulness of comparison summaries.
- Percentage of comparisons with enough data to show lap metrics.
- Number of comparisons flagged as weak due to missing context.

Business metrics:

- Pro conversion from users who hit free compare/export/analytics limits.
- Pro retention among users who use comparison more than once.

## Future Phases

V1.5:

- Generic CSV import for lap times.
- Better lap-time parsing and validation.
- Saved comparison history.

V2:

- Coach/shop multi-driver comparison.
- Permissions and shared-driver workspaces.
- Driver benchmark sessions.

V3:

- Telemetry and sector-based analysis.
- Track map overlays.
- AI-assisted next-session plans that cite the comparison and safety constraints.

## Open Questions

- What exact manual lap-time entry format should v1 support?
- Should saved takeaways attach to a session, a comparison, or both?
- Which pro/free boundary best supports conversion without blocking core value?
- How should track layouts be modeled when users only enter a track name?
- Which CSV source should be supported first after manual entry?
