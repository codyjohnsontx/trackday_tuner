'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { Menu } from 'lucide-react';
import { APP_NAV_ITEMS, isActivePath } from '@/components/layout/app-nav-config';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

// Drawer navigation rows. Pressable, but each one IS a row in this list
// rather than a free-standing control, so it takes the row rung and agrees
// with the list it belongs to. Not a tone argument: `rounded-control`
// elements sit on `bg-surface-2` elsewhere (the tracks list View/Edit pair,
// the Race Engineer symptom toggles). What picks the rung is what the
// element is in the layout.
const linkRowClass =
  'flex min-h-11 items-center rounded-row px-4 text-sm font-semibold uppercase tracking-wide transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal/80';

const activeRowClass = 'bg-surface-2 text-ink';
const idleRowClass = 'text-ink-faint hover:bg-surface-2 hover:text-ink';

export function HeaderAppMenu({ isDemoMode = false }: { isDemoMode?: boolean }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const settingsActive = isActivePath(pathname, '/settings');

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-control bg-surface-3 text-ink transition hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal/80"
          aria-label="Open menu"
          aria-expanded={open}
          aria-controls="app-menu-panel"
        >
          <Menu className="h-5 w-5" aria-hidden />
        </button>
      </DialogTrigger>
      <DialogContent
        id="app-menu-panel"
        className={cn(
          'fixed inset-y-0 right-0 left-auto top-0 z-50 flex h-full w-full max-w-sm translate-x-0 translate-y-0 flex-col bg-surface p-0 shadow-[-16px_0_48px_rgba(0,0,0,0.6)]',
          'transition-transform duration-200 ease-out data-[state=closed]:translate-x-full data-[state=open]:translate-x-0',
        )}
      >
          <DialogTitle className="sr-only">App menu</DialogTitle>
          <DialogDescription className="sr-only">
            Navigate the app, open settings, or {isDemoMode ? 'exit demo mode' : 'sign out'}.
          </DialogDescription>

          <div className="flex items-center justify-between px-4 py-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
            <span className="text-[0.6875rem] font-semibold uppercase tracking-[0.14em] text-ink-faint">
              Menu
            </span>
            <DialogClose asChild>
              <button
                type="button"
                className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-control text-ink-faint transition hover:bg-surface-2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal/80"
                aria-label="Close menu"
              >
                <span className="text-lg leading-none" aria-hidden>
                  ×
                </span>
              </button>
            </DialogClose>
          </div>

          <nav className="flex flex-1 flex-col gap-1 overflow-y-auto p-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
            <p className="px-4 pb-1 text-[0.6875rem] font-semibold uppercase tracking-[0.14em] text-ink-faint">
              Navigate
            </p>
            <ul className="space-y-1">
              {APP_NAV_ITEMS.map((item) => {
                const active = isActivePath(pathname, item.href);
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className={cn(
                        linkRowClass,
                        active ? activeRowClass : idleRowClass,
                      )}
                      onClick={() => setOpen(false)}
                    >
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>

            <div className="my-3 border-t border-white/5" />

            <ul className="space-y-1">
              <li>
                <Link
                  href="/settings"
                  className={cn(
                    linkRowClass,
                    settingsActive ? activeRowClass : idleRowClass,
                  )}
                  onClick={() => setOpen(false)}
                >
                  Settings
                </Link>
              </li>
              <li>
                <Link
                  href={isDemoMode ? '/demo/exit' : '/logout'}
                  prefetch={false}
                  className={cn(linkRowClass, 'text-ink-dim hover:bg-surface-2 hover:text-ink')}
                  onClick={() => setOpen(false)}
                >
                  {isDemoMode ? 'Exit Demo' : 'Log Out'}
                </Link>
              </li>
            </ul>
          </nav>
      </DialogContent>
    </Dialog>
  );
}
