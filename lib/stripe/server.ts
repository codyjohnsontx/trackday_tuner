import Stripe from 'stripe';
import {
  getPublicAppUrl,
  getStripeProMonthlyPriceId,
  getStripeSecretKey,
} from '@/lib/env';

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
    if (requestUrl) {
      return new URL(requestUrl).origin;
    }
  }
  throw new Error('Missing NEXT_PUBLIC_APP_URL.');
}
