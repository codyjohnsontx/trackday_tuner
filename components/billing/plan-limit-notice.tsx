import Link from 'next/link';
import { UpgradeToProButton } from '@/components/billing/billing-buttons';
import { Button } from '@/components/ui/button';
import { pageTitleClass } from '@/components/ui/page-header';
import {
  getFreePlanLimitMessage,
  getFreePlanLimitTitle,
  type LimitedResource,
} from '@/lib/plans';

interface PlanLimitNoticeProps {
  resource: LimitedResource;
  backHref: '/garage' | '/sessions' | '/tracks';
  backLabel: string;
  /** What the rider can do about it without paying. */
  hint: string;
}

/**
 * Stands in for a create form the free plan will refuse to save.
 *
 * The server actions have always enforced these limits, but the forms behind
 * them rendered anyway: a rider at 10/10 sessions could fill the whole New
 * Session screen - 21 fields, over 3,000px - and only learn the save was
 * impossible from the error it returned. Refusing at the door is the same rule
 * the read-only demo already follows, and it is why this is a page-level notice
 * rather than a banner above the form.
 */
export function PlanLimitNotice({ resource, backHref, backLabel, hint }: PlanLimitNoticeProps) {
  return (
    <div className="space-y-5">
      <section className="rounded-card bg-surface p-5">
        <h1 className={pageTitleClass}>{getFreePlanLimitTitle(resource)}</h1>
        <p className="mt-2 text-sm text-ink-dim">{getFreePlanLimitMessage(resource)}</p>
        <p className="mt-1 text-sm text-ink-faint">{hint}</p>
        <div className="mt-4">
          <UpgradeToProButton fullWidth />
        </div>
        <Button asChild variant="secondary" className="mt-3 w-full justify-center">
          <Link href={backHref}>{backLabel}</Link>
        </Button>
      </section>
    </div>
  );
}
