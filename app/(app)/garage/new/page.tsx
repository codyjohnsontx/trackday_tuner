import Link from 'next/link';
import { PlanLimitNotice } from '@/components/billing/plan-limit-notice';
import { DemoReadOnlyNotice } from '@/components/demo/read-only-notice';
import { VehicleForm } from '@/components/garage/vehicle-form';
import { isDemoMode } from '@/lib/demo/mode';
import { getUserProfile, getVehicles } from '@/lib/actions/vehicles';
import { resolveUserAccess } from '@/lib/access';
import { isAtFreePlanLimit } from '@/lib/plans';
import { pageTitleClass } from '@/components/ui/page-header';
import { cn } from '@/lib/utils';

export default async function NewVehiclePage() {
  const [demoMode, vehicles, profile] = await Promise.all([
    isDemoMode(),
    getVehicles(),
    getUserProfile(),
  ]);

  if (demoMode) {
    return <DemoReadOnlyNotice backHref="/garage" backLabel="Back to Garage" />;
  }

  // Same gate as the New Session route: createVehicle refuses past the free
  // limit, so the form behind it is a form that cannot save.
  if (isAtFreePlanLimit('vehicles', vehicles.length, resolveUserAccess(profile).hasProAccess)) {
    return (
      <PlanLimitNotice
        resource="vehicles"
        backHref="/garage"
        backLabel="Back to Garage"
        hint="You can still edit the vehicle already in your garage."
      />
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <Link
          href="/garage"
          className="text-sm text-ink-dim hover:text-ink"
        >
          ← Garage
        </Link>
        <h1 className={cn('mt-3', pageTitleClass)}>Add Vehicle</h1>
        <p className="mt-1 text-sm text-ink-dim">
          Give your vehicle a nickname and fill in optional details.
        </p>
      </div>

      <VehicleForm />
    </div>
  );
}
