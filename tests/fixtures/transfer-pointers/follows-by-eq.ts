export function sellerSession(db: { from: (t: string) => { select: (c: string) => { eq: (c: string, v: string) => unknown } } }, id: string) {
  return db.from('sessions').select('*').eq('copied_from_session_id', id);
}
