# 0001 - What a track is

- **Status:** Accepted
- **Date:** 2026-09-21
- **Decided by:** the owner, in a one-question-at-a-time session, confirmed with
  "yes that's my definition, go ahead"

The terms are defined in [CONTEXT.md](../../CONTEXT.md). This record says why,
and what changes. Most of it is **not yet built**: the decision is the target the
code is moving to, not a description of what it does today. The consequences
below list each gap.

## Context

Track Tuner had no agreed answer to "what is a track?". A track row stood in for
the venue, the layout and the spelling a rider typed, depending on which code
read it. In one week that fuzziness produced four separate bugs:

- **Case and spacing variants were flagged as mismatches.** Two sessions
  logged as "COTA" and "cota" were compared as raw strings, so a comparison
  between them carried a critical "Track mismatch" (PR #76, cf23591).
- **Two layouts were scored as one track.** Race Engineer similar-session
  scoring fell back to the track name whenever two track ids differed, so two
  layouts of one venue whose names folded together got the full same-track
  score, and advice could be grounded in the wrong layout (PR #76, 09c4317).
- **A false "Track limit reached" warning after a rename.** A copied setup or a
  restored draft carried the old track name; once the track was renamed that
  name matched none of the rider's tracks, so the form warned a free rider about
  a save that would have linked fine (PR #75, eafbd1d).
- **Duplicate custom tracks split a season.** "Circuit of the Americas" in April
  and "COTA" in May became two custom tracks, two of a free rider's three
  slots, and a season that grouped under neither (PR #73).

Each was fixed on its own terms, and each fix re-derived what a track is. The
next three jobs - merging duplicates, recording direction, and making the Race
Engineer layout-aware - would each have to do the same.

## Decision

1. A track is the VENUE, the physical place. A layout is a configuration of that
   venue. (Owner: "the venue, there should be a layouts as different configs
   because sometimes trackdays will run different configs or direction of
   travel - aka clockwise/counterclockwise".)
2. Direction of travel is a SEPARATE choice on top of the layout, defaulting to
   the circuit's normal direction. Buttonwillow's two seeded Config 13 layouts
   ("Config 13 Clockwise", "Config 13 Counter-Clockwise") become one layout with
   two directions.
3. Each seeded circuit's normal direction is researched and cited from the
   circuit's own published track map, the same sourcing standard as the seeded
   layouts. It stays blank wherever it cannot be confirmed; never guess.
4. "The same configuration" means the same venue, the same layout and the same
   direction.
5. History is shown by VENUE - session lists, counts, days at the track - with
   each session labelled by its layout and direction. Performance is per
   CONFIGURATION - personal bests, comparisons, and Race Engineer
   similar-session scoring.
6. A session missing a layout or a direction forms its own group for
   performance; it is never assumed onto another configuration. The session form
   asks for a layout when a circuit has more than one, and picks it automatically
   when there is only one.
7. Custom tracks - ones a rider types when the venue is not seeded - are a
   FALLBACK. Where a seeded version of the same venue exists, the seeded one
   wins.
8. New sessions default to the seeded circuit when a typed name matches both it
   and the rider's own custom track. The rider's older entry stays visible in the
   picker as "your older entry" until merged. This reverses the "prefer the
   rider's own track over a same-named seeded circuit" rule added in PR #73's
   review round.
9. An existing duplicate - a rider's custom track for a venue that is now
   seeded - merges only with the rider's yes: a one-tap prompt stating how many
   sessions will move. Nothing moves silently. A merged, retired custom track
   frees one of the free plan's custom-track slots.
10. Custom tracks get the direction choice only, left blank unless the rider
    picks one. No rider-made layouts for now; that is a recorded known limit, to
    revisit if riders ask.
11. Renaming a track updates what past sessions display: they show the track's
    CURRENT name. The name as logged is kept in the data as a record of what was
    typed.
12. Deleting a custom track that has sessions offers to move those sessions to
    another track, suggesting the seeded circuit when one exists. If there is
    nowhere sensible, the sessions are unlinked and the rider is told exactly
    what is lost, including the Race Engineer's learned memory for that track.

**Aliases** (nicknames and abbreviations such as "COTA") stay CURATED. When a
rider types a name that matches nothing and then picks a seeded circuit anyway,
record that pairing; the common ones are reviewed by a person and promoted to
real aliases. Riders cannot add aliases.

**Name matching** folds case, surrounding and repeated whitespace, and accent
composition (NFC), and nothing else; anything more goes through the curated alias
list.

## Consequences

Already true, and kept:

- Venues and layouts are separate rows (`tracks`, `track_layouts`), and seeded
  venues carry curated aliases (`supabase/migrations/20260916001600_seed_north_america_tracks.sql`).
- Name matching is `trackNameKey` (`lib/session-track.ts`), which folds exactly
  case, whitespace and NFC. Riders can only read `track_aliases`.
- Comparisons and personal bests group by venue and layout, and a session with
  no layout is its own group (`sessionsMatchCourse` / `courseMatchRank` in
  `lib/session-compare.ts`).
- Riders cannot create layouts (decision 10's known limit).

Contradicted by current behaviour - **not yet built**:

- **PR #73's rule is reversed.** `findTrackByName` (`lib/track-directory.ts`)
  prefers the rider's own track over a same-named seeded circuit, and
  `createSession` saves to it; the picker labels it "Custom". Decision 8 sends
  the session to the seeded circuit and labels the custom one "your older
  entry". The same file's header also resolves a rider's own track name before a
  seeded alias, which decision 7 overrides where the two are the same venue.
- **Only Buttonwillow records direction today**, and only inside two layout
  names. There is no direction field, no normal direction on any circuit, and
  configuration therefore means venue and layout only. Decisions 2, 3, 4 and 10
  need a direction column, a data change folding Buttonwillow's two Config 13
  layouts into one, and a cited normal direction per seeded circuit.
- **Race Engineer similar-session scoring is not layout-aware**, so decision 5
  is not met for the Race Engineer even before direction exists.
- **The layout picker** is optional with a "Not specified" choice and never
  picks a lone layout automatically (decision 6).
- **There is no merge** of a duplicate custom track, so its sessions stay split
  and it keeps occupying a free-plan slot (decision 9).
- **Past sessions show the name they were logged with** (`sessions.track_name`),
  not the track's current name (decision 11).
- **Deleting a custom track** unlinks its sessions (`on delete set null`) and
  deletes the Race Engineer memory for it (`race_engineer_memory.track_id` is
  `on delete cascade`) with no offer to move them and no statement of what is
  lost (decision 12).
- **Unmatched-name pairings are not recorded**, so there is nothing yet to
  review for promotion to aliases.
- **History by venue** is partly there: the track page lists a venue's sessions
  labelled with their layout, but there is no direction to label.

Future work on tracks builds against this record. A change that needs a
different definition updates this record, through a new decision record that
supersedes it, rather than re-deriving one in code.
