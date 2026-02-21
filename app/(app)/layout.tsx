import { redirect } from 'next/navigation';
import { getAuthenticatedUser } from '@/lib/auth';

export default async function AuthenticatedAppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getAuthenticatedUser();

  if (!user) {
    redirect('/login');
  }

  return (
    <div className="space-y-4">
      <header className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
        <h1 className="text-lg font-semibold">Authenticated App</h1>
        <p className="mt-1 text-sm text-zinc-300">Signed in as {user.email}</p>
      </header>
      {children}
    </div>
  );
}
