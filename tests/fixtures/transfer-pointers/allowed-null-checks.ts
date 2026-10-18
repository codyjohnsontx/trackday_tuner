type Q = { is: (c: string, v: null) => unknown; or: (f: string) => unknown };
export function ownSessions(db: { from: (t: string) => { select: (c: string) => Q } }, userId: string) {
  const query = db.from('sessions').select('id');
  query.is('copied_from_session_id', null);
  return query.or(`copied_from_session_id.is.null,original_user_id.eq.${userId}`);
}
