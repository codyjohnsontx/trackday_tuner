export function sellerBook(db: { from: (t: string) => { select: (c: string) => { or: (f: string) => unknown } } }, id: string) {
  return db.from('service_books').select('*').or(`transferred_from_book_id.eq.${id},id.eq.${id}`);
}
