import Link from 'next/link';

const field =
  'w-full rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-3 text-base text-zinc-100 placeholder:text-zinc-500';

export default function LoginPage() {
  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-4 px-4">
      <section className="rounded-2xl border border-zinc-800 bg-zinc-950/80 p-4">
        <h1 className="text-xl font-semibold text-zinc-100">Login</h1>
        <p className="mt-1 text-sm text-zinc-400">Auth wiring to Supabase is next. This is the mobile-first shell.</p>

        <form className="mt-4 space-y-3">
          <label htmlFor="email" className="block space-y-2">
            <span className="text-sm font-medium text-zinc-200">Email</span>
            <input id="email" className={field} type="email" autoComplete="email" />
          </label>

          <label htmlFor="password" className="block space-y-2">
            <span className="text-sm font-medium text-zinc-200">Password</span>
            <input id="password" className={field} type="password" autoComplete="current-password" />
          </label>

          <button type="submit" className="w-full rounded-xl bg-cyan-500 px-4 py-3 font-semibold text-zinc-950">
            Sign In
          </button>
        </form>

        <p className="mt-3 text-sm text-zinc-400">
          Need an account?{' '}
          <Link href="/signup" className="text-cyan-400">
            Create one
          </Link>
          .
        </p>
      </section>
    </div>
  );
}
