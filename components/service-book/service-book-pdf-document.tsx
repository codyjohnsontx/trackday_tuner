import { Document, Image, Page, StyleSheet, Text, View } from '@react-pdf/renderer';
import { ATTACHMENT_KIND_LABELS } from '@/lib/service-book/attachments';
import { toPdfText, type PdfRequest } from '@/lib/service-book/pdf-plan';
import { describeRemovedEntries, type SharedBookView, type SharedEntry } from '@/lib/service-book/shared-view';

/**
 * A bike's service book as a PDF (owner, Q5 and PQ4), drawn from the same
 * `SharedBookView` the shared page prints and nothing else, so the file holds no
 * more than a share link shows. Paper, not the app: black on white in the PDF
 * standard Helvetica, so it prints and opens anywhere with no font to embed.
 */

/** One photo the full variant prints on its own page, already read from storage. */
export interface PdfImagePage {
  caption: string;
  data: Buffer;
}

export interface ServiceBookPdfProps {
  view: SharedBookView;
  request: PdfRequest;
  images: PdfImagePage[];
  /** "Made 16 Oct 2026": when the file was made, in the owner's zone when the book has one. */
  generatedOn: string;
}

const INK = '#111111';
const DIM = '#555555';
const FAINT = '#888888';
const RULE = '#dddddd';

const styles = StyleSheet.create({
  page: { paddingTop: 40, paddingBottom: 52, paddingHorizontal: 44, fontFamily: 'Helvetica', fontSize: 10, color: INK, lineHeight: 1.35 },
  title: { fontSize: 22, lineHeight: 1.2, fontFamily: 'Helvetica-Bold' },
  subtitle: { marginTop: 4, fontSize: 12, color: DIM },
  meta: { marginTop: 6, fontSize: 9, color: FAINT },
  intro: { marginTop: 10, color: DIM },
  readings: { marginTop: 10, flexDirection: 'row', gap: 24 },
  readingLabel: { fontSize: 8, color: FAINT },
  readingValue: { fontSize: 13, fontFamily: 'Helvetica-Bold' },
  heading: { marginTop: 20, marginBottom: 6, paddingBottom: 4, borderBottomWidth: 1, borderBottomColor: INK, fontSize: 12, fontFamily: 'Helvetica-Bold' },
  itemRow: { flexDirection: 'row', paddingVertical: 4, borderBottomWidth: 0.5, borderBottomColor: RULE },
  itemName: { width: '40%', fontFamily: 'Helvetica-Bold' },
  itemCell: { width: '30%', color: DIM },
  entry: { paddingVertical: 8, borderBottomWidth: 0.5, borderBottomColor: RULE },
  entryHead: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  entryTitle: { flexShrink: 1, fontFamily: 'Helvetica-Bold', fontSize: 11 },
  entryDate: { color: DIM },
  labels: { marginTop: 3, fontSize: 8.5, color: DIM },
  detail: { flexDirection: 'row', marginTop: 2 },
  detailLabel: { width: 90, color: DIM },
  detailValue: { flex: 1 },
  muted: { color: DIM },
  note: { marginTop: 8, color: DIM },
  imagePage: { paddingTop: 40, paddingBottom: 52, paddingHorizontal: 44, fontFamily: 'Helvetica', fontSize: 10, color: INK },
  imageCaption: { marginBottom: 10, fontFamily: 'Helvetica-Bold' },
  image: { width: '100%', maxHeight: 640, objectFit: 'contain' },
  footer: { position: 'absolute', bottom: 24, fontSize: 8, color: FAINT },
  footerLeft: { left: 44 },
  footerRight: { left: 44, right: 44, textAlign: 'right' },
});

// Two fixed texts rather than one fixed view: react-pdf drops a fixed view from
// every page of a page that wraps, and keeps a fixed text.
function Footer({ title }: { title: string }) {
  return (
    <>
      <Text style={[styles.footer, styles.footerLeft]} fixed>
        {title} · service book
      </Text>
      <Text style={[styles.footer, styles.footerRight]} fixed render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
    </>
  );
}

function printableView(view: SharedBookView): SharedBookView {
  return {
    ...view,
    title: toPdfText(view.title),
    subtitle: view.subtitle === null ? null : toPdfText(view.subtitle),
    readings: view.readings.map((reading) => ({ value: toPdfText(reading.value), on: toPdfText(reading.on) })),
    items: view.items.map((item) => ({
      ...item,
      name: toPdfText(item.name),
      interval: item.interval === null ? null : toPdfText(item.interval),
      lastDone: item.lastDone === null ? null : toPdfText(item.lastDone),
    })),
    entries: view.entries.map((entry) => ({
      ...entry,
      serviceDate: toPdfText(entry.serviceDate),
      title: toPdfText(entry.title),
      details: entry.details.map((detail) => ({ label: toPdfText(detail.label), value: toPdfText(detail.value) })),
      parts: entry.parts.map(toPdfText),
      notes: entry.notes === null ? null : toPdfText(entry.notes),
      labels: entry.labels.map(toPdfText),
    })),
  };
}

