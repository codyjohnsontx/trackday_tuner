'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { CardGroup, GroupRow } from '@/components/ui/surface';
import { formatInstant, useRiderClock } from '@/components/service-book/rider-clock';
import { createServiceBookShare, revokeServiceBookShare, type ServiceBookShare } from '@/lib/actions/service-book-shares';

interface ServiceBookSharingProps {
  vehicleId: string;
  /** The links that still open the book, or the error reading them. */
  shares: { ok: true; data: ServiceBookShare[] } | { ok: false; error: string };
}

/**
 * Share links to the book (owner, Q5): anyone holding one reads the book with no
 * account, read-only, until the owner revokes it. A link is shown once, as it is
 * made, because only its hash is kept. The list is the component's own state
 * after a write, so a revoke shows at once rather than waiting on a re-render.
 */
export function ServiceBookSharing({ vehicleId, shares }: ServiceBookSharingProps) {
  const clock = useRiderClock();
  const [links, setLinks] = useState<ServiceBookShare[]>(shares.ok ? shares.data : []);
  const [created, setCreated] = useState<{ id: string; url: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  const [isPending, startTransition] = useTransition();

  function create() {
    setError('');
    setCopied(false);
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
    startTransition(async () => {
      const result = await createServiceBookShare(vehicleId, timeZone);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setLinks((current) => [result.data.share, ...current]);
      setCreated({ id: result.data.share.id, url: `${window.location.origin}/book/${result.data.token}` });
    });
  }

  function revoke(shareId: string) {
    setError('');
    startTransition(async () => {
      const result = await revokeServiceBookShare(vehicleId, shareId);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setLinks((current) => current.filter((link) => link.id !== shareId));
      if (created?.id === shareId) setCreated(null);
    });
  }

  async function copy(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <CardGroup
      eyebrow="Sharing"
      title={links.length === 0 ? 'Not shared' : `${links.length} ${links.length === 1 ? 'link' : 'links'}`}
      action={
        <Button type="button" variant="secondary" size="sm" onClick={create} disabled={isPending}>
          Create share link
        </Button>
      }
    >
      <GroupRow>
        <p className="text-sm text-ink-dim">
          Anyone with a link can read this book without an account: every entry with when it was logged, but nothing of your sessions and no
          removed entry beyond the count. Revoke a link to close it.
        </p>
      </GroupRow>

      {!shares.ok ? (
        <GroupRow>
          <p className="text-sm text-slower" role="alert">
            {shares.error}
          </p>
        </GroupRow>
      ) : null}

      {created ? (
        <GroupRow className="space-y-3">
          <p className="text-sm font-semibold text-ink">Your new link</p>
          <p className="text-xs text-ink-faint">Copy it now: it is not shown again.</p>
          <input
            readOnly
            value={created.url}
            aria-label="Share link"
            data-testid="share-link-url"
            onFocus={(event) => event.currentTarget.select()}
            className="min-h-11 w-full rounded-control bg-surface-3 px-3 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal/80"
          />
          <Button type="button" size="sm" onClick={() => copy(created.url)}>
            {copied ? 'Copied' : 'Copy link'}
          </Button>
        </GroupRow>
      ) : null}

      {links.map((link) => (
        <GroupRow key={link.id}>
          <div className="flex items-center justify-between gap-3" data-testid="share-link-row">
          <div className="min-w-0">
            <p className="text-sm font-medium text-ink">Made {clock ? formatInstant(link.created_at) : ''}</p>
            <p className="mt-0.5 text-xs text-ink-faint">
              {link.view_count === 0
                ? 'Not opened yet'
                : `Opened ${link.view_count} ${link.view_count === 1 ? 'time' : 'times'}${clock && link.last_viewed_at ? `, last ${formatInstant(link.last_viewed_at)}` : ''}`}
            </p>
          </div>
          <Button type="button" variant="destructive" size="sm" onClick={() => revoke(link.id)} disabled={isPending} aria-label="Revoke this link">
            Revoke
          </Button>
          </div>
        </GroupRow>
      ))}

      {error ? (
        <GroupRow>
          <p className="text-sm text-slower" role="alert">
            {error}
          </p>
        </GroupRow>
      ) : null}
    </CardGroup>
  );
}
