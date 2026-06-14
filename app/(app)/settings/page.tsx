import {
  ManageBillingButton,
  UpgradeToProButton,
} from '@/components/billing/billing-buttons';
import { DemoBanner } from '@/components/demo/demo-banner';
import { TimeFormatSettings } from '@/components/settings/time-format-settings';
import { getUserProfile } from '@/lib/actions/vehicles';
import { isDemoMode } from '@/lib/demo/mode';

export default async function SettingsPage() {
  const [profile, demoMode] = await Promise.all([getUserProfile(), isDemoMode()]);
  const isPro = profile?.tier === 'pro';
  const billingRenewal = profile?.stripe_current_period_end
    ? new Date(profile.stripe_current_period_end).toLocaleDateString()
    : null;

  return (
    <div className="space-y-5">
      {demoMode ? <DemoBanner /> : null}

      <div>
        <h1 className="text-2xl font-bold text-zinc-100">Settings</h1>
        <p className="mt-1 text-sm text-zinc-400">Preferences for how Trackday Tuner displays data on your device.</p>
      </div>

      {demoMode ? (
        <section className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-400">
            Demo account
          </h2>
          <p className="mt-2 text-sm text-zinc-300">
            This preview shows Pro features with sample data. Billing is disabled in demo mode.
          </p>
        </section>
      ) : (
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
      )}

      <TimeFormatSettings />
    </div>
  );
}
