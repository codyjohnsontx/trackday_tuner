import type { Metadata, Viewport } from 'next';
import { Barlow_Semi_Condensed } from 'next/font/google';
import './globals.css';
import { AppShell } from '@/components/layout/app-shell';
import { isDemoMode } from '@/lib/demo/mode';
import { isAuthenticated } from '@/lib/auth';

// Display face for page titles only. A semi-condensed grotesk at 600 is what
// timing screens and liveries use, so the title reads as instrumentation
// beside the system sans body instead of as an editorial import (the serif it
// replaced; owner's pick, 2026-10-18). Anything carrying a measurement stays
// on the system sans. One weight, because the title is the only thing that
// wears it.
const displayFace = Barlow_Semi_Condensed({
  weight: '600',
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-barlow-semi-condensed',
});

export const metadata: Metadata = {
  title: 'Trackday Tuner',
  description: 'Mobile-first motorsport setup logger for track sessions.',
};

// Matches --color-canvas so the iOS address bar and the Android status bar sit
// inside the panel instead of framing it in light chrome.
export const viewport: Viewport = {
  themeColor: '#08080a',
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const demoMode = await isDemoMode();
  const authenticated = demoMode || await isAuthenticated();

  return (
    <html lang="en" className={displayFace.variable}>
      <body>
        <AppShell isAuthenticated={authenticated} isDemoMode={demoMode}>{children}</AppShell>
      </body>
    </html>
  );
}
