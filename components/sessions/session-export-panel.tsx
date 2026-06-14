'use client';

import { Download } from 'lucide-react';
import { useMemo, useState } from 'react';
import { UpgradeToProButton } from '@/components/billing/billing-buttons';
import { Button } from '@/components/ui/button';
import type { Vehicle } from '@/types';

interface SessionExportPanelProps {
  vehicles: Vehicle[];
  tier: 'free' | 'pro';
  demoMode?: boolean;
}

export function SessionExportPanel({ vehicles, tier, demoMode = false }: SessionExportPanelProps) {
  const [vehicleId, setVehicleId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const isPro = tier === 'pro';

  const exportUrl = useMemo(() => {
    const params = new URLSearchParams();
    if (vehicleId) params.set('vehicleId', vehicleId);
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    const query = params.toString();
    return `/api/sessions/export${query ? `?${query}` : ''}`;
  }, [from, to, vehicleId]);

  return (
    <section className="space-y-3 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
      <div>
        <p className="text-sm font-semibold text-zinc-100">CSV Export</p>
        <p className="mt-1 text-sm text-zinc-400">
          Download sessions with setup modules, conditions, environment, and notes.
        </p>
      </div>

      {demoMode ? (
        <div className="rounded-xl border border-cyan-400/20 bg-cyan-400/10 p-3">
          <p className="text-sm font-medium text-cyan-100">
            CSV export is available in real Pro accounts. Demo data is read-only.
          </p>
        </div>
      ) : null}

      {!isPro ? (
        <div className="rounded-xl border border-cyan-400/20 bg-cyan-400/10 p-3">
          <p className="text-sm font-medium text-cyan-100">Pro unlocks filtered CSV exports.</p>
          <p className="mt-1 text-sm text-zinc-400">
            Export your full setup history for analysis, sharing, and backups.
          </p>
          <div className="mt-3">
            <UpgradeToProButton fullWidth />
          </div>
        </div>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="space-y-1">
              <span className="text-xs font-medium text-zinc-400">Vehicle</span>
              <select
                className="min-h-11 w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 text-sm text-zinc-100 focus:border-cyan-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/80"
                value={vehicleId}
                onChange={(event) => setVehicleId(event.target.value)}
              >
                <option value="">All vehicles</option>
                {vehicles.map((vehicle) => (
                  <option key={vehicle.id} value={vehicle.id}>
                    {vehicle.nickname}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1">
              <span className="text-xs font-medium text-zinc-400">From</span>
              <input
                type="date"
                className="min-h-11 w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 text-sm text-zinc-100 focus:border-cyan-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/80"
                value={from}
                onChange={(event) => setFrom(event.target.value)}
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs font-medium text-zinc-400">To</span>
              <input
                type="date"
                className="min-h-11 w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 text-sm text-zinc-100 focus:border-cyan-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/80"
                value={to}
                onChange={(event) => setTo(event.target.value)}
              />
            </label>
          </div>

          {demoMode ? (
            <Button type="button" fullWidth className="justify-center gap-2" disabled>
              <Download className="h-4 w-4" aria-hidden />
              Download CSV
            </Button>
          ) : (
            <Button asChild fullWidth className="justify-center gap-2">
              <a href={exportUrl}>
                <Download className="h-4 w-4" aria-hidden />
                Download CSV
              </a>
            </Button>
          )}
        </>
      )}
    </section>
  );
}
