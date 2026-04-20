import Link from 'next/link';
import { BottomNav } from './bottom-nav';

interface AppShellProps {
  children: React.ReactNode;
  isAuthenticated: boolean;
}

export function AppShell({ children, isAuthenticated }: AppShellProps) {
  return (
    <div className="mx-auto flex min-h-screen w-full max-w-5xl flex-col bg-zinc-950 text-zinc-100">
      <header className="sticky top-0 z-10 border-b border-zinc-800 bg-zinc-950/95 px-4 py-3 pt-[max(0.75rem,env(safe-area-inset-top))] backdrop-blur">
        <div className="flex items-center justify-between">
          <Link
            href={isAuthenticated ? '/dashboard' : '/'}
            className="text-lg font-bold text-cyan-400 tracking-tight focus-visible:ring-2 focus-visible:ring-cyan-400/80"
          >
            Trackday Tuner
          </Link>
          <Link
            href={isAuthenticated ? '/logout' : '/login'}
            className="inline-flex min-h-11 items-center justify-center rounded-xl border border-zinc-700 bg-zinc-900 px-3 text-xs font-semibold uppercase leading-none tracking-wide text-zinc-100 transition hover:bg-zinc-800 focus-visible:ring-2 focus-visible:ring-cyan-400/80"
          >
            {isAuthenticated ? 'Log Out' : 'Log In'}
          </Link>
        </div>
      </header>

      <main className="flex-1 px-4 py-5 pb-24 sm:px-5 md:px-6">{children}</main>

      {isAuthenticated && <BottomNav />}
    </div>
  );
}
