import Image from 'next/image';
import { redirect } from 'next/navigation';
import { AuthForm } from '@/components/auth/auth-form';
import { getViewer } from '@/lib/auth';
import { authErrorMessage } from '@/lib/auth/messages';
import { getOAuthProviders } from '@/lib/auth/providers';
import { isBetaInviteOnly } from '@/lib/env.server';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // A demo viewer is already "in" the app, so send them on rather than offering
  // a login form they cannot use.
  const viewer = await getViewer();

  if (viewer.status !== 'anonymous') {
    redirect('/dashboard');
  }

  // Resolve providers server-side so NEXT_PUBLIC_* vars are read consistently
  // (dynamic process.env[key] access doesn't inline on the client bundle)
  const providers = getOAuthProviders();
  const inviteOnly = isBetaInviteOnly();

  // `/auth/callback` can only report a failure through the URL. Without this the
  // rider is bounced back to a login form with no idea their link had expired.
  const { error } = await searchParams;
  const initialError = authErrorMessage(typeof error === 'string' ? error : null) ?? '';

  return (
    <div className="-mx-4 -mt-5 sm:-mx-5 md:-mx-6">
      <div className="relative h-[42svh] max-h-[26rem] min-h-72 overflow-hidden">
        {/* Photo: Harlie Raethel via Unsplash */}
        <Image
          src="/images/login-hero.jpg"
          alt="Motorcycle racer leaned into a corner on a race track"
          fill
          priority
          sizes="(min-width: 1024px) 1024px, 100vw"
          className="object-cover object-[65%_45%] opacity-60"
        />
        <div className="absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-canvas to-transparent" />
        <div className="absolute inset-x-0 bottom-0 h-3/5 bg-gradient-to-t from-canvas via-canvas to-transparent" />
        <div className="absolute inset-x-0 bottom-0 px-4 pb-3 sm:px-5 md:px-6">
          <p className="text-xs font-semibold uppercase tracking-[0.25em] text-ink-faint">
            {inviteOnly ? 'Founding Beta' : 'Setup Logger'}
          </p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight text-ink">Get on track</h1>
          <p className="mt-1 text-sm text-ink-dim">
            {inviteOnly
              ? 'Founding Beta access for invited riders.'
              : 'Log setups, compare sessions, dial in your ride.'}
          </p>
        </div>
      </div>

      <div className="px-4 pt-4 pb-2 sm:px-5 md:px-6">
        <AuthForm providers={providers} inviteOnly={inviteOnly} initialError={initialError} />
        <a
          href="/demo"
          className="mt-3 inline-flex min-h-12 w-full items-center justify-center rounded-control bg-surface px-4 text-sm font-semibold text-ink transition hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-signal/80"
        >
          Explore the demo
        </a>
      </div>
    </div>
  );
}
