import Stripe from 'stripe';

let stripeClient: Stripe | null = null;

export function getStripeClient() {
  if (stripeClient) return stripeClient;

  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    throw new Error('Missing STRIPE_SECRET_KEY.');
  }

  stripeClient = new Stripe(secretKey);
  return stripeClient;
}

export function getProMonthlyPriceId() {
  const priceId = process.env.STRIPE_PRO_MONTHLY_PRICE_ID;
  if (!priceId) {
    throw new Error('Missing STRIPE_PRO_MONTHLY_PRICE_ID.');
  }
  return priceId;
}

export function getAppBaseUrl(requestUrl?: string) {
  if (process.env.NEXT_PUBLIC_APP_URL) {
    return process.env.NEXT_PUBLIC_APP_URL;
  }

  if (requestUrl) {
    return new URL(requestUrl).origin;
  }

  throw new Error('Missing NEXT_PUBLIC_APP_URL.');
}
