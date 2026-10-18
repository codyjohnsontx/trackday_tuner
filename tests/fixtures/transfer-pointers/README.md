# Fixtures for `tests/unit/transfer-pointers-never-followed.test.ts`

Code the sweep must flag, kept outside `lib/` and `app/` so nothing imports it.
Each file is one way of following a handover pointer (`copied_from_*`,
`transferred_from_*`) to the other rider's row, which no reader may do: the two
copies of a handed-over bike never see each other's data.

- `follows-by-eq.ts` - `.eq('copied_from_session_id', id)`, a lookup by pointer.
- `follows-by-in.ts` - `.in('copied_from_entry_id', ids)`, the same over a list.
- `follows-in-or.ts` - an `.or()` filter string equating a pointer to an id.
- `allowed-null-checks.ts` - what the sweep must NOT flag: `.is(ptr, null)` and
  an `.or()` that only asks whether the pointer is null, which the free caps use.
