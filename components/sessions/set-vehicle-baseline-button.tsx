'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { setVehicleBaselineFromSession } from '@/lib/actions/baselines';
import { Button } from '@/components/ui/button';

interface SetVehicleBaselineButtonProps {
  sessionId: string;
  hasExistingBaseline: boolean;
  isCurrentBaseline: boolean;
  disabled?: boolean;
}

export function SetVehicleBaselineButton({
  sessionId,
  hasExistingBaseline,
  isCurrentBaseline,
  disabled = false,
}: SetVehicleBaselineButtonProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  if (isCurrentBaseline) return null;

  async function handleSetBaseline() {
    if (disabled) {
      return;
    }

    if (hasExistingBaseline && !window.confirm('Replace the current vehicle baseline with this session?')) {
      return;
    }

    setLoading(true);
    setError('');
    try {
      const result = await setVehicleBaselineFromSession(sessionId);
      if (!result.ok) {
        setError(result.error);
        setLoading(false);
        return;
      }

      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to set baseline.');
      setLoading(false);
    }
  }

  return (
    <div className="space-y-2">
      <Button type="button" fullWidth onClick={handleSetBaseline} loading={loading} disabled={disabled}>
        Set as Vehicle Baseline
      </Button>
      {error ? <p className="text-sm text-rose-300">{error}</p> : null}
    </div>
  );
}
