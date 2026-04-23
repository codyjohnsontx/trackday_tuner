'use client';

import * as Dialog from '@radix-ui/react-dialog';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { Menu, X } from 'lucide-react';
import { APP_NAV_ITEMS, isActivePath } from '@/components/layout/app-nav-config';
import { cn } from '@/lib/utils';

const linkRowClass =
  'flex min-h-11 items-center rounded-lg px-3 text-sm font-semibold uppercase tracking-wide transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/80';

export function HeaderAppMenu() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const settingsActive = isActivePath(pathname, '/settings');

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button
          type="button"
          className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl border border-zinc-700 bg-zinc-900 text-zinc-100 transition hover:bg-zinc-800 focus-visible:ring-2 focus-visible:ring-cyan-400/80"
          aria-label="Open menu"
          aria-expanded={open}
          aria-controls="app-menu-panel"
        >
          <Menu className="h-5 w-5" aria-hidden />
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60 transition-opacity data-[state=closed]:opacity-0 data-[state=open]:opacity-100" />
        <Dialog.Content
          id="app-menu-panel"
          className={cn(
            'fixed inset-y-0 right-0 z-50 flex h-full w-full max-w-sm flex-col border-l border-zinc-800 bg-zinc-950 shadow-xl outline-none',
            'transition-transform duration-200 ease-out data-[state=closed]:translate-x-full data-[state=open]:translate-x-0',
          )}
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <Dialog.Title className="sr-only">App menu</Dialog.Title>
          <Dialog.Description className="sr-only">
            Navigate the app, open settings, or sign out.
          </Dialog.Description>

          <div className="flex items-center justify-between border-b border-zinc-800 px-3 py-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
            <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Menu</span>
            <Dialog.Close asChild>
              <button
                type="button"
                className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg text-zinc-400 transition hover:bg-zinc-900 hover:text-zinc-100 focus-visible:ring-2 focus-visible:ring-cyan-400/80"
                aria-label="Close menu"
              >
                <X className="h-5 w-5" aria-hidden />
              </button>
            </Dialog.Close>
          </div>

          <nav className="flex flex-1 flex-col gap-1 overflow-y-auto p-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
            <p className="px-3 pb-1 text-xs font-semibold uppercase tracking-wider text-zinc-500">Navigate</p>
            <ul className="space-y-1">
              {APP_NAV_ITEMS.map((item) => {
                const active = isActivePath(pathname, item.href);
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className={cn(
                        linkRowClass,
                        active ? 'bg-cyan-400 text-zinc-950' : 'text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200',
                      )}
                      onClick={() => setOpen(false)}
                    >
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>

            <div className="my-3 border-t border-zinc-800" />

            <ul className="space-y-1">
              <li>
                <Link
                  href="/settings"
                  className={cn(
                    linkRowClass,
                    settingsActive ? 'bg-cyan-400 text-zinc-950' : 'text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200',
                  )}
                  onClick={() => setOpen(false)}
                >
                  Settings
                </Link>
              </li>
              <li>
                <Link
                  href="/logout"
                  className={cn(linkRowClass, 'text-zinc-300 hover:bg-zinc-900 hover:text-zinc-100')}
                  onClick={() => setOpen(false)}
                >
                  Log Out
                </Link>
              </li>
            </ul>
          </nav>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
