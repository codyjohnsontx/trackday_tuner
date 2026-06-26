# Session Compare Workflows

## Primary Workflow: Compare Two Sessions

Purpose: help a driver turn two logged sessions into a next-session decision.

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

Product notes:

- Same vehicle and same track/layout sessions should appear first.
- Mismatched sessions can be selected, but the user must see why the comparison is weaker.
- The workflow should work with manual lap times and notes, not require imported telemetry.

## Secondary Workflow: Suggested Comparison

Purpose: make comparison a natural follow-up after logging, not a buried analytics feature.

```text
User logs a new session
-> App detects previous same vehicle/track session
-> App suggests comparison
-> User opens comparison
-> User saves takeaway or dismisses
```

Product notes:

- The suggestion should appear after save and on the session detail page.
- The product should not interrupt fast trackside logging.
- If the user has no previous comparable session, show nothing or a quiet empty state.

## Future Workflow: Coach / Shop Comparison

Purpose: show how the model can grow into higher-value team and coaching use cases.

```text
Coach selects driver or vehicle
-> Chooses baseline session
-> Chooses comparison session or reference session
-> Reviews deltas and warnings
-> Adds coach note
-> Shares next-session focus with driver
```

Product notes:

- This is out of v1 scope.
- Requires permissions, privacy, workspace membership, and benchmark ownership rules.
- The v1 data model should avoid choices that make this impossible later.

## Decision Flow

```text
Do both sessions have lap data?
-> Yes: show lap metrics and charts
-> No: show setup/context comparison and lap-data empty state

Do sessions match vehicle and track/layout?
-> Yes: label as stronger comparison
-> No: allow comparison with warning

Are major context differences present?
-> Yes: show warning and avoid causal summary language
-> No: summarize as useful comparison signal

Did the user save a takeaway?
-> Yes: attach to session/comparison and surface in history
-> No: keep comparison view available, but do not invent a conclusion
```
