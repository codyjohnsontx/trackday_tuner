import type { Metadata, Viewport } from 'next';
import './globals.css';
import { AppShell } from '@/components/layout/app-shell';
import { isAuthenticated } from '@/lib/auth';

export const metadata: Metadata = {
  title: 'Track Tuner',
  description: 'Mobile-first setup logger for racebike and racecar sessions.',
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
