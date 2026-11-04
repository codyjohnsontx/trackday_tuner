---
name: trackday-session-domain
description: "Use when changing trackday_tuner session answers, dates, device values, lap editing, track lookup, or circuit identity."
---

## What a Rider Told You

Three of this app's stored fields are answers, and a default is not one. The
session form's weather and tire-condition rows and the outcome panel's verdict
all once opened with an option pressed, so a rider who scrolled past filed a
claim into the setup diff, the prompts and the recommendation learning record.
`lib/session-answers.ts` holds the rule and `ChoiceRow`
(`components/ui/choice-row.tsx`) renders a row where `null` is a value. Which of
the three blocks a save follows the column: `sessions.conditions` and
`session_feedback.outcome` are NOT NULL so they are required, and
`tires.condition` is inside JSON so it stores null. The outcome panel's two
1-5 ratings (rider confidence, AI usefulness) are nullable and open on "Not
rated", so an untouched one stores null (`buildSessionOutcomeBody`).

The same shape applies to anything derived rather than given:

- **Dates** come from `todayLocalDate` (`lib/local-date.ts`), never
  `toISOString()`, which is UTC and hands an evening rider west of Greenwich
  tomorrow's date. The rider's calendar day is only knowable in their browser, so
  it is seeded once hydrated rather than during SSR. Server text that dates a
  rider's own action (the AI refusal's "the outcome you logged on <date>") goes
  through `riderDateOfTimestamp` with the zone the request carries as `time_zone`
- **Device-only values** - that day, the zone, a localStorage preference or
  draft - are read through `components/ui/device-value.ts` (`useHydrated`,
  `preferenceSubscription`), never set from an effect: `react-hooks/set-state-in-effect`
  is on. Copy one into form state while rendering, keyed so it runs once, and
  hold any draft-save effect until the draft is read, or the first commit
  saves the empty form over it
- **Lap times** live in a `LapEditorValue` (`lib/lap-times.ts`) that carries the
  editor's entry boxes alongside the list. A save has to run
  `commitLapEditorValue` to get a lap array at all, because text a rider typed
  but never pressed "Add" on used to be dropped silently
- **Track names** are resolved server-side by `resolveSessionTrack` in
  `lib/sessions/create.ts`, using `lib/session-track.ts` to fold case, spacing
  and accent composition. Any other comparison of two track names goes through
  `trackNameKey` too, and a typed-name lookup of `tracks` through
  `findVisibleTrackByName`, never a raw `===` or `.eq('name')`.
  `lib/track-lookup.ts` is the one track-name resolver: the id/name/alias order,
  own-track-first, what counts as a custom track (and its label) and the
  custom-track cap each live there once, so a caller asks it rather than reading
  `is_seeded` or counting tracks itself. A supplied `track_id` is looked up in
  the same seeded-or-own scope the picker offers rather than trusted, and the
  row's own name wins over what was typed, so a session cannot store an id and a
  name that point at different circuits. Creating a row for a name that matches
  none is best effort: at the free-plan track cap, on an insert error, or when the name
  lookup could not answer - it failed, or filled `TRACK_NAME_MATCH_LIMIT` and so
  proves nothing - the session still saves with the name alone, and a row this
  code did create is deleted again when the session it was written for does not
  survive. The cap case is the one a rider is told about, on the form before
  Save and on the session page after: `describeSessionTrackGap`
  (`lib/session-track.ts`) is the one rule both read, worked out from the tracks
  and cap it is handed rather than from anything stored at save time. On the form
  that is a prediction as of page load, since Save counts again
- **A circuit is an identity, not a spelling.** North American circuits are
  seeded by a migration (20260916001600), not `supabase/seed.sql`, because the
  hosted project only ever receives migrations. Each carries a `slug` and the
  other names riders use (`track_aliases`). Case, spacing and Unicode
  composition (NFC - not accent removal) are the only fuzziness - no edit
  distance, because Road America and Road Atlanta are four edits apart. Layouts
  are `track_layouts` of one circuit and `sessions.layout_id` is optional; the
  `sessions_check_layout` trigger refuses a layout of a different circuit and
  keeps `layout_name` the layout row's own, because `authenticated` writes
  `sessions` directly. **The rules are `CONTEXT.md` and
  `docs/adr/0001-what-a-track-is.md`, not this code.** Two things the code does
  today are superseded there and not yet rebuilt: a typed name is looked up by
  the rider's own track first, so their custom row wins over a same-named seeded
  circuit (the seeded one is to win), and comparisons and personal bests group
  by track row and layout through `sessionsMatchCourse` / `courseMatchRank`
  (`lib/session-compare.ts`) with no direction (a configuration is venue, layout
  and direction). An unspecified layout is its own group and never joins a named
  one, and Race Engineer similar-session scoring is not layout-aware yet.
  `lib/track-directory.test.ts` checks the current lookup against the rows the
  migration ships. A session holding a name and no `track_id` (saved before the
  seed, at the custom-track cap, or left by a deleted track) is relinked by
  `relink_legacy_session_tracks` (20261004002800), the same lookup in SQL
  except that a name matching both an own and a seeded track is left alone
  (`own_and_seeded`) rather than decided before ADR 0001 is built; it is
  service_role only and safe to re-run, and a change to the lookup's rules
  changes that function too

