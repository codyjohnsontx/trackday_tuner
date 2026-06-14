import type { Metadata } from 'next';
import './globals.css';
import { AppShell } from '@/components/layout/app-shell';
import { isDemoMode } from '@/lib/demo/mode';
import { isAuthenticated } from '@/lib/auth';

export const metadata: Metadata = {
  title: 'Trackday Tuner',
  description: 'Mobile-first motorsport setup logger for track sessions.',
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const demoMode = await isDemoMode();
  const authenticated = demoMode || await isAuthenticated();

  return (
    <html lang="en">
      <body>
        <AppShell isAuthenticated={authenticated} isDemoMode={demoMode}>{children}</AppShell>
      </body>
    </html>
  );
}
