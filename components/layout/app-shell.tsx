import Link from 'next/link';
import { HeaderAppMenu } from '@/components/layout/header-app-menu';

interface AppShellProps {
  children: React.ReactNode;
  isAuthenticated: boolean;
}

export function AppShell({ children, isAuthenticated }: AppShellProps) {
  return (
    <div className="mx-auto flex min-h-screen w-full max-w-5xl flex-col bg-zinc-950 text-zinc-100">
      <header className="sticky top-0 z-10 border-b border-zinc-800 bg-zinc-950/95 px-4 py-3 pt-[max(0.75rem,env(safe-area-inset-top))] backdrop-blur">
        <div className="flex items-center justify-between gap-3">
          <Link
            href={isAuthenticated ? '/dashboard' : '/'}
            className="text-lg font-bold text-cyan-400 tracking-tight focus-visible:ring-2 focus-visible:ring-cyan-400/80"
          >
            Trackday Tuner
          </Link>
          <div className="flex shrink-0 items-center gap-2">
            {isAuthenticated && <HeaderAppMenu />}
            {!isAuthenticated && (
              <Link
                href="/login"
                className="inline-flex min-h-11 items-center justify-center rounded-xl border border-zinc-700 bg-zinc-900 px-3 text-xs font-semibold uppercase leading-none tracking-wide text-zinc-100 transition hover:bg-zinc-800 focus-visible:ring-2 focus-visible:ring-cyan-400/80"
              >
                Log In
              </Link>
            )}
          </div>
        </div>
      </header>

      <main className="flex-1 px-4 py-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:px-5 md:px-6">
        {children}
      </main>
    </div>
  );
}
