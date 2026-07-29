import {
  ManageBillingButton,
  UpgradeToProButton,
} from '@/components/billing/billing-buttons';
import { DemoBanner } from '@/components/demo/demo-banner';
import { TimeFormatSettings } from '@/components/settings/time-format-settings';
import { getUserProfile } from '@/lib/actions/vehicles';
import { isDemoMode } from '@/lib/demo/mode';
import { PageHeader } from '@/components/ui/page-header';
import { resolveUserAccess } from '@/lib/access';

export default async function SettingsPage() {
  const [profile, demoMode] = await Promise.all([getUserProfile(), isDemoMode()]);
  const access = resolveUserAccess(profile);
  const isPro = access.hasProAccess;
  const billingRenewal = profile?.stripe_current_period_end
    ? new Date(profile.stripe_current_period_end).toLocaleDateString()
    : null;

  return (
    <div className="space-y-5">
      {demoMode ? <DemoBanner /> : null}

      <PageHeader
        title="Settings"
        sub="Preferences for how Trackday Tuner displays data on your device."
      />

      {demoMode ? (
        <section className="rounded-card bg-surface p-4">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-ink-dim">
            Demo account
          </h2>
          <p className="mt-2 text-sm text-ink-dim">
            This preview shows Pro features with sample data. Billing is disabled in demo mode.
          </p>
        </section>
      ) : (
        <section className="rounded-card bg-surface p-4">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-ink-dim">
          Billing
        </h2>
        <p className="mt-2 text-sm text-ink-dim">
          Plan:{' '}
          <span className="font-medium uppercase">
            {access.source === 'beta' ? 'Founding Beta' : isPro ? 'Pro' : 'Free'}
          </span>
        </p>
        {access.source === 'beta' && access.betaAccessExpiresAt ? (
          <p className="mt-1 text-sm text-signal">
            Full access through {new Date(access.betaAccessExpiresAt).toLocaleDateString()}.
          </p>
        ) : isPro ? (
          <p className="mt-1 text-sm text-ink-dim">
            {billingRenewal ? `Renews on ${billingRenewal}.` : 'Active subscription.'}
          </p>
        ) : (
          <p className="mt-1 text-sm text-ink-dim">
            Upgrade to unlock unlimited vehicles, tracks, and sessions.
          </p>
        )}
        {access.source !== 'beta' ? (
          <div className="mt-4">
            {isPro ? <ManageBillingButton fullWidth /> : <UpgradeToProButton fullWidth />}
          </div>
        ) : null}
      </section>
      )}

      <TimeFormatSettings />
    </div>
  );
}
