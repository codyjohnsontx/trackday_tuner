import Link from 'next/link';
import { CircleDot } from 'lucide-react';
import { BottomNav } from '@/components/layout/bottom-nav';
import { HeaderAppMenu } from '@/components/layout/header-app-menu';

interface AppShellProps {
  children: React.ReactNode;
  isAuthenticated: boolean;
  isDemoMode?: boolean;
}

export function AppShell({ children, isAuthenticated, isDemoMode = false }: AppShellProps) {
  // Signed-out screens have nowhere to navigate, so the floating bar would just
  // be an empty control. It also decides how much room `main` has to leave.
  const showBottomNav = isAuthenticated || isDemoMode;

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-5xl flex-col bg-canvas text-ink">
      {/* No bottom border: the header separates itself by blurring what passes
          under it, which keeps the canvas reading as a single surface. */}
      <header className="sticky top-0 z-10 bg-canvas/80 px-4 py-3 pt-[max(0.75rem,env(safe-area-inset-top))] backdrop-blur">
        <div className="flex items-center justify-between gap-3">
          <Link
            href={isAuthenticated || isDemoMode ? '/dashboard' : '/'}
            className="flex items-center gap-2 text-sm font-semibold tracking-tight text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal/80"
          >
            <CircleDot className="h-4 w-4 text-signal" aria-hidden />
            Trackday Tuner
          </Link>
          <div className="flex shrink-0 items-center gap-2">
            {isDemoMode ? (
              <span className="rounded-full bg-signal/12 px-2.5 py-1 text-[0.6875rem] font-semibold uppercase tracking-[0.14em] text-signal">
                Demo
              </span>
            ) : null}
            {isAuthenticated && <HeaderAppMenu isDemoMode={isDemoMode} />}
            {!isAuthenticated && (
              <Link
                href="/login"
                className="inline-flex min-h-11 items-center justify-center rounded-full bg-surface-3 px-4 text-xs font-semibold uppercase leading-none tracking-wide text-ink transition hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal/80"
              >
                Log In
              </Link>
            )}
          </div>
        </div>
      </header>

      <main
        className={
          showBottomNav
            ? 'flex-1 px-4 py-5 pb-[calc(6.5rem+env(safe-area-inset-bottom))] sm:px-5 md:px-6'
            : 'flex-1 px-4 py-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:px-5 md:px-6'
        }
      >
        {children}
      </main>

      {showBottomNav ? <BottomNav /> : null}
    </div>
  );
}
