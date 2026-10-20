import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { HandoverAccept } from '@/components/service-book/handover-accept';
import { UpgradeToProButton } from '@/components/billing/billing-buttons';
import { Card, CardGroup, Eyebrow, GroupRow } from '@/components/ui/surface';
import { PageHeader } from '@/components/ui/page-header';
import { resolveUserAccess } from '@/lib/access';
import { getUserProfile, getVehicles } from '@/lib/actions/vehicles';
import { getViewer } from '@/lib/auth';
import { isBetaInviteOnly } from '@/lib/env.server';
import { getFreePlanLimitMessage, isAtFreePlanLimit, vehiclesTowardPlan } from '@/lib/plans';
import { describeHandover } from '@/lib/service-book-transfer';
import {
  describeHandoverSummary,
  HANDOVER_COPY,
  handoverPath,
  isHandoverTokenShape,
  resolveHandoverPage,
  STAYS_WITH_SELLER,
  type HandoverPage,
} from '@/lib/service-book/handover-view';
import { formatDay } from '@/lib/service-book/calendar';
import { riderDateOfTimestamp } from '@/lib/local-date';

// Every open is counted against the link's rate limit and answers for the
// viewer signed in right now, so nothing here may be cached. Accept copies a
// whole history through this segment's server action: a full free book is 50
// storage copies plus photos, run ten at a time.
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export const metadata: Metadata = {
  title: 'Bike handover · Trackday Tuner',
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
  referrer: 'no-referrer',
};

interface TransferPageProps {
  params: Promise<{ token: string }>;
}

function Notice({ title, children, testId }: { title: string; children?: React.ReactNode; testId?: string }) {
  return (
    <div className="space-y-5">
      <PageHeader title="Bike handover" />
      <Card>
        <p className="text-base font-semibold text-ink" data-testid={testId}>
          {title}
        </p>
        {children ? <div className="mt-1 text-sm text-ink-dim">{children}</div> : null}
      </Card>
    </div>
  );
}

/**
 * The link a seller sends their buyer (owner, PQ2). It lives outside `(app)` so
 * a signed-out buyer is not bounced to the dashboard but offered to sign in and
 * come back; it shows nothing about the bike until the account holding the
 * seller's address is signed in, and one answer for every link that is not
 * pending any more. Accept runs the copy; the buyer then lands on the new
 * bike's book, where the previous owner's entries read as theirs and the
 * banner says what came with it.
 */
export default async function TransferPage({ params }: TransferPageProps) {
  const { token } = await params;
  if (!isHandoverTokenShape(token)) notFound();

  const viewer = await getViewer();
  const signedIn = viewer.status === 'authenticated' ? { id: viewer.user.id, email: viewer.user.email ?? null } : null;
  const opening = await describeHandover(token, signedIn);
  if (opening.kind === 'rate_limited') {
    return <Notice title="This link has been opened too often">Try again in an hour.</Notice>;
  }
  if (opening.kind === 'failed') {
    return <Notice title="This handover could not be loaded">Try again in a moment.</Notice>;
  }

  const description = opening.description;
  let atVehicleLimit = false;
  if (description.status === 'pending' && description.viewer === 'recipient') {
    const [vehicles, profile] = await Promise.all([getVehicles(), getUserProfile()]);
    atVehicleLimit = isAtFreePlanLimit('vehicles', vehiclesTowardPlan(vehicles), resolveUserAccess(profile).hasProAccess);
  }
  const page = resolveHandoverPage(description, atVehicleLimit);
  const nextPath = handoverPath(token);
  const loginPath = `/login?next=${encodeURIComponent(nextPath)}`;

  switch (page.kind) {
    case 'sign_in':
      return (
        <div className="space-y-5">
          <PageHeader title="Bike handover" sub="A bike's history has been handed to you" />
          <Card>
            <p className="text-sm text-ink" data-testid="handover-sign-in">
              Someone is handing you a bike on Trackday Tuner, with its service book and track sessions. Sign in with the email address
              they sent this link to, or create an account with it, and you will come back here to accept.
              {isBetaInviteOnly() ? ' This link stands in for an invitation code for that address.' : null}
            </p>
            <div className="mt-4 flex flex-col gap-2 sm:flex-row">
              {viewer.status === 'demo' ? (
                // Leaving the demo is a GET that drops a cookie, so a plain anchor
                // rather than a prefetching Link (see "Leaving Demo Mode").
                <a
                  href={`/demo/exit?next=${encodeURIComponent(loginPath)}`}
                  className="flex min-h-12 flex-1 items-center justify-center rounded-control bg-ink px-4 text-sm font-semibold text-canvas"
                >
                  Leave the demo and sign in
                </a>
              ) : (
                <Link
                  href={loginPath}
                  className="flex min-h-12 flex-1 items-center justify-center rounded-control bg-ink px-4 text-sm font-semibold text-canvas"
                  data-testid="handover-sign-in-link"
                >
                  Sign in or create an account
                </Link>
              )}
            </div>
          </Card>
        </div>
      );
    case 'invalid':
      return <Notice title={HANDOVER_COPY.invalid} testId="handover-invalid" />;
    case 'wrong_account':
      return (
        <Notice title={HANDOVER_COPY.wrongAccount} testId="handover-wrong-account">
          <Link href={`/logout?next=${encodeURIComponent(nextPath)}`} prefetch={false} className="text-ink underline-offset-2 hover:underline">
            Sign out
          </Link>{' '}
          and sign back in with that address.
        </Notice>
      );
    case 'own_link':
      return <Notice title={HANDOVER_COPY.ownLink} testId="handover-own-link" />;
    case 'accepted':
      return (
        <Notice title="This bike is in your garage" testId="handover-accepted">
          <Link href={`/garage/${page.vehicleId}/book`} className="text-ink underline-offset-2 hover:underline">
            Open its service book
          </Link>
          .
        </Notice>
      );
    case 'offer':
      return <Offer token={token} page={page} />;
  }
}

