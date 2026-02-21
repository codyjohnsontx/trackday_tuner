import Link from 'next/link';

interface AppShellProps {
  children: React.ReactNode;
  isAuthenticated: boolean;
}

export function AppShell({ children, isAuthenticated }: AppShellProps) {
  return (
    <div className="mx-auto flex min-h-screen w-full max-w-md flex-col bg-zinc-950 text-zinc-100">
      <header className="sticky top-0 z-10 border-b border-zinc-800 bg-zinc-950/95 px-4 py-3 backdrop-blur">
        <div className="flex items-center justify-between">
          <Link href="/" className="text-lg font-semibold text-cyan-400">
            Track Tuner
          </Link>
          <Link
            href={isAuthenticated ? '/logout' : '/login'}
            className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-zinc-100"
          >
            {isAuthenticated ? 'Logout' : 'Login'}
          </Link>
        </div>
      </header>

      <main className="flex-1 px-4 py-5">{children}</main>

      {isAuthenticated ? (
        <nav className="sticky bottom-0 border-t border-zinc-800 bg-zinc-950/95 px-3 py-2 backdrop-blur">
          <ul className="grid grid-cols-3 gap-2 text-center text-xs text-zinc-300">
            <li>
              <Link href="/dashboard" className="block rounded-lg bg-zinc-900 py-2">
                Dashboard
              </Link>
            </li>
            <li>
              <span className="block rounded-lg bg-zinc-900 py-2">Sessions</span>
            </li>
            <li>
              <span className="block rounded-lg bg-zinc-900 py-2">Garage</span>
            </li>
          </ul>
        </nav>
      ) : null}
    </div>
  );
}
