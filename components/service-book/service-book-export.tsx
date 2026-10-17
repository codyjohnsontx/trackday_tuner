import { Button } from '@/components/ui/button';
import { CardGroup, GroupRow } from '@/components/ui/surface';
import { PDF_IMAGE_CAP, pdfQuery, type PdfOffer } from '@/lib/service-book/pdf-plan';

interface ServiceBookExportProps {
  /** Where the files are made: the owner's route or a share link's. */
  base: string;
  offer: PdfOffer;
  /** Whose words: the owner's screen says "your", a shared copy does not. */
  audience: 'owner' | 'visitor';
}

/**
 * Downloads of the book as a PDF (owner, Q5). The summary always; the full file
 * with photos whole when it fits under the photo cap, and one year at a time
 * when it does not. Plain links, so a phone saves or opens the file itself.
 */
export function ServiceBookExport({ base, offer, audience }: ServiceBookExportProps) {
  const link = (query: string, label: string, variant: 'primary' | 'secondary' = 'secondary') => (
    <Button asChild variant={variant} size="sm">
      <a href={`${base}${query}`} download>
        {label}
      </a>
    </Button>
  );

  return (
    <CardGroup eyebrow="Export" title="PDF">
      <GroupRow className="space-y-3">
        <p className="text-sm text-ink-dim">
          {audience === 'owner'
            ? 'The same copy a share link shows, as a file: every entry with when it was logged, and no removed entry beyond the count.'
            : 'This book as a file to keep.'}{' '}
          The summary has no photos; the full PDF adds each photo on a page of its own.
        </p>
        <div className="flex flex-wrap gap-2">
          {link(pdfQuery({ variant: 'summary', year: null }), 'Summary PDF', 'primary')}
          {offer.images === 0 ? null : offer.wholeFull ? link(pdfQuery({ variant: 'full', year: null }), `Full PDF · ${offer.images} ${offer.images === 1 ? 'photo' : 'photos'}`) : null}
        </div>
      </GroupRow>

      {offer.images > 0 && !offer.wholeFull ? (
        <GroupRow className="space-y-3">
          <p className="text-sm text-ink-dim">
            This book has {offer.images} photos, more than the {PDF_IMAGE_CAP} one file can carry, so the full PDF comes one year at a time.
          </p>
          <ul className="flex flex-wrap gap-2" aria-label="Full PDF by year">
            {offer.years.map((year) => (
              <li key={year.year}>
                {year.fits ? (
                  link(pdfQuery({ variant: 'full', year: year.year }), `${year.year} · ${year.images} ${year.images === 1 ? 'photo' : 'photos'}`)
                ) : (
                  <span className="flex min-h-11 items-center px-3 text-xs text-ink-faint">
                    {year.year}: {year.images} photos, too many for one file
                  </span>
                )}
              </li>
            ))}
          </ul>
        </GroupRow>
      ) : null}
    </CardGroup>
  );
}