function attachmentLine(entry: SharedEntry, variant: PdfRequest['variant']): string | null {
  if (entry.attachments.length === 0) return null;
  const names = entry.attachments.map((attachment) =>
    attachment.mime === 'application/pdf' ? `${ATTACHMENT_KIND_LABELS[attachment.kind]} (PDF file)` : ATTACHMENT_KIND_LABELS[attachment.kind],
  );
  const photos = entry.attachments.some((attachment) => attachment.mime === 'image/jpeg');
  const where = variant === 'full' && photos ? ' - photos are on the pages at the end' : '';
  return `${names.join(', ')}${where}`;
}

function EntryBlock({ entry, variant }: { entry: SharedEntry; variant: PdfRequest['variant'] }) {
  const attachments = attachmentLine(entry, variant);
  return (
    <View style={styles.entry} wrap={false}>
      <View style={styles.entryHead}>
        <Text style={styles.entryTitle}>{entry.title}</Text>
        <Text style={styles.entryDate}>{entry.serviceDate}</Text>
      </View>
      {entry.labels.length > 0 ? <Text style={styles.labels}>{entry.labels.join(' · ')}</Text> : null}
      {entry.details.map((detail) => (
        <View key={detail.label} style={styles.detail}>
          <Text style={styles.detailLabel}>{detail.label}</Text>
          <Text style={styles.detailValue}>{detail.value}</Text>
        </View>
      ))}
      {entry.parts.length > 0 ? (
        <View style={styles.detail}>
          <Text style={styles.detailLabel}>Parts</Text>
          <View style={styles.detailValue}>
            {entry.parts.map((part, index) => (
              <Text key={index}>{part}</Text>
            ))}
          </View>
        </View>
      ) : null}
      {entry.notes ? (
        <View style={styles.detail}>
          <Text style={styles.detailLabel}>Notes</Text>
          <Text style={styles.detailValue}>{entry.notes}</Text>
        </View>
      ) : null}
      {attachments ? (
        <View style={styles.detail}>
          <Text style={styles.detailLabel}>Attachments</Text>
          <Text style={styles.detailValue}>{attachments}</Text>
        </View>
      ) : null}
    </View>
  );
}

export function ServiceBookPdfDocument({ view: given, request, images, generatedOn }: ServiceBookPdfProps) {
  const view = printableView(given);
  const removed = describeRemovedEntries(view.removedCount);
  const scope = request.year === null ? null : `Entries from ${request.year} only`;
  const variantName = request.variant === 'full' ? 'Full copy with photos' : 'Summary';
  const entryCount = `${view.entries.length} ${view.entries.length === 1 ? 'entry' : 'entries'}`;

  return (
    <Document title={`${view.title} - service book`} creator="Trackday Tuner" producer="Trackday Tuner" language="en">
      <Page size="LETTER" style={styles.page}>
        <Footer title={view.title} />
        <Text style={styles.title}>{view.title}</Text>
        <Text style={styles.subtitle}>{view.subtitle ?? 'Service book'}</Text>
        <Text style={styles.meta}>
          Service book · {variantName}
          {scope ? ` · ${scope}` : ''} · {generatedOn}
        </Text>
        <Text style={styles.intro}>
          A read-only copy shared by the bike&apos;s owner. Each entry says when it was logged as well as when the work was done, and whether it
          was edited since.
        </Text>

        {view.readings.length > 0 ? (
          <View style={styles.readings}>
            {view.readings.map((reading) => (
              <View key={reading.value}>
                <Text style={styles.readingLabel}>Last reading, {reading.on}</Text>
                <Text style={styles.readingValue}>{reading.value}</Text>
              </View>
            ))}
          </View>
        ) : null}

        <Text style={styles.heading}>
          Schedule · {view.items.length} {view.items.length === 1 ? 'item' : 'items'}
        </Text>
        {view.items.length === 0 ? (
          <Text style={styles.muted}>No items in this book.</Text>
        ) : (
          view.items.map((item) => (
            <View key={item.id} style={styles.itemRow} wrap={false}>
              <Text style={styles.itemName}>{item.name}</Text>
              <Text style={styles.itemCell}>{item.interval ?? 'No interval set'}</Text>
              <Text style={styles.itemCell}>{item.lastDone ? `Last done ${item.lastDone}` : 'Never logged'}</Text>
            </View>
          ))
        )}

        <Text style={styles.heading} minPresenceAhead={60}>
          Entries · {entryCount}
          {scope ? ` (${request.year})` : ''}
        </Text>
        {view.entries.length === 0 ? <Text style={styles.muted}>Nothing logged yet.</Text> : null}
        {view.entries.map((entry) => (
          <EntryBlock key={entry.id} entry={entry} variant={request.variant} />
        ))}
        {removed ? <Text style={styles.note}>{removed}{scope ? ', across the whole book' : ''}.</Text> : null}
        {!view.labelled && view.entries.length > 0 ? (
          <Text style={styles.note}>When each entry was logged is shown once the owner next opens their book.</Text>
        ) : null}
      </Page>

      {images.map((image, index) => (
        <Page key={index} size="LETTER" style={styles.imagePage}>
          <Footer title={view.title} />
          <Text style={styles.imageCaption}>{toPdfText(image.caption)}</Text>
          {/* react-pdf's Image, not an HTML img: a PDF image takes no alt, and the caption above names it. */}
          {/* eslint-disable-next-line jsx-a11y/alt-text */}
          <Image src={{ data: image.data, format: 'jpg' }} style={styles.image} />
        </Page>
      ))}
    </Document>
  );
}
