import { getFounderPromoCodeEnv } from '@/lib/env';

export const PRO_MONTHLY_PRICE_USD = 2.99;
export const FOUNDER_PROMO_PRICE_USD = 1.99;
export const FOUNDER_PROMO_MAX_REDEMPTIONS = 100;

export function getFounderPromoCode(): string {
  return getFounderPromoCodeEnv() ?? 'FOUNDER100';
}
