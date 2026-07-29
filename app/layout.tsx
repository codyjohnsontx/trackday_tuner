import type { Metadata, Viewport } from 'next';
import { Instrument_Serif } from 'next/font/google';
import './globals.css';
import { AppShell } from '@/components/layout/app-shell';
import { isDemoMode } from '@/lib/demo/mode';
import { isAuthenticated } from '@/lib/auth';

// Display face for page titles only. A high-contrast serif against the sans
// body is what separates a screen you read from a screen you scan — anything
// carrying a measurement stays on the system sans.
const instrumentSerif = Instrument_Serif({
  weight: '400',
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-instrument-serif',
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
    <html lang="en" className={instrumentSerif.variable}>
      <body>
        <AppShell isAuthenticated={authenticated} isDemoMode={demoMode}>{children}</AppShell>
      </body>
    </html>
  );
}
