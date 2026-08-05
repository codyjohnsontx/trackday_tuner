import Link from 'next/link';
import { SetPasswordForm } from '@/components/auth/set-password-form';
import { PageHeader } from '@/components/ui/page-header';
import { getViewer } from '@/lib/auth';

/**
 * Where a recovery link lands, after `/auth/callback` has traded its code for a
 * session. It sits outside `(app)` because the rider arriving here is finishing
 * a sign-in rather than browsing the app.
 */
export default async function ResetPasswordPage() {
  const viewer = await getViewer();

  if (viewer.status === 'authenticated') {
    return (
      <div className="space-y-5">
        <PageHeader
          title="New password"
          sub={`Choose a new password for ${viewer.user.email ?? 'your account'}.`}
        />
        <SetPasswordForm />
      </div>
    );
  }

  // Demo mode outranks a real session everywhere else in the app, so a rider who
  // wandered into the demo would otherwise be told their working link expired.
  if (viewer.status === 'demo') {
    return (
      <div className="space-y-5">
        <PageHeader title="New password" sub="You are browsing the demo right now." />
        <section className="space-y-3 rounded-card bg-surface p-4">
          <p className="text-sm text-ink-dim">
            Leave the demo to finish setting your password. Your reset link stays valid.
          </p>
          <Link
            href="/demo/exit"
            className="inline-flex min-h-12 w-full items-center justify-center rounded-full bg-ink px-4 text-sm font-semibold text-canvas transition hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal/80"
          >
            Exit Demo
          </Link>
        </section>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader title="Link expired" sub="This password reset link is no longer usable." />
      <section className="space-y-3 rounded-card bg-surface p-4">
        <p className="text-sm text-ink-dim">
          Reset links expire after an hour, work only once, and only open in the browser that asked
          for them. Request a fresh one and it will work.
        </p>
        <Link
          href="/login"
          className="inline-flex min-h-12 w-full items-center justify-center rounded-full bg-ink px-4 text-sm font-semibold text-canvas transition hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal/80"
        >
          Back to Sign In
        </Link>
      </section>
    </div>
  );
}
