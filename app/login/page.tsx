import Image from 'next/image';
import { redirect } from 'next/navigation';
import { AuthForm } from '@/components/auth/auth-form';
import { getAuthenticatedUser } from '@/lib/auth';
import { getOAuthProviders } from '@/lib/auth/providers';
import { isBetaInviteOnly } from '@/lib/env.server';

export default async function LoginPage() {
  const user = await getAuthenticatedUser();

  if (user) {
    redirect('/dashboard');
  }

  // Resolve providers server-side so NEXT_PUBLIC_* vars are read consistently
  // (dynamic process.env[key] access doesn't inline on the client bundle)
  const providers = getOAuthProviders();
  const inviteOnly = isBetaInviteOnly();

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
          className="object-cover object-[65%_45%]"
        />
        <div className="absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-zinc-950/80 to-transparent" />
        <div className="absolute inset-x-0 bottom-0 h-3/5 bg-gradient-to-t from-zinc-950 via-zinc-950/45 to-transparent" />
        <div className="absolute inset-x-0 bottom-0 px-4 pb-3 sm:px-5 md:px-6">
          <p className="text-xs font-semibold uppercase tracking-[0.25em] text-cyan-400">
            {inviteOnly ? 'Founding Beta' : 'Setup Logger'}
          </p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight text-zinc-100">Get on track</h1>
          <p className="mt-1 text-sm text-zinc-300">
            {inviteOnly
              ? 'Founding Beta access for invited riders.'
              : 'Log setups, compare sessions, dial in your ride.'}
          </p>
        </div>
      </div>

      <div className="px-4 pt-4 pb-2 sm:px-5 md:px-6">
        <AuthForm providers={providers} inviteOnly={inviteOnly} />
      </div>
    </div>
  );
}
