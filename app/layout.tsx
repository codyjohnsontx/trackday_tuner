import type { Metadata, Viewport } from 'next';
import './globals.css';
import { AppShell } from '@/components/layout/app-shell';
import { isAuthenticated } from '@/lib/auth';

export const metadata: Metadata = {
  title: 'Trackday Tuner',
  description: 'Log your track session setups, compare what worked, and dial in your ride.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const authed = await isAuthenticated();

  return (
    <html lang="en">
      <body>
        <AppShell isAuthenticated={authed}>{children}</AppShell>
      </body>
    </html>
  );
}
