import { redirect } from 'next/navigation';
import { getViewer } from '@/lib/auth';

export default async function AuthenticatedAppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Demo browses the authenticated app, so this is one of the two places that
  // deliberately admits a demo viewer.
  const viewer = await getViewer();

  if (viewer.status === 'anonymous') {
    redirect('/login');
  }

  return <>{children}</>;
}
