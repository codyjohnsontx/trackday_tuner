import { redirect } from 'next/navigation';
import { QuestionRetentionNotice } from '@/components/ai/question-retention-notice';
import { getUserProfile } from '@/lib/actions/vehicles';
import { resolveQuestionRetention } from '@/lib/ai-question-retention';
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

  // The one-time question-retention notice, on every screen until answered.
  // Demo is not an account and keeps nothing, so it never sees it. A rider with
  // no profile row has nothing kept and nowhere to record an answer, so the
  // notice would only fail; the keep rule already treats them as not keeping.
  const profile = viewer.status === 'authenticated' ? await getUserProfile() : null;
  const retention = profile ? resolveQuestionRetention(profile) : null;
  const noticeOwed = retention !== null && !retention.noticeSeen;

  return (
    <>
      {noticeOwed ? (
        <div className="mb-5">
          <QuestionRetentionNotice />
        </div>
      ) : null}
      {children}
    </>
  );
}
