'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { APP_NAV_ITEMS, isActivePath } from '@/components/layout/app-nav-config';
import { cn } from '@/lib/utils';

/**
 * A floating pill rather than a docked bar. It reads as a control belonging to
 * the rider instead of a chrome edge of the page, and letting content scroll
 * underneath keeps the panel feeling continuous.
 *
 * The bar clears the home indicator via the safe-area inset; the matching
 * bottom padding on `main` is what stops the last card sliding under it.
 *
 * Both radii here stay `rounded-full` while the rest of the app moved onto the
 * radius ladder in `app/globals.css`. The shell is a pill on purpose, and the
 * items sit inside it under only 6px of padding: squaring the first and last
 * would cut a crescent of surface between a square corner and the pill's arc.
 * The nav is one shape, so it is round all the way through.
 */
export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Primary"
      className="pointer-events-none fixed inset-x-0 bottom-0 z-20 flex justify-center px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
    >
      <ul className="pointer-events-auto flex w-full max-w-md items-center gap-1 rounded-full bg-surface/95 p-1.5 shadow-[0_8px_32px_rgba(0,0,0,0.55)] backdrop-blur">
        {APP_NAV_ITEMS.map((item) => {
          const active = isActivePath(pathname, item.href);
          const Icon = item.icon;
          return (
            <li key={item.href} className="flex-1">
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex min-h-11 flex-col items-center justify-center gap-1 rounded-full px-1 py-1.5 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal/80',
                  active ? 'bg-surface-2' : 'hover:bg-surface-2/60',
                )}
              >
                <Icon
                  className={cn(
                    'h-[1.125rem] w-[1.125rem]',
                    active ? 'text-signal' : 'text-ink-faint',
                  )}
                  aria-hidden
                />
                <span
                  className={cn(
                    'text-[0.625rem] font-semibold leading-none tracking-wide',
                    active ? 'text-ink' : 'text-ink-faint',
                  )}
                >
                  {item.label}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
