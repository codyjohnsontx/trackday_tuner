import {
  ManageBillingButton,
  UpgradeToProButton,
} from '@/components/billing/billing-buttons';
import { TimeFormatSettings } from '@/components/settings/time-format-settings';
import { getUserProfile } from '@/lib/actions/vehicles';

export default async function SettingsPage() {
  const profile = await getUserProfile();
  const isPro = profile?.tier === 'pro';
  const billingRenewal = profile?.stripe_current_period_end
    ? new Date(profile.stripe_current_period_end).toLocaleDateString()
    : null;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-zinc-100">Settings</h1>
        <p className="mt-1 text-sm text-zinc-400">Preferences for how Trackday Tuner displays data on your device.</p>
      </div>

      <section className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-400">
          Billing
        </h2>
        <p className="mt-2 text-sm text-zinc-300">
          Plan: <span className="font-medium uppercase">{isPro ? 'Pro' : 'Free'}</span>
        </p>
        {isPro ? (
          <p className="mt-1 text-sm text-zinc-400">
            {billingRenewal ? `Renews on ${billingRenewal}.` : 'Active subscription.'}
          </p>
        ) : (
          <p className="mt-1 text-sm text-zinc-400">
            Upgrade to unlock unlimited vehicles, tracks, and sessions.
          </p>
        )}
        <div className="mt-4">
          {isPro ? <ManageBillingButton fullWidth /> : <UpgradeToProButton fullWidth />}
        </div>
      </section>

      <TimeFormatSettings />
    </div>
  );
}
