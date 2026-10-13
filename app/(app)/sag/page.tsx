import { DemoBanner } from '@/components/demo/demo-banner';
import { SagCalculator } from '@/components/sag/sag-calculator';
import { getSagEntries } from '@/lib/actions/sag';
import { isDemoMode } from '@/lib/demo/mode';

export default async function SagPage() {
  const [entries, demoMode] = await Promise.all([getSagEntries(), isDemoMode()]);

  return (
    <div className="space-y-5">
      {demoMode ? <DemoBanner /> : null}
      <SagCalculator initialEntries={entries} demoMode={demoMode} />
    </div>
  );
}
