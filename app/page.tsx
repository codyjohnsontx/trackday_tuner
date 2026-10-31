import Image from 'next/image';
import { ArrowRight, Gauge, History, Sparkles } from 'lucide-react';
import { WaitlistForm } from '@/components/beta/waitlist-form';
import { Button } from '@/components/ui/button';

export default function HomePage() {
  // Full bleed: `calc(50% - 50vw)` walks from the edge of `main`'s content box
  // out to the viewport edge, past its padding AND the shell's 1024px cap
  // (`components/layout/app-shell.tsx`). It used to cancel the padding alone, so
  // at 1200px the hero and its photo stopped at x=1112 against a flat canvas
  // band, and at 1920px the lead rider was sliced off at x=1472. The copy does
  // not move: every section centres its own `max-w-4xl` column, and below 1024px
  // the two margins are the same number.
  return (
    <div className="-mt-5 mx-[calc(50%-50vw)]">
      <section className="relative min-h-[calc(100svh-4.5rem)] overflow-hidden border-b border-white/5 px-4 pb-12 pt-10 sm:px-8 md:px-12">
        {/* Photo: provenance unconfirmed - see PR discussion */}
        {/* Decorative rather than described: the headline and subhead carry the
            whole message, so announcing the backdrop only delays them. The two
            white shapes that used to sit here were dropped - they landed on the
            same right-hand third as the bikes and read as haze over them. */}
        {/* `sizes` has to answer "how wide will this be painted", and `object-cover`
            answers that from whichever axis is short. In PORTRAIT the box is taller
            than the photo's 16:9, so the fit is height-driven and the painted width
            is ~16/9 of the hero height rather than the viewport width - `100vw`
            alone would hand a 390px phone a 640px source and stretch it across
            ~1370px. In LANDSCAPE the box is wider than 16:9 and the fit flips to
            width-driven, where `178vh` under-advertises: measured at 844x390 dpr1
            the browser picked w=750 for an 844px paint. So each branch advertises
            whichever of the two is LARGER. The box is full bleed, so its width is
            the viewport width at every size and `100vw` wins once the viewport
            reaches 16/9. There used to be a third branch pinning 1024px above the
            shell's cap; the hero no longer sits inside that cap, so it went.
            The residue this cannot reach: the box grows past `100svh-4.5rem` when
            the copy outgrows that min-height, and no `vh` figure sees that. It
            needs a viewport short enough to wrap the copy tall - measured fine at
            every size in the e2e matrix - and the source caps at 2000px, so the
            failure is a mild upscale and never an over-download. */}
        {/* `44%` centres the crop on the leading pair: a 1024px-wide desktop hero
            shows 70% of the frame (all three bikes), a 390px phone shows 28% and
            lands on the KTM whole. Pushing it right to follow the subjects loses
            the phone crop into one rider's back. Above 1024px the full-bleed box
            widens towards 16:9 and shows more of the frame, until at 1920x1080
            the whole width of it is in view and the position has nothing to
            choose. */}
        <Image
          src="/images/gpslide.webp"
          alt=""
          aria-hidden
          fill
          priority
          sizes="(min-aspect-ratio: 16/9) 100vw, 178vh"
          className="object-cover object-[44%_45%] opacity-60"
        />
        {/* Same canvas fades as the login hero, plus one it does not need. That
            hero is a 42svh band with its text on the bottom edge; this one is
            full height with the text centred, so a top-and-bottom pair alone
            leaves the headline over the brightest part of the frame. The third
            fade runs left to right instead, which suits the composition: the
            copy sits on near-canvas at the left and the bikes keep the right.
            It has to reach further across a 390px phone, where the copy is full
            width, than across the 1024px shell - hence the `lg:` stops. They are
            at `lg:` and not `sm:` because 1024px is where the shell's max-w-5xl
            cap makes that desktop assumption true; taking over at 640px left the
            transparent right-hand end under the tail of a 72px headline that is
            still near-full-width, and the second line measured 1.6:1 there.
            That leaves 640-1023 on the phone's end stop, which is too light for
            a headline this wide - so `sm:to-canvas/72` carries the band alone.
            /72 is the lightest step that holds the ink-faint second line over
            3:1 at every width in it (worst 3.03 at 740); /70 and /71 read as
            clearing on a coarse sweep and dip to 2.95-2.99 around 690-750, which
            is why the band was measured at 4px. It is bounded on both sides by
            stops already here - `to-canvas/65` still governs below 640 and
            `lg:to-transparent` above 1023 - so phone and desktop do not move.
            The stops are percentages of a box that is now full bleed, so above
            1024px they scale with the viewport while the copy stays on its
            centred column. The `lg:via-[72%]` stop moves right 0.72px for every
            viewport px and the headline's right edge (at most `50% + 320px`)
            only 0.5px, so the scrim covers more of the copy at every width
            above 1024 than it does at 1024, and the contrast measured there is
            the floor for every desktop. Only the photo's right-hand end ever
            reaches the transparent stop. */}
        <div className="absolute inset-x-0 top-0 h-[22%] bg-gradient-to-b from-canvas to-transparent" />
        <div className="absolute inset-x-0 bottom-0 h-[45%] bg-gradient-to-t from-canvas via-canvas/80 to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-r from-canvas via-canvas/90 via-[55%] to-canvas/65 sm:to-canvas/72 lg:via-canvas/85 lg:via-[72%] lg:to-transparent" />
        <div className="relative z-10 mx-auto flex min-h-[calc(100svh-11rem)] max-w-4xl flex-col justify-center">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-ink-faint">Founding beta · Motorcycle track days</p>
          <h1 className="mt-5 max-w-3xl text-5xl font-black leading-[0.94] tracking-[-0.045em] text-ink sm:text-7xl">Know what changed.<br /><span className="text-ink-faint">Learn what worked.</span></h1>
          <p className="mt-6 max-w-xl text-base leading-relaxed text-ink-dim sm:text-lg">Log the setup, compare the result, and get conservative AI guidance grounded in your own track history.</p>
          {/* These two were hand-written anchors carrying a copy of the button
              utilities, so the page built the same control two ways - the
              waitlist CTA in the section below is the real component. The copy
              had drifted: "Explore the demo" was painted `bg-surface`, the card
              shade, where a control is `bg-surface-3`, which is why it read as
              a flat patch against the photo rather than something to press. It
              also carried `hover:border-white/10` while having no border. */}
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Button asChild>
              <a href="#beta">Join the Founding Beta <ArrowRight className="ml-2 h-4 w-4" /></a>
            </Button>
            <Button asChild variant="secondary">
              <a href="/demo">Explore the demo</a>
            </Button>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-4xl px-4 py-16 sm:px-8">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-ink-faint">The learning loop</p>
        <div className="mt-8 grid gap-8 md:grid-cols-3">
          <div><Gauge className="h-6 w-6 text-ink-dim" /><h2 className="mt-4 text-xl font-bold">Capture the session</h2><p className="mt-2 text-sm leading-relaxed text-ink-dim">Pressures, clickers, conditions, symptoms, and optional lap times—without forcing every field.</p></div>
          <div><History className="h-6 w-6 text-ink-dim" /><h2 className="mt-4 text-xl font-bold">Compare the signal</h2><p className="mt-2 text-sm leading-relaxed text-ink-dim">See what changed and whether pace, consistency, or rider feel moved in the right direction.</p></div>
          <div><Sparkles className="h-6 w-6 text-ink-dim" /><h2 className="mt-4 text-xl font-bold">Choose the next test</h2><p className="mt-2 text-sm leading-relaxed text-ink-dim">Race Engineer uses your outcomes and trusted setup guidance to suggest one small, reversible change.</p></div>
        </div>
      </section>

      <section id="beta" className="border-t border-white/5 bg-surface px-4 py-16 sm:px-8">
        <div className="mx-auto grid max-w-4xl gap-10 md:grid-cols-[0.85fr_1.15fr]">
          <div><p className="text-xs font-semibold uppercase tracking-[0.2em] text-ink-faint">12 founding riders</p><h2 className="mt-4 text-3xl font-black tracking-tight">Two track days. One honest outcome loop.</h2><p className="mt-4 text-sm leading-relaxed text-ink-dim">We&apos;re prioritizing intermediate and advanced motorcycle riders with two events in the next 90 days. Drive a car? Join the list—car-focused testing follows the first cohort.</p></div>
          <WaitlistForm />
        </div>
      </section>
    </div>
  );
}
