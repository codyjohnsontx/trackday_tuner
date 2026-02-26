'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { getFounderPromoCode } from '@/lib/billing';

interface BillingButtonProps {
  fullWidth?: boolean;
  className?: string;
}

async function requestBillingUrl(path: '/api/stripe/checkout' | '/api/stripe/portal') {
  const response = await fetch(path, { method: 'POST' });
  const raw = await response.text();
  let body: { url?: string; error?: string } = {};
  if (raw) {
    try {
      body = JSON.parse(raw) as { url?: string; error?: string };
    } catch {
      body = {};
    }
  }

  if (!response.ok || !body.url) {
    throw new Error(body.error ?? `Unable to open billing flow (${response.status}).`);
  }

  return body.url;
}

export function UpgradeToProButton({ fullWidth = false, className }: BillingButtonProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const founderCode = getFounderPromoCode();

  async function handleUpgrade() {
    setLoading(true);
    setError('');
    try {
      const url = await requestBillingUrl('/api/stripe/checkout');
      window.location.assign(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to start checkout.');
      setLoading(false);
    }
  }

  return (
    <div className="space-y-2">
      <Button
        type="button"
        variant="primary"
        fullWidth={fullWidth}
        className={className}
        onClick={handleUpgrade}
        disabled={loading}
      >
        {loading ? 'Redirecting...' : 'Upgrade to Pro'}
      </Button>
      <p className="text-xs text-zinc-400">
        Founder special: use code {founderCode} for $1.99/mo (first 100).
      </p>
      {error ? <p className="text-sm text-rose-300">{error}</p> : null}
    </div>
  );
}

export function ManageBillingButton({ fullWidth = false, className }: BillingButtonProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleManage() {
    setLoading(true);
    setError('');
    try {
      const url = await requestBillingUrl('/api/stripe/portal');
      window.location.assign(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to open billing portal.');
      setLoading(false);
    }
  }

  return (
    <div className="space-y-2">
      <Button
        type="button"
        variant="secondary"
        fullWidth={fullWidth}
        className={className}
        onClick={handleManage}
        disabled={loading}
      >
        {loading ? 'Redirecting...' : 'Manage Billing'}
      </Button>
      {error ? <p className="text-sm text-rose-300">{error}</p> : null}
    </div>
  );
}
