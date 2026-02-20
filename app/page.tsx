import Link from 'next/link';

const card = 'rounded-2xl border border-zinc-800 bg-zinc-950/80 p-4';

export default function HomePage() {
  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-4 px-4">
      <section className={card}>
        <h1 className="text-xl font-semibold text-zinc-100">Trackside logging, built for speed</h1>
        <p className="mt-2 text-sm text-zinc-400">
          Log racebike and racecar sessions in under a minute with modular setup cards.
        </p>
      </section>

      <section className={`${card} space-y-3`}>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-300">Start</h2>
        <Link href="/sessions/new" className="block rounded-xl bg-cyan-500 px-4 py-3 text-center font-semibold text-zinc-950">
          New Session
        </Link>
        <div className="grid grid-cols-2 gap-3">
          <Link href="/signup" className="rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-3 text-center text-sm text-zinc-100">
            Create account
          </Link>
          <Link href="/login" className="rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-3 text-center text-sm text-zinc-100">
            Sign in
          </Link>
        </div>
      </section>
    </div>
  );
}
