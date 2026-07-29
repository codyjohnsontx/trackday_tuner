import Link from 'next/link';
import { getVehicleBaselines } from '@/lib/actions/baselines';
import { getVehicles, getUserProfile } from '@/lib/actions/vehicles';
import { UpgradeToProButton } from '@/components/billing/billing-buttons';
import { DemoBanner } from '@/components/demo/demo-banner';
import { isDemoMode } from '@/lib/demo/mode';
import { VehicleCard } from '@/components/garage/vehicle-card';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import { resolveUserAccess } from '@/lib/access';

export default async function GaragePage() {
  const [vehicles, profile, demoMode] = await Promise.all([getVehicles(), getUserProfile(), isDemoMode()]);
  const baselines = await getVehicleBaselines(vehicles.map((vehicle) => vehicle.id));
  const baselineByVehicleId = new Map(baselines.map((baseline) => [baseline.vehicle_id, baseline]));

  const isFree = !resolveUserAccess(profile).hasProAccess;
  const atLimit = isFree && vehicles.length >= 1;

  const tierLabel = isFree
    ? `Free plan · ${vehicles.length}/1 vehicle`
    : `Pro plan · ${vehicles.length} vehicle${vehicles.length !== 1 ? 's' : ''}`;

  return (
    <div className="space-y-5">
      {demoMode ? <DemoBanner /> : null}

      <PageHeader
        title="Garage"
        sub={tierLabel}
        action={
          !atLimit && !demoMode ? (
            <Button asChild variant="primary" className="min-h-11 px-4 text-sm">
              <Link href="/garage/new">+ Add Vehicle</Link>
            </Button>
          ) : null
        }
      />

      {vehicles.length === 0 ? (
        <section className="rounded-card bg-surface p-6 text-center">
          <p className="text-sm text-ink-dim">No vehicles yet.</p>
          <p className="mt-1 text-sm text-ink-faint">Add your first vehicle to start logging sessions.</p>
          <div className="mt-4">
            <Link href="/garage/new">
              <Button fullWidth>Add Your First Vehicle</Button>
            </Link>
          </div>
        </section>
      ) : (
        <ul className="space-y-3">
          {vehicles.map((v) => (
            <VehicleCard
              key={v.id}
              vehicle={v}
              baseline={baselineByVehicleId.get(v.id) ?? null}
              baselineLocked={isFree}
              demoMode={demoMode}
            />
          ))}
        </ul>
      )}

      {atLimit && !demoMode ? (
        <section className="rounded-card bg-surface p-4 text-center">
          <p className="text-sm font-semibold text-ink">Want more vehicles?</p>
          <p className="mt-1 text-sm text-ink-dim">
            Upgrade to Pro for unlimited vehicles, full session history, and AI-powered tuning suggestions.
          </p>
          <div className="mt-4">
            <UpgradeToProButton fullWidth />
          </div>
        </section>
      ) : null}
    </div>
  );
}
