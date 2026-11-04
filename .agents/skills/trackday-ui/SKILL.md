---
name: trackday-ui
description: "Use when changing trackday_tuner UI components, styling, design tokens, layout, typography, or global CSS."
---

## UI Component Rules

- All UI primitives live in `components/ui/`
- Use `cn()` from `@/lib/utils` for all class composition — never string concatenation
- Use `cva` for multi-variant components (Button, Badge, Card)
- `Select` stays as native `<select>` (mobile-first; Radix Select degrades on touch)
- Radix primitives in use: `@radix-ui/react-slot` (Button), `@radix-ui/react-toggle-group` (SegmentedControl), `@radix-ui/react-tooltip` (InfoTooltip)
- Keep `*.custom.tsx` backup files until visual QA is confirmed, then delete

## Design Conventions

- Dark mode only — no light mode
- Mobile-first, max-w-5xl (1024px) app shell - the cap lives in `components/layout/app-shell.tsx`,
  on the header's content and on `main` rather than on the root, so a screen can bleed to the
  viewport edge with `mx-[calc(50%-50vw)]` while its copy stays on the column (the landing hero does)
- 44px minimum touch targets
- Use the tokens in `app/globals.css`, never raw palette classes (`zinc-*`, `cyan-*`, `amber-*`)

**Surfaces.** Separation comes from a lightness ramp, not borders. `canvas` is the
page, `surface` a card on it, `surface-2` a row nested in that card, `surface-3` a
control on that row. Never skip a step, and never nest deeper than `surface-3`.
Radii tighten with depth along a four-rung ladder: `rounded-card` →
`rounded-row` → `rounded-plate` → `rounded-control`, tight on purpose (10/8/6/6)
so the app reads as instrumentation rather than as a consumer app.
`rounded-control` is the rung a *free-standing* pressable thing sits on; one that
is a row in a list or a segment of a track takes its container's rung instead so
the two agree, which is why the drawer navigation rows, `ChoiceRow` and the
settings segmented control are `rounded-row`. What picks the rung is what the
element is in the layout - not whether it can be pressed, and not its surface
tone, which does not track the rung (`rounded-control` sits on `bg-surface-2` in
several places). `rounded-full` is reserved for
what is round by nature - the floating nav pill, status chips, badges, dots, the
press ripple - and squaring one of those makes a label look pressable. The values
and the reasoning live in the `@theme` block of `app/globals.css`;
`tests/unit/radius-ladder.test.ts` locks them and the Button's rung.

**Ink.** `ink` for primary text, `ink-dim` for secondary, `ink-faint` for eyebrows
and metadata. Dark ink on a bright fill is `text-canvas`, never `ink-faint`.

**Accent.** `signal` (sodium amber `#ffb020`) is the only accent and marks
*interaction or caution*: active tab, focus ring, warnings, live markers. It never
encodes data and never labels a section — an uppercase eyebrow is `ink-faint`.
Data semantics are `faster` (green) and `slower` (red), which is why the accent is
deliberately neither. Primary buttons are a white fill (`bg-ink text-canvas`), not
an accent fill, so the accent stays scarce enough to mean something.

**Type.** `font-display` (Barlow Semi Condensed 600, owner's pick 2026-10-18 over
the Instrument Serif it replaced) is for page titles only - use `PageHeader` or
`pageTitleClass`. It is loaded once in `app/layout.tsx` and reaches the utility
through `--font-display` in `@theme`; `tests/unit/display-face.test.ts` compiles
the stylesheet and checks a rendered title resolves to that face at 600. Everything carrying a measurement stays on the
system sans. Digits are tabular by default.

**Primitives.** Compose screens from `components/ui/surface.tsx` (`Card`,
`CardGroup`, `GroupRow`, `Eyebrow`, `SectionHeader`), `PageHeader`, and `DataPlate`
rather than hand-rolling card markup, and a button from `components/ui/button.tsx`
(`asChild` when it has to render a link) rather than a copy of its utility classes,
which drifts.

## CSS Variables

`app/globals.css` defines no shadcn CSS variables - the project follows the
shadcn *pattern* (`cva` + `cn()`) but not its token set. Tailwind v4 project
tokens live in `@theme { ... }`; the only `:root` block is a `color-scheme`
declaration inside `@layer base`. Those are separate namespaces, no collision.

## Cascade Layers

**Every rule in `app/globals.css` must sit inside a layer**: `@layer base` for
element defaults, `@layer components` for helper classes. Tailwind v4 emits all
utilities inside `@layer utilities`, and unlayered CSS beats layered CSS at any
specificity, so one unlayered rule silently outranks a whole family of utilities
with no warning from the build, the linter, or the types. Layers rank by first
declaration, so the layer has to be one Tailwind declares before `utilities`: a
layer of your own is first declared after them and outranks every utility exactly
the way an unlayered rule does, and `utilities` itself is not somewhere to write.
An `@import` cannot be wrapped in a layer, so it carries a `layer(...)` clause
naming one of those layers instead - only `tailwindcss` itself arrives already
layered.

`tests/unit/globals-css-layers.test.ts` enforces this and runs in the required
checks; the comments in `app/globals.css` record why each block is layered. That
guard reads one file, so a contrast regression arriving any other way - a changed
token, a Button variant, a new component - still needs a browser. Only the e2e
suite asserts a rendered colour.

