import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';

export const metadata: Metadata = {
  title: 'Track Tuner',
  description: 'Mobile-first racebike and racecar setup logger.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="mx-auto flex min-h-screen w-full max-w-xl flex-col">
          <header className="sticky top-0 z-10 border-b border-zinc-800 bg-zinc-950/95 px-4 py-3 backdrop-blur">
            <div className="flex items-center justify-between">
              <Link href="/" className="text-lg font-semibold text-cyan-400">
                Track Tuner
              </Link>
              <Link
                href="/login"
                className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100"
              >
                Login
              </Link>
            </div>
          </header>
          <main className="flex-1 py-4">{children}</main>
        </div>
      </body>
    </html>
  );
}
