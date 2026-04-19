import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export default function HomePage() {
  return (
    <div className="space-y-4">
      {/* Hero */}
      <section className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6">
        <p className="text-xs font-semibold uppercase tracking-wider text-cyan-400">Trackday Tuner</p>
        <h1 className="mt-2 text-2xl font-bold leading-tight text-zinc-100">
          Your setup sheet.<br />Every session. Always with you.
        </h1>
        <p className="mt-3 text-sm text-zinc-400">
          Stop writing clicker settings on tape. Log tires, suspension, alignment, and conditions between sessions — then compare what actually worked.
        </p>

        {/* Feature list */}
        <ul className="mt-5 space-y-2">
          {[
            { icon: '📋', text: 'Modular setup logging — tires, suspension, alignment, and more' },
            { icon: '🔁', text: 'Compare sessions side-by-side across the same track' },
            { icon: '🏎', text: 'Multi-vehicle garage — motorcycles and cars' },
            { icon: '🧮', text: 'Trackside tools: sag calculator and unit converter' },
          ].map(({ icon, text }) => (
            <li key={text} className="flex items-start gap-2 text-sm text-zinc-100">
              <span className="shrink-0">{icon}</span>
              <span>{text}</span>
            </li>
          ))}
        </ul>
      </section>

      {/* Early access */}
      <section className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">Get Early Access</h2>
        <form className="mt-3 space-y-3">
          <Input label="Email" type="email" placeholder="you@tracktuner.app" autoComplete="email" />
          <Button type="submit" fullWidth>
            Request Invite
          </Button>
        </form>
      </section>

      {/* Auth links */}
      <section className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
        <Link
          href="/login"
          className="block min-h-12 rounded-xl bg-cyan-400 px-4 py-3 text-center text-sm font-semibold text-zinc-950 transition hover:bg-cyan-300 focus-visible:ring-2 focus-visible:ring-cyan-400/80 active:scale-[0.98]"
        >
          Log In / Sign Up
        </Link>
      </section>
    </div>
  );
}