function Offer({ token, page }: { token: string; page: Extract<HandoverPage, { kind: 'offer' }> }) {
  const bike = page.bike;
  const subtitle = bike ? [bike.year, bike.make, bike.model].filter((part) => part !== null && String(part).trim() !== '').join(' ') : '';
  const expiresOn = formatDay(riderDateOfTimestamp(page.expiresAt));

  return (
    <div className="space-y-5">
      <PageHeader title="Bike handover" sub="A bike and its history are being handed to you" />

      <Card>
        <Eyebrow>The bike</Eyebrow>
        <div className="mt-3 flex items-center gap-3">
          {bike?.photo_url ? (
            <Image src={bike.photo_url} alt={bike.nickname} width={56} height={56} className="h-14 w-14 shrink-0 rounded-plate object-cover" />
          ) : null}
          <div className="min-w-0">
            <p className="truncate text-lg font-semibold text-ink" data-testid="handover-bike-nickname">
              {bike?.nickname ?? 'A bike'}
            </p>
            {subtitle ? <p className="mt-0.5 truncate text-sm text-ink-dim">{subtitle}</p> : null}
          </div>
        </div>
        <p className="mt-3 text-xs text-ink-faint">This link is good until {expiresOn}.</p>
      </Card>

      <CardGroup eyebrow="What comes with it" title="Everything up to the moment you accept">
        {describeHandoverSummary(page.summary).map((line) => (
          <GroupRow key={line}>
            <p className="text-sm text-ink" data-testid="handover-summary-line">
              {line}
            </p>
          </GroupRow>
        ))}
        <GroupRow>
          <p className="text-sm text-ink-dim">
            You get your own copy of all of it, as it stands when you accept. The previous owner keeps theirs, and nothing either of you adds
            afterwards reaches the other. Their entries stay in your book as they logged them: you can remove one, but not edit it. Receipts
            come over as they were uploaded. Anything they logged counts toward none of your free-plan limits; only what you add does.
          </p>
        </GroupRow>
        <GroupRow>
          <p className="text-sm text-ink-dim">
            What stays with the seller: {STAYS_WITH_SELLER.join(', ')}.
          </p>
        </GroupRow>
      </CardGroup>

      {page.atVehicleLimit ? (
        <Card>
          <p className="text-sm font-semibold text-ink" data-testid="handover-vehicle-limit">
            Your garage is full on the free plan
          </p>
          <p className="mt-1 text-sm text-ink-dim">
            {getFreePlanLimitMessage('vehicles')} This bike would be a second one, so the handover waits until there is room for it. The
            link stays good until {expiresOn}.
          </p>
          <div className="mt-4">
            <UpgradeToProButton fullWidth />
          </div>
        </Card>
      ) : (
        <HandoverAccept token={token} />
      )}
    </div>
  );
}
