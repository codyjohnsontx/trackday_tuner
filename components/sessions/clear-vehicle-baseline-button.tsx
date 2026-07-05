'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { clearVehicleBaseline } from '@/lib/actions/baselines';
import { Button } from '@/components/ui/button';

interface ClearVehicleBaselineButtonProps {
  vehicleId: string;
  disabled?: boolean;
}

export function ClearVehicleBaselineButton({ vehicleId, disabled = false }: ClearVehicleBaselineButtonProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleClearBaseline() {
    if (disabled || !window.confirm('Clear this vehicle baseline?')) {
      return;
    }

    setLoading(true);
    setError('');
    try {
      const result = await clearVehicleBaseline(vehicleId);
      if (!result.ok) {
        setError(result.error);
        setLoading(false);
        return;
      }

      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to clear baseline.');
      setLoading(false);
    }
  }

  return (
    <div className="space-y-2">
      <Button
        type="button"
        variant="destructive"
        fullWidth
        onClick={handleClearBaseline}
        loading={loading}
        disabled={disabled}
      >
        Clear Baseline
      </Button>
      {error ? <p className="text-sm text-rose-300">{error}</p> : null}
    </div>
  );
}
