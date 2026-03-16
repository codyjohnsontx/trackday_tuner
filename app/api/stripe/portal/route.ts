import { NextResponse } from 'next/server';
import { getUserProfile } from '@/lib/actions/vehicles';
import { getAuthenticatedUser } from '@/lib/auth';
import { logError, logInfo, logWarn } from '@/lib/observability';
import { getAppBaseUrl, getStripeClient } from '@/lib/stripe/server';

export async function POST(request: Request) {
  try {
    const user = await getAuthenticatedUser();
    if (!user) {
      logWarn('stripe.portal.unauthenticated');
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

    logInfo('stripe.portal.session_created', {
      userId: user.id,
      customerId: profile.stripe_customer_id,
    });

    return NextResponse.json({ url: portalSession.url });
  } catch (error) {
    logError('stripe.portal.failed', error);
    return NextResponse.json(
      { error: 'Unable to create billing portal session.' },
      { status: 500 },
    );
  }
}
