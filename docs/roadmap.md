# Trackday Tuner Roadmap

Trackday Tuner is building one tight learning loop for track-day riders: capture a
session, compare it with relevant history, record whether the result improved, and
use that evidence to make the next recommendation safer and more specific.

## Launch Focus

The founding beta is positioned for intermediate and advanced motorcycle
track-day riders who adjust tires or suspension and expect to attend at least two
track days in a 90-day period. Cars remain supported by the product and the public
waitlist accepts every motorsport segment, but motorcycle riders are the first
acquisition and validation cohort.

The product promise is:

> Know what changed, whether it helped, and what to try next.

## Operating Model

Roadmap work ships one item per PR. Each item should be reviewed, merged, and
learned from before the next item starts. PRs stay focused on the active item and
do not pull later roadmap scope forward.

## Ordered Roadmap

1. Session comparison v1 - Complete; structured performance capture is item 5
2. Baseline setup per vehicle - Complete
3. Change tracking - Complete
4. Recommendation outcome loop - Built; pending live validation
5. Structured manual lap capture - Built; pending live validation
6. Founding beta access and acquisition - Built; pending live validation
7. Beta measurement and validation - Built; pending live validation
8. **Evidence-based next roadmap decision** - Active after the beta gate
9. AI day-plan guardrails
10. Vehicle- and track-specific memory improvements
11. CSV and lap-timer import
12. Tire lifecycle tracking
13. Setup templates
14. Coach/share mode
15. Event mode

## Current Product Loop

Recommendation Outcome Loop records how a later session compared with a prior
reference session and optionally links the AI recommendation tested between them.
The outcome belongs to the later session, remains editable, appears in vehicle
history, and becomes grounded evidence for future Race Engineer guidance.

The implemented slice includes outcome capture, recommendation linking, history
visibility, idempotent memory updates, tier access, and automated coverage. It does
not include imports, tire lifecycle, templates, team workflows, or event mode.

The product is now in validation mode. New roadmap scope should respond to
observed rider behavior and interviews rather than expand the feature surface.

## Founding Beta Gate

Review the beta when either twelve riders have registered and eight have logged
sessions on two distinct track dates, or ninety days have elapsed. Expansion is
based on repeat session logging, comparison use, recommendation follow-up,
helpfulness, trackside entry speed, and AI safety—not signup count alone.

Do not start car-specific expansion, coach mode, event mode, tire lifecycle, or
team sharing before this review.

Use `npm run beta:report` for the decision snapshot and follow
[`docs/beta-runbook.md`](./beta-runbook.md) for cohort operations.
