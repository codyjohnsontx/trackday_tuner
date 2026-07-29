import { Bike, Gauge, Route, Timer, Wrench } from 'lucide-react';

export const APP_NAV_ITEMS = [
  { href: '/dashboard', label: 'Dashboard', icon: Gauge },
  { href: '/sessions', label: 'Sessions', icon: Timer },
  { href: '/garage', label: 'Garage', icon: Bike },
  { href: '/tracks', label: 'Tracks', icon: Route },
  { href: '/tools', label: 'Tools', icon: Wrench },
] as const;

export function isActivePath(pathname: string, href: string): boolean {
  if (pathname === href) return true;
  return pathname.startsWith(`${href}/`);
}
