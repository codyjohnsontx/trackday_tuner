# Trackday Tuner Roadmap

Trackday Tuner is moving toward a tighter setup-learning loop: capture each session, compare the signal against relevant baselines, preserve what changed, and turn that history into safer, more specific planning and recommendations.

## Operating Model

Roadmap work ships one item per PR. Each item should be reviewed, merged, and learned from before the next roadmap item starts. PRs should stay focused on the active item and avoid pulling future roadmap scope forward.

## Ordered Roadmap

1. Session comparison v1 - Complete
2. **Baseline setup per vehicle** - Active
3. Change tracking
4. Recommendation follow-up
5. AI guardrail tightening for day plans
6. Vehicle-specific memory
7. Track-specific notes
8. Setup timeline
9. Smarter day planner
10. Post-session debrief flow
11. CSV / telemetry import
12. Tire lifecycle tracking
13. Setup templates
14. Coach/share mode
15. Event mode

## Active Item: Baseline Setup Per Vehicle

Baseline Setup Per Vehicle adds one Pro-managed active baseline per vehicle, sourced from an existing session and stored as a stable setup snapshot with source metadata. Users manage the baseline from session detail, see baseline status on garage cards and session detail, and get a baseline-source label in the existing session comparison picker when that source session is available.

PR 2 does not add baseline editing, track-specific baselines, baseline history, setup timeline, change tracking, AI baseline selection, or applying a baseline to prefill new sessions.

## Not Active Yet

Future roadmap items are intentionally out of scope until Baseline Setup Per Vehicle is reviewed and merged. Do not add change-tracking workflows, recommendation follow-up state, new memory systems, track note surfaces, setup timelines, planner upgrades, debrief flows, import flows, tire lifecycle tracking, templates, sharing, or event mode in PR 2.
