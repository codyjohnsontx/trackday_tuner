import {
  ATTACHMENT_IMAGE_LONG_EDGE,
  ATTACHMENT_JPEG_QUALITY,
  ATTACHMENT_THUMB_LONG_EDGE,
  classifyAttachmentFile,
  fitWithin,
} from '@/lib/service-book/attachments';
import type { ServiceAttachmentMime } from '@/types/supabase';

/**
 * What the browser uploads for a file the rider chose. A photo is re-encoded
 * here, so a 12-megapixel phone picture leaves the device as a ~0.5 MB JPEG
 * with a ~30 KB thumbnail beside it, and the list views read the thumbnail:
 * Supabase's own image transforms are a Pro-plan feature and the project is on
 * Free. Re-encoding through a canvas also drops the photo's EXIF, location
 * included. A PDF is uploaded as it is.
 */
export type EncodedAttachment =
  | { ok: true; mime: ServiceAttachmentMime; file: Blob; thumb: Blob | null }
  | { ok: false; error: string };

async function drawJpeg(image: ImageBitmap, longEdge: number): Promise<Blob> {
  const { width, height } = fitWithin(image.width, image.height, longEdge);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('no 2d canvas');
  // A transparent PNG would otherwise come out black.
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('the image could not be encoded'))), 'image/jpeg', ATTACHMENT_JPEG_QUALITY);
  });
}

export async function encodeAttachment(file: File): Promise<EncodedAttachment> {
  const source = classifyAttachmentFile(file);
  if (source.kind === 'refused') return { ok: false, error: source.reason };
  if (source.kind === 'pdf') return { ok: true, mime: 'application/pdf', file, thumb: null };

  let image: ImageBitmap;
  try {
    // `from-image` applies the EXIF rotation before the EXIF is dropped.
    image = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    return { ok: false, error: 'That photo could not be read. Try a JPEG or PNG.' };
  }
  try {
    const [full, thumb] = await Promise.all([
      drawJpeg(image, ATTACHMENT_IMAGE_LONG_EDGE),
      drawJpeg(image, ATTACHMENT_THUMB_LONG_EDGE),
    ]);
    return { ok: true, mime: 'image/jpeg', file: full, thumb };
  } catch {
    return { ok: false, error: 'That photo could not be prepared for upload.' };
  } finally {
    image.close();
  }
}
