import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import type Stripe from 'stripe';
import { createAdminClient } from '@/lib/supabase/admin';
import { getTierFromSubscription, unixToIso } from '@/lib/stripe/entitlements';
import { getProMonthlyPriceId, getStripeClient } from '@/lib/stripe/server';

async function updateProfileFromSubscription(
  subscription: Stripe.Subscription,
  fallbackUserId?: string | null,
) {
  const admin = createAdminClient();
  const priceId = getProMonthlyPriceId();
  const tier = getTierFromSubscription(subscription, priceId);
  const currentPeriodEnd = unixToIso(subscription.items.data[0]?.current_period_end);

  const updatePayload = {
    tier,
    stripe_customer_id:
      typeof subscription.customer === 'string'
        ? subscription.customer
        : subscription.customer.id,
    stripe_subscription_id: subscription.id,
    stripe_price_id: subscription.items.data[0]?.price?.id ?? null,
    stripe_current_period_end: currentPeriodEnd,
    updated_at: new Date().toISOString(),
  };

  if (fallbackUserId) {
    const { error } = await admin
      .from('profiles')
      .update(updatePayload)
      .eq('id', fallbackUserId);
    if (!error) return;
  }

  const customerId = updatePayload.stripe_customer_id;
  const { error } = await admin
    .from('profiles')
    .update(updatePayload)
    .eq('stripe_customer_id', customerId);
  if (error) throw error;
}

export async function POST(request: Request) {
  const stripe = getStripeClient();
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    return NextResponse.json(
      { error: 'Missing STRIPE_WEBHOOK_SECRET.' },
      { status: 500 },
    );
  }

  const body = await request.text();
  const headerList = await headers();
  const signature = headerList.get('stripe-signature');
  if (!signature) {
    return NextResponse.json({ error: 'Missing signature.' }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
  } catch {
    return NextResponse.json({ error: 'Invalid signature.' }, { status: 400 });
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        if (session.mode === 'subscription' && session.subscription) {
          const subscriptionId =
            typeof session.subscription === 'string'
              ? session.subscription
              : session.subscription.id;
          const subscription = await stripe.subscriptions.retrieve(
            subscriptionId,
            { expand: ['items.data.price'] },
          );
          await updateProfileFromSubscription(
            subscription,
            session.metadata?.supabase_user_id ?? null,
          );
        }
        break;
      }
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription;
        await updateProfileFromSubscription(subscription);
        break;
      }
      case 'invoice.paid':
      case 'invoice.payment_failed': {
        // No-op for v1. Subscription events remain canonical for entitlement sync.
        break;
      }
      default:
        break;
    }
  } catch {
    return NextResponse.json({ error: 'Webhook processing failed.' }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
