import { NextResponse } from 'next/server';
import { getRealUser } from '@/lib/auth';
import { getUserProfile } from '@/lib/actions/vehicles';
import { assertNotDemoRoute } from '@/lib/demo/mode';
import { createAdminClient } from '@/lib/supabase/admin';
import { getAppBaseUrl, getProMonthlyPriceId, getStripeClient } from '@/lib/stripe/server';

export async function POST(request: Request) {
  try {
    const demoResponse = await assertNotDemoRoute();
    if (demoResponse) return demoResponse;

    const user = await getRealUser();
    if (!user) {
      return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
    }

    const profile = await getUserProfile();
    // The customer link is the one write that ever needed to reach a Stripe
    // column on profiles, and it runs here rather than through the caller's
    // session. `authenticated` holds no UPDATE on that table precisely because
    // RLS gates rows and not columns, so a user-context update of their own row
    // could also set tier and beta access. This route has already established
    // the user above, and scopes the write to that id.
    const admin = createAdminClient();
    const stripe = getStripeClient();
    const appUrl = getAppBaseUrl(request.url);
    const priceId = getProMonthlyPriceId();

    let customerId = profile?.stripe_customer_id ?? null;

    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email ?? undefined,
        metadata: {
          supabase_user_id: user.id,
        },
      });
      customerId = customer.id;

      const { data: linkedProfile, error: profileError } = await admin
        .from('profiles')
        .update({ stripe_customer_id: customer.id })
        .eq('id', user.id)
        .select('id')
        .maybeSingle();

      // Without this link the webhook cannot match the completed payment back to
      // a profile, so it would return 200 and grant nothing. A missing row still
      // updates nothing and reports no error, so the returned row is the only
      // proof the link landed. Fail before charging.
      if (profileError || !linkedProfile) {
        // Nothing references this customer yet, and leaving it behind would let
        // repeated attempts pile up unlinked customers on the Stripe account.
        try {
          await stripe.customers.del(customer.id);
        } catch {
          // Cleanup is best effort; the checkout failure below is what matters.
        }

        return NextResponse.json(
          { error: 'Unable to link your billing account. Please try again.' },
          { status: 500 },
        );
      }
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      allow_promotion_codes: true,
      success_url: `${appUrl}/dashboard?billing=success`,
      cancel_url: `${appUrl}/dashboard?billing=cancel`,
      metadata: {
        supabase_user_id: user.id,
      },
    });

    return NextResponse.json({ url: session.url });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Unable to create checkout session.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
