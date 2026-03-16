import { NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/auth';
import { getUserProfile } from '@/lib/actions/vehicles';
import { getAppBaseUrl, getStripeClient } from '@/lib/stripe/server';

export async function POST(request: Request) {
  try {
    const user = await getAuthenticatedUser();
    if (!user) {
      return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
    }

    const profile = await getUserProfile();
    if (!profile?.stripe_customer_id) {
      return NextResponse.json(
        { error: 'No billing profile found.' },
        { status: 400 },
      );
    }

    const stripe = getStripeClient();
    const appUrl = getAppBaseUrl(request.url);

    const portalSession = await stripe.billingPortal.sessions.create({
      customer: profile.stripe_customer_id,
      return_url: `${appUrl}/dashboard`,
    });

    return NextResponse.json({ url: portalSession.url });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Unable to create billing portal session.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
