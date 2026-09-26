import {
  ManageBillingButton,
  UpgradeToProButton,
} from '@/components/billing/billing-buttons';
import { DemoBanner } from '@/components/demo/demo-banner';
import { QuestionHistorySettings } from '@/components/settings/question-history-settings';
import { TemperatureUnitSettings } from '@/components/settings/temperature-unit-settings';
import { TimeFormatSettings } from '@/components/settings/time-format-settings';
import { getRetainedQuestions } from '@/lib/actions/ai-question-retention';
import { getUserProfile } from '@/lib/actions/vehicles';
import { currentRetentionChoice, resolveQuestionRetention } from '@/lib/ai-question-retention';
import { isDemoMode } from '@/lib/demo/mode';
import { PageHeader } from '@/components/ui/page-header';
import { resolveUserAccess } from '@/lib/access';

export default async function SettingsPage() {
  const [profile, demoMode, retainedQuestions] = await Promise.all([
    getUserProfile(),
    isDemoMode(),
    getRetainedQuestions(),
  ]);
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
        sub="Your preferences, and what Trackday Tuner keeps."
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
          <p className="mt-1 text-sm text-ink-dim">
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
      <TemperatureUnitSettings />
      <QuestionHistorySettings
        choice={currentRetentionChoice(resolveQuestionRetention(profile))}
        history={retainedQuestions.ok ? retainedQuestions.data : null}
        demoMode={demoMode}
      />
    </div>
  );
}
