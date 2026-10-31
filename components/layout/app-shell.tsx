import Link from 'next/link';
import { CircleDot } from 'lucide-react';
import { BottomNav } from '@/components/layout/bottom-nav';
import { HeaderAppMenu } from '@/components/layout/header-app-menu';
import { cn } from '@/lib/utils';

interface AppShellProps {
  children: React.ReactNode;
  isAuthenticated: boolean;
  isDemoMode?: boolean;
}

export function AppShell({ children, isAuthenticated, isDemoMode = false }: AppShellProps) {
  // Signed-out screens have nowhere to navigate, so the floating bar would just
  // be an empty control. It also decides how much room `main` has to leave.
  const showBottomNav = isAuthenticated || isDemoMode;

  // The 1024px cap sits on the header's content and on `main`, not on this
  // root, so a screen can break out of it with `mx-[calc(50%-50vw)]` while
  // its copy stays on the capped column - the landing hero does, so its photo
  // reaches the viewport edge instead of stopping at the cap and leaving a
  // flat canvas band beside it on anything wider than 1024px. The header is
  // full width for the same reason: it blurs what scrolls under it, and a
  // capped header over a full-bleed hero would blur the middle and leave the
  // sides passing clear. `overflow-x-clip` (not `hidden`, which would make the
  // root the scroll container and break the sticky header) absorbs the one
  // residue of `100vw`: on a classic-scrollbar OS it is the layout width plus
  // the scrollbar, and without the clip that surplus is a horizontal scroll.
  return (
    <div className="flex min-h-screen w-full flex-col overflow-x-clip bg-canvas text-ink">
      {/* No bottom border: the header separates itself by blurring what passes
          under it, which keeps the canvas reading as a single surface. */}
      <header className="sticky top-0 z-10 bg-canvas/80 py-3 pt-[max(0.75rem,env(safe-area-inset-top))] backdrop-blur">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-3 px-4">
          <Link
            href={isAuthenticated || isDemoMode ? '/dashboard' : '/'}
            className="flex items-center gap-2 text-sm font-semibold tracking-tight text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal/80"
          >
            <CircleDot className="h-4 w-4 text-signal" aria-hidden />
            Trackday Tuner
          </Link>
          <div className="flex shrink-0 items-center gap-2">
            {isDemoMode ? (
              // A status chip, not a control. Round is what keeps it reading as
              // a label rather than something the rider can press.
              <span className="rounded-full bg-signal/12 px-2.5 py-1 text-[0.6875rem] font-semibold uppercase tracking-[0.14em] text-signal">
                Demo
              </span>
            ) : null}
            {isAuthenticated && <HeaderAppMenu isDemoMode={isDemoMode} />}
            {!isAuthenticated && (
              <Link
                href="/login"
                className="inline-flex min-h-11 items-center justify-center rounded-control bg-surface-3 px-4 text-xs font-semibold uppercase leading-none tracking-wide text-ink transition hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal/80"
              >
                Log In
              </Link>
            )}
          </div>
        </div>
      </header>

      <main
        className={cn(
          'mx-auto w-full max-w-5xl flex-1 px-4 py-5 sm:px-5 md:px-6',
          showBottomNav
            ? 'pb-[calc(6.5rem+env(safe-area-inset-bottom))]'
            : 'pb-[max(1.25rem,env(safe-area-inset-bottom))]',
        )}
      >
        {children}
      </main>

      {showBottomNav ? <BottomNav /> : null}
    </div>
  );
}
