import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Card, CardGroup, Eyebrow, GroupRow } from '@/components/ui/surface';
import { PageHeader } from '@/components/ui/page-header';
import { loadSharedBook, openShare } from '@/lib/service-book-share';
import { ATTACHMENT_KIND_LABELS } from '@/lib/service-book/attachments';
import { buildSharedBookView, describeRemovedEntries, type SharedEntry } from '@/lib/service-book/shared-view';

// Every request is a view: it is counted and rate limited, and the thumbnails
// it prints are signed for ten minutes, so nothing here may be cached.
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Shared service book · Trackday Tuner',
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
  referrer: 'no-referrer',
};

interface SharedBookPageProps {
  params: Promise<{ token: string }>;
}

function Notice({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-5">
      <PageHeader title="Service book" />
      <Card>
        <p className="text-base font-semibold text-ink">{title}</p>
        <p className="mt-1 text-sm text-ink-dim">{children}</p>
      </Card>
    </div>
  );
}

/**
 * A bike's service book as anyone holding its share link reads it (owner, Q5):
 * no account, read-only, labelled honestly in the owner's zone (Q4), and a
 * removed entry is only counted (PQ6). Rendered entirely on the server from
 * `buildSharedBookView`, so nothing reaches the browser but what it prints. A
 * revoked or unknown link is a 404, the same answer for both, so a page cannot
 * tell a visitor that a link once existed.
 */
export default async function SharedBookPage({ params }: SharedBookPageProps) {
  const { token } = await params;
  const opening = await openShare(token, { countView: true });
  if (opening.kind === 'not_found') notFound();
  if (opening.kind === 'rate_limited') {
    return <Notice title="This link has been opened too often">Try again in an hour.</Notice>;
  }
  if (opening.kind === 'failed') {
    return <Notice title="This service book could not be loaded">Try again in a moment.</Notice>;
  }

  const rows = await loadSharedBook(opening.bookId);
  if (!rows) return <Notice title="This service book could not be loaded">Try again in a moment.</Notice>;
  const view = buildSharedBookView(rows.input);
  const removed = describeRemovedEntries(view.removedCount);

  return (
    <div className="space-y-5">
      <PageHeader title={view.title} sub={view.subtitle ?? 'Service book'} />

      <Card>
        <Eyebrow>Shared service book</Eyebrow>
        <p className="mt-2 text-sm text-ink-dim">
          A read-only copy shared by the bike&apos;s owner. Each entry says when it was logged as well as when the work was done, and whether it
          was edited since.
        </p>
        {view.readings.length > 0 ? (
          <dl className="mt-4 flex flex-wrap gap-x-6 gap-y-2">
            {view.readings.map((reading) => (
              <div key={reading.value}>
                <dt className="text-xs text-ink-faint">Last reading, {reading.on}</dt>
                <dd className="text-lg font-semibold tabular-nums text-ink">{reading.value}</dd>
              </div>
            ))}
          </dl>
        ) : null}
      </Card>

      <CardGroup eyebrow="Schedule" title={`${view.items.length} ${view.items.length === 1 ? 'item' : 'items'}`}>
        {view.items.length === 0 ? (
          <GroupRow>
            <p className="text-sm text-ink-dim">No items in this book.</p>
          </GroupRow>
        ) : (
          view.items.map((item) => (
            <GroupRow key={item.id}>
              <p className="font-medium text-ink">{item.name}</p>
              <p className="mt-0.5 text-xs text-ink-faint">
                {item.interval ?? 'No interval set'}
                {' · '}
                {item.lastDone ? `Last done ${item.lastDone}` : 'Never logged'}
              </p>
            </GroupRow>
          ))
        )}
      </CardGroup>

      <CardGroup eyebrow="Entries" title={`${view.entries.length} ${view.entries.length === 1 ? 'entry' : 'entries'}`}>
        {view.entries.length === 0 ? (
          <GroupRow>
            <p className="text-sm text-ink-dim">Nothing logged yet.</p>
          </GroupRow>
        ) : (
          view.entries.map((entry) => <SharedEntryRow key={entry.id} entry={entry} token={token} thumbs={rows.thumbUrlByAttachmentId} />)
        )}
        {removed ? (
          <GroupRow>
            <p className="text-sm text-ink-dim" data-testid="shared-removed-entries">
              {removed}
            </p>
          </GroupRow>
        ) : null}
        {!view.labelled && view.entries.length > 0 ? (
          <GroupRow>
            <p className="text-xs text-ink-faint">
              When each entry was logged is shown once the owner next opens their book.
            </p>
          </GroupRow>
        ) : null}
      </CardGroup>
    </div>
  );
}

function SharedEntryRow({ entry, token, thumbs }: { entry: SharedEntry; token: string; thumbs: Map<string, string> }) {
  return (
    <article className="rounded-row bg-surface-2 p-4" data-testid="shared-entry">
      <p className="font-medium text-ink">{entry.title}</p>
      <p className="mt-0.5 text-sm text-ink-dim">{entry.serviceDate}</p>
      {entry.labels.length > 0 ? (
        <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="History">
          {entry.labels.map((label) => (
            <li key={label} className="rounded-full bg-surface-3 px-2 py-0.5 text-xs text-ink-dim">
              {label}
            </li>
          ))}
        </ul>
      ) : null}
      {entry.details.length > 0 ? (
        <dl className="mt-3 space-y-1">
          {entry.details.map((detail) => (
            <div key={detail.label} className="flex items-start justify-between gap-3">
              <dt className="text-sm text-ink-dim">{detail.label}</dt>
              <dd className="text-right text-sm font-medium text-ink">{detail.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {entry.parts.length > 0 ? (
        <div className="mt-3">
          <p className="text-sm text-ink-dim">Parts</p>
          <ul className="mt-1 space-y-0.5">
            {entry.parts.map((part, index) => (
              <li key={index} className="text-sm text-ink">
                {part}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {entry.notes ? <p className="mt-3 whitespace-pre-wrap text-sm text-ink">{entry.notes}</p> : null}
      {entry.attachments.length > 0 ? (
        <ul className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-5" aria-label="Attachments">
          {entry.attachments.map((attachment) => {
            const label = ATTACHMENT_KIND_LABELS[attachment.kind];
            const href = `/book/${token}/attachments/${attachment.id}`;
            const thumb = thumbs.get(attachment.id);
            return (
              <li key={attachment.id}>
                <a
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`${label}${attachment.mime === 'application/pdf' ? ' (PDF)' : ''}, opens in a new tab`}
                  className="flex aspect-square w-full flex-col items-center justify-center gap-1 overflow-hidden rounded-plate bg-surface-3 text-ink-dim hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal/80"
                >
                  {thumb ? (
                    // A short-lived signed URL for a private object, so it is not
                    // handed to next/image, whose optimizer would cache and re-serve it.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={thumb} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <>
                      <span className="text-sm font-semibold">{attachment.mime === 'application/pdf' ? 'PDF' : 'File'}</span>
                      <span className="text-xs text-ink-faint">{label}</span>
                    </>
                  )}
                </a>
              </li>
            );
          })}
        </ul>
      ) : null}
    </article>
  );
}
