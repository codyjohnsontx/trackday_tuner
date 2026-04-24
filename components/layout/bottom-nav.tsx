'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { APP_NAV_ITEMS, isActivePath } from '@/components/layout/app-nav-config';
import { cn } from '@/lib/utils';

export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-zinc-800 bg-zinc-950/95 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 backdrop-blur">
      <ul className="mx-auto grid w-full max-w-md grid-cols-5 gap-1 px-2">
        {APP_NAV_ITEMS.map((item) => {
          const active = isActivePath(pathname, item.href);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                className={cn(
                  'flex min-h-11 items-center justify-center rounded-lg px-2 text-[11px] font-semibold uppercase tracking-wide transition focus-visible:ring-2 focus-visible:ring-cyan-400/80',
                  active
                    ? 'bg-cyan-400 text-zinc-950'
                    : 'text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200',
                )}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
