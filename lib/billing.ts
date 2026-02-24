export function getFounderPromoCode(): string {
  return process.env.NEXT_PUBLIC_STRIPE_FOUNDER_PROMO_CODE || 'FOUNDER100';
}
