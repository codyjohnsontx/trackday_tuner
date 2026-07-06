# Trackday Tuner Roadmap

Trackday Tuner is moving toward a tighter setup-learning loop: capture each session, compare the signal against relevant baselines, preserve what changed, and turn that history into safer, more specific planning and recommendations.

## Operating Model

Roadmap work ships one item per PR. Each item should be reviewed, merged, and learned from before the next roadmap item starts. PRs should stay focused on the active item and avoid pulling future roadmap scope forward.

## Ordered Roadmap

1. Session comparison v1 - Complete
2. Baseline setup per vehicle - Complete
3. Change tracking - Complete
4. **Recommendation follow-up** - Active
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

## Active Item: Recommendation Follow-up

Recommendation Follow-up closes the setup-learning loop by capturing whether a change actually helped. Building on the per-session change records from item 3 (Change tracking) and the existing `ai_recommendations` and `session_feedback` data, it lets a rider record an outcome for a prior AI recommendation or setup change — the "did it help" state that was intentionally deferred out of PR 3 — and surfaces that outcome history where the recommendation is shown, so future advice can lean on what has and has not worked.

The concrete PR 4 scope — outcome-capture UI, which surfaces it attaches to, tier gating, and how outcomes feed later advice — is still to be decided before implementation starts, following the operating model above. Until then, PR 4 should stay focused on a single reviewable slice and avoid pulling later roadmap items forward.

## Not Active Yet

Future roadmap items are intentionally out of scope until Recommendation Follow-up is reviewed and merged. Do not add new memory systems, track note surfaces, setup timelines, planner upgrades, debrief flows, import flows, tire lifecycle tracking, templates, sharing, or event mode in PR 4.
