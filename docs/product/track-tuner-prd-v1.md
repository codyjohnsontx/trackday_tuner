# Track Tuner PRD v1.0

## One-liner
Track Tuner is a mobile-first motorsport setup logger for motorcycles and cars with free and paid tiers, designed to help drivers capture session changes quickly and build toward AI-assisted guidance later.

## Goals
- Let a basic user log a session in under 60 seconds.
- Support deeper setup detail without forcing complexity on everyone.
- Convert free users to paid users through genuinely useful advanced features.
- Build a clean data foundation for analytics and AI recommendations.

## Non-goals
- Social feed or follower features
- Real-time telemetry ingestion
- Native mobile apps for the first release

## Core Users
- Track day riders
- HPDE and time attack drivers
- Club racers

## Core Use Cases
- Compare current setup changes against previous sessions.
- Support beginners who only know tire pressure and notes.
- Support advanced users who want geometry, suspension, and alignment detail.
- Build toward safe, incremental AI guidance after each session.

## Product Principles
- Mobile-first always
- Progressive complexity
- Modules over mandatory fields
- Fast capture over perfect capture
- Avoid skill-level gates based on self-labeling

## Core Concepts
- Vehicles can be motorcycles or cars.
- A session ties together vehicle, track, date/time, conditions, notes, and optional setup modules.
- Setup modules are flexible JSON payloads so the model can grow without constant schema churn.

## MVP Features
### Auth and Accounts
- Email sign-up and sign-in
- User profile
- Free/pro tier flag

### Garage
- Create and edit vehicles
- Support motorcycle and car types
- Minimal required fields with optional vehicle details

### Tracks
- Seeded track list plus user-created tracks
- Track detail pages

### Sessions
- Quick-create session flow
- Track, date, optional session number
- Optional conditions
- Notes always available

### Optional Setup Modules
Motorcycle:
- Tires
- Suspension
- Geometry
- Drivetrain
- Notes

Car:
- Tires
- Alignment
- Suspension
- Aero
- Notes

### History and Compare
- Session list by vehicle
- Session detail page
- Compare with the previous session

## Free vs Pro
Free:
- 1 vehicle
- 3 tracks
- 20 sessions total in the original PRD
- Core logging and basic compare

Pro:
- Unlimited vehicles, tracks, and sessions
- Advanced comparisons
- Exports
- Analytics
- AI setup assistant when launched

Pricing:
- Base price: `$2.99/month`
- Founder price: `$1.99/month` with code `FOUNDER100` for the first 100 redemptions

## AI Setup Assistant
Planned behavior:
- Ask clarifying questions when needed
- Suggest small, safe changes
- Explain tradeoffs
- Link suggestions to prior sessions
- Clearly state that suggestions are informational and not telemetry-driven

## UX Requirements
- One-handed entry
- Large tap targets
- Strong contrast
- Local draft saving
- Minimal typing

## Tech Stack
- Next.js App Router
- Tailwind
- Supabase
- Stripe
- Vercel

## Architecture Notes
- Relational core for users, profiles, vehicles, tracks, and sessions
- Flexible JSON payloads for modules
- Server-side feature gating for plan limits

## Success Metrics
- Time to first logged session
- Sessions per active user
- Repeat-session rate
- Free-to-pro conversion rate
