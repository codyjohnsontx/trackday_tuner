'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { setVehicleBaselineFromSession } from '@/lib/actions/baselines';
import { Button } from '@/components/ui/button';

interface SetVehicleBaselineButtonProps {
  sessionId: string;
  hasExistingBaseline: boolean;
  isCurrentBaseline: boolean;
}

export function SetVehicleBaselineButton({
  sessionId,
  hasExistingBaseline,
  isCurrentBaseline,
}: SetVehicleBaselineButtonProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  if (isCurrentBaseline) return null;

  async function handleSetBaseline() {
    if (hasExistingBaseline && !window.confirm('Replace the current vehicle baseline with this session?')) {
      return;
    }

    setLoading(true);
    setError('');
    const result = await setVehicleBaselineFromSession(sessionId);
    if (!result.ok) {
      setError(result.error);
      setLoading(false);
      return;
    }

    router.refresh();
  }

  return (
    <div className="space-y-2">
      <Button type="button" fullWidth onClick={handleSetBaseline} loading={loading}>
        Set as Vehicle Baseline
      </Button>
      {error ? <p className="text-sm text-rose-300">{error}</p> : null}
    </div>
  );
}
