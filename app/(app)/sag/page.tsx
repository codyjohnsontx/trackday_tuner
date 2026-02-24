import { SagCalculator } from '@/components/sag/sag-calculator';
import { getSagEntries } from '@/lib/actions/sag';

export default async function SagPage() {
  const entries = await getSagEntries();

  return <SagCalculator initialEntries={entries} />;
}
