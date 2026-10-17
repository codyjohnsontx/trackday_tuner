import { describe, expect, it } from 'vitest';
import {
  ATTACHMENT_IMAGE_LONG_EDGE,
  ATTACHMENT_RESERVATION_TTL_MS,
  ATTACHMENT_THUMB_LONG_EDGE,
  attachmentTooLargeMessage,
  classifyAttachmentFile,
  countTowardAllowance,
  fitWithin,
  formatAttachmentSize,
  isAttachmentMime,
  isEntryAttachmentKind,
} from '@/lib/service-book/attachments';
import { FREE_PLAN_ATTACHMENT_MAX_BYTES, getFreePlanLimitMessage } from '@/lib/plans';

describe('fitWithin', () => {
  it('scales a phone photo to the long edge, keeping its shape', () => {
    expect(fitWithin(4032, 3024, ATTACHMENT_IMAGE_LONG_EDGE)).toEqual({ width: 2048, height: 1536 });
    expect(fitWithin(3024, 4032, ATTACHMENT_THUMB_LONG_EDGE)).toEqual({ width: 300, height: 400 });
  });

  it('never upscales an image that already fits', () => {
    expect(fitWithin(800, 600, ATTACHMENT_IMAGE_LONG_EDGE)).toEqual({ width: 800, height: 600 });
  });

  it('keeps a sliver of a receipt at least one pixel wide', () => {
    expect(fitWithin(10, 40000, ATTACHMENT_THUMB_LONG_EDGE)).toEqual({ width: 1, height: 400 });
  });

  it('refuses an image with no size', () => {
    expect(() => fitWithin(0, 100, 400)).toThrow();
    expect(() => fitWithin(Number.NaN, 100, 400)).toThrow();
  });
});

describe('classifyAttachmentFile', () => {
  it('re-encodes any image and passes a PDF through', () => {
    expect(classifyAttachmentFile({ type: 'image/heic', name: 'IMG_0001.HEIC' })).toEqual({ kind: 'image' });
    expect(classifyAttachmentFile({ type: 'image/png', name: 'scan.png' })).toEqual({ kind: 'image' });
    expect(classifyAttachmentFile({ type: 'application/pdf', name: 'invoice.pdf' })).toEqual({ kind: 'pdf' });
    // Some pickers report no type for a PDF; its name is all there is.
    expect(classifyAttachmentFile({ type: '', name: 'Invoice.PDF' })).toEqual({ kind: 'pdf' });
  });

  it('refuses anything else before it is uploaded', () => {
    expect(classifyAttachmentFile({ type: 'text/html', name: 'page.html' }).kind).toBe('refused');
    expect(classifyAttachmentFile({ type: '', name: 'receipt' }).kind).toBe('refused');
  });
});

describe('the closed lists', () => {
  it('takes receipts, invoices and photos on an entry, and nothing the photo-reading slice owns', () => {
    expect(['receipt', 'invoice', 'photo'].every(isEntryAttachmentKind)).toBe(true);
    expect(isEntryAttachmentKind('manual_page')).toBe(false);
    expect(isEntryAttachmentKind(null)).toBe(false);
  });

  it('stores a JPEG or a PDF, which is what the bucket accepts', () => {
    expect(isAttachmentMime('image/jpeg')).toBe(true);
    expect(isAttachmentMime('application/pdf')).toBe(true);
    expect(isAttachmentMime('image/png')).toBe(false);
  });
});

describe('countTowardAllowance', () => {
  const now = new Date('2026-10-14T12:00:00Z');
  const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();

  it('counts every confirmed attachment and every reservation younger than a day', () => {
    expect(
      countTowardAllowance(
        [
          { status: 'ready', created_at: ago(400 * ATTACHMENT_RESERVATION_TTL_MS), copied_from_attachment_id: null },
          { status: 'pending', created_at: ago(60_000), copied_from_attachment_id: null },
          { status: 'pending', created_at: ago(ATTACHMENT_RESERVATION_TTL_MS + 1), copied_from_attachment_id: null },
        ],
        now,
      ),
    ).toBe(2);
  });

  it('counts no receipt that came with a bike from its previous owner', () => {
    expect(
      countTowardAllowance(
        [
          { status: 'ready', created_at: ago(60_000), copied_from_attachment_id: 'a5d3c0c2-6f5e-4a51-9a3e-2b7b1d0c9e11' },
          { status: 'ready', created_at: ago(60_000), copied_from_attachment_id: null },
        ],
        now,
      ),
    ).toBe(1);
  });

  it('counts nothing in an empty book', () => {
    expect(countTowardAllowance([], now)).toBe(0);
  });
});

describe('the words a rider reads', () => {
  it('names the per-bike allowance', () => {
    expect(getFreePlanLimitMessage('attachments')).toBe(
      'Free plan is limited to 25 attachments per bike. Upgrade to Pro for unlimited attachments.',
    );
  });

  it('names the per-file size, and the plan only when it is the free one', () => {
    expect(attachmentTooLargeMessage(FREE_PLAN_ATTACHMENT_MAX_BYTES, false)).toBe(
      'That file is larger than 10 MB, the most one attachment can be on the free plan.',
    );
    expect(attachmentTooLargeMessage(25 * 1024 * 1024, true)).toBe('That file is larger than 25 MB, the most one attachment can be.');
  });

  it('prints a size in KB or MB', () => {
    expect(formatAttachmentSize(300)).toBe('1 KB');
    expect(formatAttachmentSize(450 * 1024)).toBe('450 KB');
    expect(formatAttachmentSize(3.4 * 1024 * 1024)).toBe('3.4 MB');
  });
});
