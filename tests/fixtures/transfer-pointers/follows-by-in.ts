export function sellerEntries(db: { from: (t: string) => { select: (c: string) => { in: (c: string, v: string[]) => unknown } } }, ids: string[]) {
  return db.from('service_entries').select('*').in('copied_from_entry_id', ids);
}
