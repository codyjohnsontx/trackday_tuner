# Trackday Tuner Roadmap

Trackday Tuner is moving toward a tighter setup-learning loop: capture each session, compare the signal against relevant baselines, preserve what changed, and turn that history into safer, more specific planning and recommendations.

## Operating Model

Roadmap work ships one item per PR. Each item should be reviewed, merged, and learned from before the next roadmap item starts. PRs should stay focused on the active item and avoid pulling future roadmap scope forward.

## Ordered Roadmap

1. Session comparison v1 - Complete
2. Baseline setup per vehicle - Complete
3. **Change tracking** - Active
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

## Active Item: Change Tracking

Change Tracking preserves what changed on each session. At session creation it computes deterministic per-session change records against both the previous session (same vehicle) and the vehicle's active baseline snapshot, capturing the baseline that was active at that moment. Records are written for all tiers but displayed Pro-only on session detail. Sessions that predate the feature derive their change sets on the fly at read time against the current previous session and baseline, and the session that is itself the baseline source is never compared to a snapshot of itself. All diffs reuse the existing session-comparison engine and are limited to physical setup groups (Tires, Suspension, Alignment, Geometry, Drivetrain, Aero) — session context, environment, and free-text notes are excluded.

PR 3 does not add change annotation, recommendation outcome state (item 4), a setup timeline UI (item 8), AI interpretation of changes, historical backfill of records for existing sessions, or change display on session-list or garage cards.

## Not Active Yet

Future roadmap items are intentionally out of scope until Change Tracking is reviewed and merged. Do not add recommendation follow-up state, new memory systems, track note surfaces, setup timelines, planner upgrades, debrief flows, import flows, tire lifecycle tracking, templates, sharing, or event mode in PR 3.
