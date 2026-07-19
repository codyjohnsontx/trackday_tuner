import Link from 'next/link';
import { ArrowRight, Gauge, History, Sparkles } from 'lucide-react';
import { WaitlistForm } from '@/components/beta/waitlist-form';

export default function HomePage() {
  return (
    <div className="-mx-4 -mt-5 sm:-mx-5 md:-mx-6">
      <section className="relative min-h-[calc(100svh-4.5rem)] overflow-hidden border-b border-zinc-800 px-4 pb-12 pt-10 sm:px-8 md:px-12">
        <div aria-hidden className="absolute -right-32 top-8 h-[34rem] w-[34rem] rotate-12 rounded-[45%] border-[3rem] border-zinc-900/80 shadow-[0_0_0_1px_rgba(34,211,238,0.08)] sm:right-0" />
        <div aria-hidden className="absolute right-20 top-24 h-64 w-24 -rotate-12 rounded-full bg-cyan-400/10 blur-3xl" />
        <div className="relative z-10 mx-auto flex min-h-[calc(100svh-11rem)] max-w-4xl flex-col justify-center">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-cyan-300">Founding beta · Motorcycle track days</p>
          <h1 className="mt-5 max-w-3xl text-5xl font-black leading-[0.94] tracking-[-0.045em] text-zinc-50 sm:text-7xl">Know what changed.<br /><span className="text-zinc-500">Learn what worked.</span></h1>
          <p className="mt-6 max-w-xl text-base leading-relaxed text-zinc-300 sm:text-lg">Log the setup, compare the result, and get conservative AI guidance grounded in your own track history.</p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row"><a href="#beta" className="inline-flex min-h-12 items-center justify-center rounded-xl bg-cyan-400 px-5 text-sm font-bold text-zinc-950 transition hover:bg-cyan-300 active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-cyan-400/80">Join the Founding Beta <ArrowRight className="ml-2 h-4 w-4" /></a><Link href="/demo" className="inline-flex min-h-12 items-center justify-center rounded-xl border border-zinc-700 bg-zinc-900/70 px-5 text-sm font-semibold text-zinc-100 transition hover:border-zinc-600 hover:bg-zinc-900 focus-visible:ring-2 focus-visible:ring-cyan-400/80">Explore the demo</Link></div>
        </div>
      </section>

      <section className="mx-auto max-w-4xl px-4 py-16 sm:px-8">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">The learning loop</p>
        <div className="mt-8 grid gap-8 md:grid-cols-3">
          <div><Gauge className="h-6 w-6 text-cyan-300" /><h2 className="mt-4 text-xl font-bold">Capture the session</h2><p className="mt-2 text-sm leading-relaxed text-zinc-400">Pressures, clickers, conditions, symptoms, and optional lap times—without forcing every field.</p></div>
          <div><History className="h-6 w-6 text-cyan-300" /><h2 className="mt-4 text-xl font-bold">Compare the signal</h2><p className="mt-2 text-sm leading-relaxed text-zinc-400">See what changed and whether pace, consistency, or rider feel moved in the right direction.</p></div>
          <div><Sparkles className="h-6 w-6 text-cyan-300" /><h2 className="mt-4 text-xl font-bold">Choose the next test</h2><p className="mt-2 text-sm leading-relaxed text-zinc-400">Race Engineer uses your outcomes and trusted setup guidance to suggest one small, reversible change.</p></div>
        </div>
      </section>

      <section id="beta" className="border-t border-zinc-800 bg-zinc-900/30 px-4 py-16 sm:px-8">
        <div className="mx-auto grid max-w-4xl gap-10 md:grid-cols-[0.85fr_1.15fr]">
          <div><p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-300">12 founding riders</p><h2 className="mt-4 text-3xl font-black tracking-tight">Two track days. One honest outcome loop.</h2><p className="mt-4 text-sm leading-relaxed text-zinc-400">We&apos;re prioritizing intermediate and advanced motorcycle riders with two events in the next 90 days. Drive a car? Join the list—car-focused testing follows the first cohort.</p></div>
          <WaitlistForm />
        </div>
      </section>
    </div>
  );
}
