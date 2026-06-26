# Trackday Tuner Roadmap

Trackday Tuner is moving toward a tighter setup-learning loop: capture each session, compare the signal against relevant baselines, preserve what changed, and turn that history into safer, more specific planning and recommendations.

## Operating Model

Roadmap work ships one item per PR. Each item should be reviewed, merged, and learned from before the next roadmap item starts. PRs should stay focused on the active item and avoid pulling future roadmap scope forward.

## Ordered Roadmap

1. **Session comparison v1** - Active
2. Baseline setup per vehicle
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

## Active Item: Session Comparison v1

Session Comparison v1 adds a Pro comparison page for choosing a baseline session from the same vehicle and reviewing deterministic comparison signals across setup, environment, and context. Free users keep the existing previous-session comparison on the session detail page.

PR 1 does not add manual lap-time entry, AI comparison summaries, telemetry import, a comparison database model, or cross-vehicle comparisons.

## Not Active Yet

Future roadmap items are intentionally out of scope until Session Comparison v1 is reviewed and merged. Do not add baseline setup models, change-tracking workflows, recommendation follow-up state, new memory systems, track note surfaces, setup timelines, planner upgrades, debrief flows, import flows, tire lifecycle tracking, templates, sharing, or event mode in PR 1.
