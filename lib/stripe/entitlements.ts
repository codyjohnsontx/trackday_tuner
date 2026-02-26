import type Stripe from 'stripe';
import type { Tier } from '@/types';

const PRO_STATUSES = new Set<Stripe.Subscription.Status>(['active', 'trialing']);

export function getTierFromSubscription(
  subscription: Pick<Stripe.Subscription, 'status' | 'items'>,
  proPriceId: string,
): Tier {
  const hasProPrice = subscription.items.data.some(
    (item) => item.price?.id === proPriceId,
  );

  if (!hasProPrice) return 'free';
  if (!PRO_STATUSES.has(subscription.status)) return 'free';
  return 'pro';
}

export function unixToIso(timestamp: number | null | undefined): string | null {
  if (!timestamp) return null;
  return new Date(timestamp * 1000).toISOString();
}
