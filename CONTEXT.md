# Context

The domain words Track Tuner builds against, each with the rule that governs it; the reasoning is in `docs/adr/`.

## The track model

Owner-approved on 2026-09-21. The decision and its consequences are in
[docs/adr/0001-what-a-track-is.md](docs/adr/0001-what-a-track-is.md). Where the
code does not do what a term says yet, the entry says **not yet built** - read
those as the target, not as current behaviour.

**Track (venue)** - The physical place a rider rides, such as Buttonwillow
Raceway Park. History is shown by venue: session lists, counts and days at the
track group every session there, each labelled with its layout and direction.
Renaming a track changes what its past sessions display; the name as it was
typed is kept in the data. *Not yet built: sessions display the name stored when
they were logged, not the track's current name.*

**Layout** - A configuration of one venue, such as Config 13 at Buttonwillow
(`track_layouts`). The session form asks for one when a circuit has more than one
and picks it automatically when there is only one. Only seeded tracks have
layouts; riders cannot make their own. *Not yet built: the form offers layouts as
optional with "Not specified", and does not pick a lone layout automatically.*

**Direction** - Clockwise or counter-clockwise, a separate choice on top of the
layout that defaults to the circuit's normal direction. A seeded circuit's normal
direction is cited from its own published track map and left blank where that
cannot be confirmed. A custom track offers the choice but leaves it blank unless
the rider picks one. *Not yet built: there is no direction field. Only
Buttonwillow records direction today, inside two layout names ("Config 13
Clockwise", "Config 13 Counter-Clockwise"), which are to become one layout with
two directions.*

**Configuration** - The same venue, the same layout and the same direction.
Performance is compared per configuration: personal bests, session comparisons
and Race Engineer similar-session scoring. A session missing a layout or a
direction is its own group and is never assumed onto another configuration.
*Not yet built: comparisons and personal bests group by venue and layout
(`sessionsMatchCourse` in `lib/session-compare.ts`) with no direction, and Race
Engineer similar-session scoring is not layout-aware.*

**Seeded track** - A venue the app ships, from a migration, with a slug, its
layouts and its aliases. Where a seeded track and a custom track are the same
venue, the seeded one wins.

**Custom track** - A venue a rider types because it is not seeded. It is a
fallback and counts against the free plan's track limit. Deleting one that has
sessions offers to move them to another track, suggesting the seeded circuit when
one exists; with nowhere sensible, the sessions are unlinked and the rider is
told exactly what is lost, including the Race Engineer's learned memory for that
track. *Not yet built: deleting a custom track unlinks its sessions and deletes
that memory without offering a move or saying so.*

**Your older entry** - A rider's custom track for a venue that is now seeded. A
typed name matching both goes to the seeded circuit, and the custom one stays in
the picker labelled "your older entry" until the rider merges it. A merge happens
only on the rider's yes to a one-tap prompt stating how many sessions will move,
and it frees one of the free plan's custom-track slots. *Not yet built: a typed
name matching both goes to the rider's own track (the rule added in PR #73's
review round), the picker labels it "Custom", and there is no merge.*

**Alias** - Another name for a seeded circuit, such as "COTA"
(`track_aliases`). Aliases are curated; riders cannot add them. When a rider
types a name that matches nothing and then picks a seeded circuit, that pairing
is recorded, and a person reviews the common ones for promotion to aliases.
*Not yet built: pairings are not recorded.*

**Name matching** - Two names are the same when they are equal after folding
case, surrounding and repeated whitespace, and accent composition (NFC)
(`trackNameKey` in `lib/session-track.ts`). Nothing else is fuzzy; anything more
goes through the alias list.
