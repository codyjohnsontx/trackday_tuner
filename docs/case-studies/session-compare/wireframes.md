# Session Compare Text Wireframes

Design direction: mobile-first Track Tuner UI, dark zinc surfaces, cyan accent, compact cards, clear touch targets.

## 1. Session Detail With Compare CTA

Purpose:

- Make comparison a natural next action from an existing session.

```text
[Header]
Road Atlanta
Saturday, June 13, 2026 · R6 Track

[Primary action row]
[ Compare ] [ Ask Race Engineer ]

[Existing compare card]
Compare with previous session
3 changed setup fields

[Session info]
Track · Vehicle · Date · Conditions

[Setup modules]
Tires
Suspension
Notes
```

Primary action:

- Compare.

Secondary action:

- Ask Race Engineer.

Empty/error state:

- If no prior sessions exist, show "No earlier session found for this vehicle."

Portfolio note:

- Shows the extension starts from a real current workflow instead of adding a disconnected analytics area.

## 2. Compare Session Picker

Purpose:

- Help the user choose a meaningful comparison quickly.

```text
[Header]
Compare Session
Choose a baseline to compare against

[Recommended]
Same vehicle · Same track

[Session card]
June 13 · Session 2 · Road Atlanta
Best lap: 1:42.8 · 6 laps
[Selected]

[Other sessions]
Same vehicle, different track
Different vehicle

[Warning]
Different tracks can still be compared, but the result is weaker.

[Action]
[ Compare sessions ]
```

Primary action:

- Compare sessions.

Secondary action:

- Cancel.

Empty/error state:

- "No other sessions found for this vehicle."

Portfolio note:

- Shows PM judgment by prioritizing comparable sessions without blocking advanced users.

## 3. Comparison Overview

Purpose:

- Give the user the answer before the details.

```text
[Header]
Session Compare
Road Atlanta · R6 Track

[Confidence]
Useful comparison
Track temp was 11 C hotter in Session B.

[Summary cards]
Best lap      -0.8s
Average lap   -0.3s
Lap count      6 vs 7
Consistency   +0.2s spread

[Plain summary]
Session B was faster on best lap and average lap, but conditions changed. Treat this as a comparison signal, not proof.

[Tabs/anchors]
Pace · Setup · Context · Takeaway
```

Primary action:

- Save takeaway.

Secondary action:

- Jump to chart sections.

Empty/error state:

- If lap data is missing, show setup/context comparison first.

Portfolio note:

- Shows the product separates "faster" from "trustworthy."

## 4. Lap-Time Chart Section

Purpose:

- Let the user inspect pace, consistency, and lap-by-lap deltas.

```text
[Section]
Pace over session

[Line chart]
Lap 1  Lap 2  Lap 3  Lap 4  Lap 5  Lap 6
Baseline line
Comparison line

[Insight]
Session B improved after lap 3 but faded less at the end.

[Delta bars]
Lap 1 +0.2
Lap 2 -0.1
Lap 3 -0.6
Lap 4 -0.8

[Note]
Lower lap time is better.
```

Primary action:

- Continue to setup deltas.

Secondary action:

- Edit lap times.

Empty/error state:

- "Add lap times to both sessions to unlock pace charts."

Portfolio note:

- Shows charts are tied to user questions, not added for decoration.

## 5. Setup Delta Section

Purpose:

- Show what changed between sessions without making the user scan every logged field.

```text
[Section]
Setup changes
[Toggle] Show unchanged

[Tires]
Front pressure
Baseline: 31 psi
Session B: 30 psi

Rear pressure
Baseline: 29 psi
Session B: 28 psi

[Suspension]
Front rebound
Baseline: 8 clicks
Session B: 9 clicks

[Notes]
Baseline: Front pushed mid-corner
Session B: Better entry, rear greasy after lap 4
```

Primary action:

- Add takeaway.

Secondary action:

- Show unchanged fields.

Empty/error state:

- "No changed setup fields between these sessions."

Portfolio note:

- Shows continuity with the current `SessionCompare` component while making the feature more decision-oriented.

## 6. Confidence Warnings Section

Purpose:

- Make caveats visible and actionable.

```text
[Section]
How much should I trust this?

[Label]
Useful comparison

[Flags]
- Same vehicle and track
- Track temp 11 C hotter
- Tire condition changed from fresh to used
- Session B has one fewer logged lap

[Guidance]
Use this to choose what to test next, not as proof that one setup caused the lap-time change.
```

Primary action:

- Save takeaway.

Secondary action:

- Review session notes.

Empty/error state:

- "Comparison context is limited because conditions were not logged."

Portfolio note:

- Shows safety and product integrity by preventing false certainty.

## 7. Saved Takeaway / Next-Session Plan

Purpose:

- Turn analysis into a concrete next step.

```text
[Section]
Takeaway

[Text area]
Lower front pressure and one more rebound click seemed worth testing, but track temp was hotter. Keep changes small next session.

[Next-session focus]
[ ] Recheck hot pressures
[ ] Watch rear grip after lap 4
[ ] Keep front rebound setting

[Action]
[ Save takeaway ]
```

Primary action:

- Save takeaway.

Secondary action:

- Clear draft.

Empty/error state:

- If the user leaves it blank, allow skipping; do not force a conclusion.

Portfolio note:

- Shows the feature ends with a decision, not just a dashboard.
