Track Tuner PRD v1.0

1. One-liner

A mobile-first motorsport setup logger for motorcycles + cars with free + paid tiers, designed to help drivers record sessions, compare changes, and eventually get AI guidance based on what they felt and what they changed.

2. Goals

Make it effortless to log a session at the track in under 60 seconds (for a basic user).

Let advanced users go deep without forcing complexity on everyone.

Convert users naturally from free → paid via genuinely useful advanced features.

Build a data foundation that supports analytics + AI recommendations later.

3. Non-goals (for MVP)

Social feed / sharing / followers

Real-time telemetry ingestion (possible later)

Native mobile apps (PWA-ready is enough initially)

4. Users & Use Cases
   Primary Users

Track day riders (motorcycle)

HPDE / time attack drivers (car)

Club racers (both)

Core Use Cases

“I changed tire pressures and rebound, and it felt worse—what did I do last time that felt good?”

“I’m a beginner: I only know tire pressures and notes.”

“I’m advanced: I want full alignment + damping + comparisons.”

“I want to understand what changes to try next session.”

5. Product Principles

Mobile-first always (thumb-friendly, sunlight-friendly, quick entry)

Progressive complexity (start simple, add modules as needed)

No skill-level gating by self-identity (people overestimate skill)

Modules over mandatory fields (only log what you know)

Fast capture > perfect capture (optimize for trackside reality)

6. Core Concepts & Data Model
   Vehicle Types

Motorcycle

Car

Session

A single on-track outing tied to:

Vehicle

Track

Date/time

Conditions

Setup modules (optional)

Modular Setup System

Users can add/remove modules per session.
Modules store data as JSON, allowing flexibility across vehicles and future expansion.

7. MVP Feature Set (V1)
   A) Auth & Accounts

Sign up / sign in (email + optional OAuth later)

User profile

Subscription tier flag (free/pro)

B) Garage

Create/edit vehicles

Vehicle type: motorcycle or car

Minimal required fields:

nickname (ex: “R6 Track”)

year/make/model (optional at creation, can add later)

C) Tracks

Track list (pre-seeded + user-added)

Track detail page

(Later: location + layouts)

D) Sessions (the heart)

Create session quickly

Inputs:

Track

Date

Session number (optional)

Conditions (temp, weather, track condition optional)

Notes (always available)

E) Setup Modules (optional per session)

Motorcycle modules:

Tires (front/rear pressures hot/cold)

Suspension (fork + shock clickers)

Geometry (sag, ride height notes)

Drivetrain (gearing)

Notes

Car modules:

Tires (FL/FR/RL/RR hot/cold)

Alignment (camber/toe/caster)

Suspension (damping / spring / bars)

Aero (optional)

Notes

Users can:

Add module

Skip module

Hide module defaults globally (settings)

F) History + Compare (basic in V1)

Session list by vehicle

Session detail view

“Compare with previous session” (simple diff of fields that exist)

8. Free vs Pro (initial plan)
   Free Tier

1 vehicle

3 tracks

20 sessions total

Core logging + notes

Basic compare with previous (limited)

Pro Tier

Unlimited vehicles / tracks / sessions

Advanced compare (choose any two sessions)

Exports (CSV)

Analytics views (simple charts later)

AI Setup Assistant (when launched)

Pricing rollout:
- Pro base price: `$2.99/month`
- Founder special: `$1.99/month` with promo code `FOUNDER100` (first 100 redemptions)

(We can tune the exact limits later, but this structure matches your “free → love it → subscribe” behavior.)

9. AI Setup Assistant (planned, not MVP)
   Concept

After a session, user enters:

what changed

what they experienced (ex: “front pushing mid-corner”, “rear spinning on exit”, “brake dive”)

AI returns:

clarifying questions (if needed)

suggested next change(s), in small safe increments

explains tradeoffs

links suggestion to prior sessions (“last time it felt better you had X”)

Constraints

Must include disclaimers: suggestions are informational; rider responsible

Should bias toward: “change one thing at a time”, “small increments”

Must be transparent: “based on your notes and past sessions, not real telemetry”

Data Needed

Structured symptom tags (optional, user-friendly)

Session diffs

Conditions + tires + setup modules where available

10. UX Requirements (Mobile First)
    Core UX Requirements

One-handed entry (thumb reachable)

Big tap targets

Dark mode default + high contrast

Works offline-ish (at least: local draft saving)

Minimal typing (toggles, stepper inputs, quick-select chips)

Session Entry Target

Basic session logged (track + notes + tires) in < 60 seconds

Advanced session entry still reasonable (modular cards)

11. Tech Stack (locked)

Next.js (App Router)

Tailwind

Supabase (Postgres + Auth + Storage)

Stripe (subscriptions)

Deployed on Vercel

12. Architecture Decisions
    Database approach

Relational core (users, vehicles, tracks, sessions)

JSON module payloads for flexibility

Suggested tables:

users (supabase auth)

profiles (tier, preferences)

vehicles

tracks

sessions

session_modules (module_type + json data)

subscriptions (Stripe mapping)

Feature gating

Enforce limits server-side:

counts per user

pro-only routes/features

13. Success Metrics

Time-to-first-session logged (activation)

Sessions per active user per month

% of users who create a 2nd session (retention)

Free → Pro conversion rate (after hitting limits / wanting compare/export/AI)

---

## Current Implementation Status

- Framework migrated to Next.js App Router + TypeScript + Tailwind v4.
- Mobile-first shell is implemented with routes for `/`, `/login`, `/signup`, and `/sessions/new`.
- Session logging supports both `motorcycle` and `car` modes.
- Session modules are optional per session and can be added/removed.
- Advanced fields are hidden by default and available through per-module toggles.
- Partial entry is supported and can be saved locally as a draft.

## Local Run

```bash
npm install
npm run dev
```

Then open `http://localhost:3000`.
