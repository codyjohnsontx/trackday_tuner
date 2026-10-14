'use client';

import { useEffect, useId, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { UpgradeToProButton } from '@/components/billing/billing-buttons';
import { encodeAttachment } from '@/components/service-book/attachment-encoding';
import { formatInstant, useRiderClock } from '@/components/service-book/rider-clock';
import { Button } from '@/components/ui/button';
import { ChoiceRow } from '@/components/ui/choice-row';
import { Card, Eyebrow } from '@/components/ui/surface';
import {
  confirmServiceAttachment,
  discardServiceAttachment,
  reserveServiceAttachment,
  type ServiceAttachmentLink,
} from '@/lib/actions/service-attachments';
import { attachmentMaxBytes, getFreePlanLimitMessage } from '@/lib/plans';
import {
  ATTACHMENT_KIND_LABELS,
  ENTRY_ATTACHMENT_KINDS,
  attachmentTooLargeMessage,
  formatAttachmentSize,
  type EntryAttachmentKind,
} from '@/lib/service-book/attachments';

interface ServiceEntryAttachmentsProps {
  vehicleId: string;
  entryId: string;
  /** Confirmed attachments with signed thumbnails and links that sign on open; `null` when they could not be read. */
  links: ServiceAttachmentLink[] | null;
  /** False on a removed entry, in the demo, and when the rider switched the field off. */
  canUpload: boolean;
  /** The book is at its free-plan allowance as the page was read. */
  atLimit: boolean;
  hasProAccess: boolean;
}

const KIND_OPTIONS = ENTRY_ATTACHMENT_KINDS.map((value) => ({ value, label: ATTACHMENT_KIND_LABELS[value] }));

/**
 * An entry's receipts, invoices and photos, and the one place a rider adds
 * them. What a file is opens with nothing pressed, because "Receipt attached
 * when logged" is a claim a buyer reads and a default is not an answer. The
 * upload goes from the browser straight to storage through URLs the server
 * signed for paths the database reserved; see `lib/actions/service-attachments.ts`.
 */
export function ServiceEntryAttachments({
  vehicleId,
  entryId,
  links,
  canUpload,
  atLimit,
  hasProAccess,
}: ServiceEntryAttachmentsProps) {
  const router = useRouter();
  // The upload time is read in the rider's own zone, so it is printed only
  // once mounted, never by the server.
  const clock = useRiderClock();
  const fileId = useId();
  const fileInput = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState<EntryAttachmentKind | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState('');
  const [limitReached, setLimitReached] = useState(atLimit);
  const [viewing, setViewing] = useState<ServiceAttachmentLink | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => setLimitReached(atLimit), [atLimit]);

  function upload() {
    setError('');
    if (kind === null) {
      setError('Choose what this file is first.');
      return;
    }
    if (file === null) {
      setError('Choose a file to upload.');
      return;
    }
    startTransition(async () => {
      const encoded = await encodeAttachment(file);
      if (!encoded.ok) {
        setError(encoded.error);
        return;
      }
      const maxBytes = attachmentMaxBytes(hasProAccess);
      if (encoded.file.size > maxBytes) {
        setError(attachmentTooLargeMessage(maxBytes, hasProAccess));
        return;
      }

      const reserved = await reserveServiceAttachment(vehicleId, entryId, {
        kind,
        mime: encoded.mime,
        bytes: encoded.file.size,
      });
      if (!reserved.ok) {
        if ('atLimit' in reserved) setLimitReached(true);
        else setError(reserved.error);
        return;
      }

      // Loaded on the first upload, not with the page. A static import of the
      // browser client here left about half of all client-side navigations
      // from the book into an entry hanging with the route never committed,
      // in a production build on Chromium; the page's own reads and the card's
      // render were each ruled out by building without them.
      const { createClient } = await import('@/lib/supabase/client');
      const bucket = createClient().storage.from('service-book');
      const { file: target, thumb } = reserved.data;
      const uploads = await Promise.all([
        bucket.uploadToSignedUrl(target.path, target.token, encoded.file, { contentType: encoded.mime }),
        thumb && encoded.thumb
          ? bucket.uploadToSignedUrl(thumb.path, thumb.token, encoded.thumb, { contentType: 'image/jpeg' })
          : Promise.resolve({ error: null }),
      ]);
      if (uploads.some((result) => result.error)) {
        await discardServiceAttachment(vehicleId, reserved.data.attachmentId);
        setError('The upload did not finish. Check your connection and try again.');
        return;
      }

      const confirmed = await confirmServiceAttachment(vehicleId, reserved.data.attachmentId);
      if (!confirmed.ok) {
        setError(confirmed.error);
        return;
      }
      setKind(null);
      setFile(null);
      if (fileInput.current) fileInput.current.value = '';
      router.refresh();
    });
  }

  const attachments = links ?? [];

  return (
    <Card>
      <Eyebrow>Receipts and photos</Eyebrow>

      {links === null ? (
        <p className="mt-2 text-sm text-slower" role="alert">
          The attachments could not be read. Reload the page to try again.
        </p>
      ) : attachments.length === 0 ? (
        <p className="mt-2 text-sm text-ink-dim">Nothing attached yet.</p>
      ) : (
        <ul className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4" aria-label="Attachments">
          {attachments.map((attachment) => {
            const label = `${ATTACHMENT_KIND_LABELS[attachment.kind]}${clock ? `, added ${formatInstant(attachment.uploaded_at)}` : ''}`;
            return (
              <li key={attachment.id}>
                {attachment.mime === 'application/pdf' ? (
                  <a
                    href={attachment.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`${label} (PDF, opens in a new tab)`}
                    className="flex aspect-square w-full flex-col items-center justify-center gap-1 rounded-row bg-surface-2 text-ink-dim hover:text-ink"
                  >
                    <span className="text-sm font-semibold">PDF</span>
                    <span className="text-xs text-ink-faint">{ATTACHMENT_KIND_LABELS[attachment.kind]}</span>
                  </a>
                ) : (
                  <button
                    type="button"
                    aria-label={`View ${label}`}
                    onClick={() => setViewing(attachment)}
                    className="block aspect-square w-full overflow-hidden rounded-row bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal/80"
                  >
                    {/* A short-lived signed URL for a private object, so it is not handed
                        to next/image, whose optimizer would cache and re-serve it. */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={attachment.thumbUrl ?? attachment.url} alt="" className="h-full w-full object-cover" />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {canUpload && limitReached ? (
        <div className="mt-4 space-y-3 rounded-row bg-surface-2 p-4" role="status">
          <p className="text-sm font-semibold text-ink">Attachment limit reached</p>
          <p className="text-sm text-ink-dim">{getFreePlanLimitMessage('attachments')}</p>
          <p className="text-sm text-ink-faint">Everything already attached stays readable.</p>
          <UpgradeToProButton fullWidth />
        </div>
      ) : canUpload ? (
        <div className="mt-4 space-y-3 rounded-row bg-surface-2 p-4">
          <ChoiceRow label="What is this file?" options={KIND_OPTIONS} value={kind} clearable onChange={setKind} className="bg-surface-3" />
          <div className="space-y-2">
            <label htmlFor={fileId} className="block text-sm font-medium text-ink-dim">
              Photo or PDF
            </label>
            <input
              ref={fileInput}
              id={fileId}
              type="file"
              accept="image/*,application/pdf"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              className="block min-h-11 w-full text-sm text-ink-dim file:mr-3 file:min-h-11 file:rounded-control file:border-0 file:bg-surface-3 file:px-4 file:text-sm file:font-semibold file:text-ink"
            />
            {file ? <p className="text-xs text-ink-faint">{formatAttachmentSize(file.size)} before it is resized</p> : null}
          </div>
          {error ? (
            <p className="text-sm text-slower" role="alert">
              {error}
            </p>
          ) : null}
          <Button type="button" size="sm" onClick={upload} loading={isPending}>
            Upload
          </Button>
        </div>
      ) : null}

      {viewing ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={ATTACHMENT_KIND_LABELS[viewing.kind]}
          className="fixed inset-0 z-50 flex flex-col bg-canvas p-4"
          onKeyDown={(event) => {
            if (event.key === 'Escape') setViewing(null);
          }}
        >
          <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-3 pb-3">
            <p className="text-sm font-semibold text-ink">{ATTACHMENT_KIND_LABELS[viewing.kind]}</p>
            <div className="flex gap-2">
              <Button asChild size="sm" variant="secondary">
                <a href={viewing.url} target="_blank" rel="noopener noreferrer">
                  Full size
                </a>
              </Button>
              <Button type="button" size="sm" onClick={() => setViewing(null)} autoFocus>
                Close
              </Button>
            </div>
          </div>
          <div className="mx-auto flex min-h-0 w-full max-w-5xl flex-1 items-center justify-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={viewing.url} alt={ATTACHMENT_KIND_LABELS[viewing.kind]} className="max-h-full max-w-full rounded-row object-contain" />
          </div>
        </div>
      ) : null}
    </Card>
  );
}
