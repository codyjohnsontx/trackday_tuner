import Stripe from 'stripe';
import { getPublicAppUrl } from '@/lib/env.public';
import { getStripeProMonthlyPriceId, getStripeSecretKey } from '@/lib/env.server';

let stripeClient: Stripe | null = null;

export function getStripeClient() {
  if (stripeClient) return stripeClient;

  stripeClient = new Stripe(getStripeSecretKey());
  return stripeClient;
}

export function getProMonthlyPriceId() {
  return getStripeProMonthlyPriceId();
}

export function getAppBaseUrl(requestUrl?: string) {
  try {
    return getPublicAppUrl();
  } catch {
    if (process.env.NODE_ENV !== 'production' && requestUrl) {
      return new URL(requestUrl).origin;
    }
  }
  throw new Error('Missing NEXT_PUBLIC_APP_URL. Stripe redirects require an explicit public app URL.');
}
