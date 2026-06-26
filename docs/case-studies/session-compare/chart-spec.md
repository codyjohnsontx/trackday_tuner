# Session Compare Chart Spec

## Chart Set

| Chart | User Question | Data Needed | Portfolio Reason |
|---|---|---|---|
| Lap Time Trend | Did pace improve, fade, or stabilize? | Manual lap times by lap number | Shows the product helps users see patterns, not just best lap |
| Best / Average / Consistency Summary | Was the user faster once, faster overall, or more consistent? | Best lap, average lap, lap count, lap spread | Separates peak pace from repeatable pace |
| Lap Delta Bars | Which laps were faster or slower in the comparison session? | Aligned lap numbers from two sessions | Makes gains/losses easy to scan |
| Setup Delta Summary | What changed mechanically? | Tires, suspension, alignment, geometry, drivetrain, aero | Connects performance review to setup logs |
| Confidence / Context Flags | Can I trust this comparison? | Track, vehicle, conditions, tire state, notes, missing data | Shows PM judgment and prevents misleading conclusions |

## Lap Time Trend

Purpose:

- Show how pace changed across each session.
- Help the user see whether they improved, faded, stabilized, or had only one standout lap.

Inputs:

- Lap number.
- Lap time for baseline session.
- Lap time for comparison session.
- Optional warm-up/cool-down labels later.

Display behavior:

- Use a two-line chart with baseline and comparison sessions.
- Use lap number on the x-axis and lap time on the y-axis.
- Lower lap time is better; label this clearly.
- Mark best lap for each session.

Empty state:

- "Lap trend unavailable. Add lap times to both sessions to compare pace over the run."

Warning state:

- If lap counts differ, chart both sessions but note that lap-by-lap alignment may be imperfect.

Must not imply:

- Do not imply a setup change caused the trend without context.

## Best / Average / Consistency Summary

Purpose:

- Separate peak pace from repeatable pace.

Inputs:

- Best lap.
- Average lap.
- Lap count.
- Consistency, defined for v1 as lap spread or standard deviation after excluding obvious warm-up/cool-down laps if known.

Display behavior:

- Use four compact stat cards.
- Show delta direction clearly.
- Use plain labels: "Best lap", "Average lap", "Laps", "Consistency".

Empty state:

- Show the cards with "Not logged" for missing metrics.

Warning state:

- If one session has fewer than three laps, mark consistency as weak.

Must not imply:

- Do not call a session "better" when only best lap improved but average and consistency worsened.

## Lap Delta Bars

Purpose:

- Make lap-by-lap gains and losses easy to scan.

Inputs:

- Baseline lap times.
- Comparison lap times.
- Matching lap numbers where available.

Display behavior:

- Use vertical bars by lap number.
- Faster comparison laps use cyan.
- Slower comparison laps use muted red or amber.
- Include a zero baseline.

Empty state:

- "Lap deltas need lap times in both sessions."

Warning state:

- If lap counts differ, compare only overlapping lap numbers and state how many laps were compared.

Must not imply:

- Do not treat non-overlapping laps as missing performance.

## Setup Delta Summary

Purpose:

- Show what changed mechanically or operationally.

Inputs:

- Tires.
- Suspension.
- Alignment.
- Geometry.
- Drivetrain.
- Aero.
- Notes.

Display behavior:

- Use grouped changed-field rows.
- Show baseline and comparison values side by side.
- Hide unchanged fields by default with a "Show unchanged" option.

Empty state:

- "No setup fields changed between these sessions."

Warning state:

- If one session has fewer modules enabled, show "Not logged" rather than blank values.

Must not imply:

- Do not imply every changed field is meaningful.

## Confidence / Context Flags

Purpose:

- Prevent users from overreading weak comparisons.

Inputs:

- Vehicle match.
- Track/layout match.
- Conditions.
- Track and ambient temperature.
- Tire condition and compound.
- Lap count.
- Notes.
- Missing data.

Display behavior:

- Use a short label: Strong comparison, Useful comparison, or Weak comparison.
- Show 2-4 concise flags.
- Put the warning near the top of the comparison, not buried below charts.

Empty state:

- If context is missing, label the comparison as "Useful with missing context" rather than hiding the warning.

Warning state:

- Major mismatch examples: different track, different vehicle, no lap data, rain vs dry, large track temperature change.

Must not imply:

- Do not present confidence as a scientific probability.
