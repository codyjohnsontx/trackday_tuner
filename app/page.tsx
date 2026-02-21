import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export default function HomePage() {
  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
        <h1 className="text-2xl font-semibold">Track Tuner</h1>
        <p className="mt-2 text-sm text-zinc-300">
          Capture setup changes fast at the track, compare what worked, and keep clean session history.
        </p>
      </section>

      <section className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-300">Get Early Access</h2>
        <form className="mt-3 space-y-3">
          <Input label="Email" type="email" placeholder="you@tracktuner.app" autoComplete="email" />
          <Button type="submit" fullWidth>
            Request Invite
          </Button>
        </form>
      </section>

      <section className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
        <div className="space-y-2">
          <Link
            href="/login"
            className="block min-h-12 rounded-xl bg-cyan-400 px-4 py-3 text-center text-sm font-semibold text-zinc-950 transition hover:bg-cyan-300"
          >
            Login / Sign Up
          </Link>
          <Link
            href="/dashboard"
            className="block min-h-12 rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-3 text-center text-sm font-semibold text-zinc-100 transition hover:bg-zinc-800"
          >
            View Dashboard Placeholder
          </Link>
        </div>
      </section>
    </div>
  );
}
