export const APP_NAV_ITEMS = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/sessions', label: 'Sessions' },
  { href: '/garage', label: 'Garage' },
  { href: '/tracks', label: 'Tracks' },
  { href: '/tools', label: 'Tools' },
] as const;

export function isActivePath(pathname: string, href: string): boolean {
  if (pathname === href) return true;
  return pathname.startsWith(`${href}/`);
}
