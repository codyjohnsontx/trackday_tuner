import type { ServiceEntryRecord } from '@/lib/service-book/book-data';
import { describeEntryItems } from '@/lib/service-book/entry-draft';
import { readCustomFields, type ServiceBookField } from '@/lib/service-book/fields';
import { formatDistance, formatHours, formatMoney, formatServiceDate } from '@/lib/service-book/format';
import type { DistanceUnit } from '@/types/supabase';

interface ServiceEntryDetailsProps {
  entry: ServiceEntryRecord;
  fields: ServiceBookField[];
  distanceUnit: DistanceUnit;
}

function Row({ label, value }: { label: string; value: string | null }) {
  if (value === null || value === '') return null;
  return (
    <div className="flex items-start justify-between gap-3 py-1.5">
      <span className="text-sm text-ink-dim">{label}</span>
      <span className="text-right text-sm font-medium text-ink">{value}</span>
    </div>
  );
}

/**
 * An entry as stored, read-only: what the demo shows, and what a removed entry
 * shows above its history. Custom fields are read by the same leaf rule the
 * form uses, so a value of the wrong kind reads as not logged rather than
 * throwing.
 */
export function ServiceEntryDetails({ entry, fields, distanceUnit }: ServiceEntryDetailsProps) {
  const customValues = readCustomFields(fields, entry.custom_fields);
  const customFields = fields.filter((field) => field.builtin_key === null && customValues[field.id] !== null);

  return (
    <section className="rounded-card bg-surface p-4">
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-faint">Entry</h2>
      <div className="divide-y divide-white/5">
        <Row label="Service date" value={formatServiceDate(entry.service_date)} />
        <Row label="Done" value={describeEntryItems(entry.items) || null} />
        <Row label="Hours" value={formatHours(entry.reading_hours)} />
        <Row label="Distance" value={formatDistance(entry.reading_distance, distanceUnit)} />
        <Row label="Done by" value={entry.performed_by === 'self' ? 'Myself' : entry.performed_by === 'shop' ? 'A shop' : null} />
        <Row label="Shop" value={entry.shop_name} />
        <Row label="Cost" value={formatMoney(entry.cost_cents, entry.currency)} />
        {customFields.map((field) => {
          const value = customValues[field.id];
          const text = field.field_type === 'money' ? formatMoney(value) : field.field_type === 'date' ? formatServiceDate(value) : String(value);
          return <Row key={field.id} label={field.label} value={text} />;
        })}
        {entry.parts.length > 0 ? (
          <div className="py-1.5">
            <span className="text-sm text-ink-dim">Parts</span>
            <ul className="mt-1 space-y-0.5">
              {entry.parts.map((part) => (
                <li key={part.id} className="text-sm text-ink">
                  {[part.brand, part.part_number].filter(Boolean).join(' ')}
                  {part.quantity !== null ? ` × ${part.quantity}` : ''}
                  {formatMoney(part.unit_cost_cents) ? ` · ${formatMoney(part.unit_cost_cents)} each` : ''}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {entry.notes ? (
          <div className="py-1.5">
            <span className="text-sm text-ink-dim">Notes</span>
            <p className="mt-1 whitespace-pre-wrap text-sm text-ink">{entry.notes}</p>
          </div>
        ) : null}
      </div>
    </section>
  );
}
