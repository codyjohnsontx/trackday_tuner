---
name: trackday-service-book
description: "Use when changing trackday_tuner service books, maintenance entries, transfers, shares, PDFs, attachments, or reminders."
---

## The Service Book

A bike's maintenance record (slice 1 schema: 20261010000100, 20261010000200;
owner decisions 2026-10-08). Its honesty rules live in the database, so a screen
cannot weaken them and a new writer does not have to remember them:

- **Ownership runs through the book.** Every child row reaches its rider through
  `service_book_owned(book_id)` (or `service_entry_owned`), never a `user_id`
  column; a book belongs to whoever owns its vehicle.
- **`logged_at` is the server's.** No rider grant reaches it, `logged_by`,
  `revision` or a book's transfer origin - inserts and updates are granted per
  column. `service_entries_pin` dates every insert and keeps `logged_at`,
  `logged_by` and `revision` on every update, the service role's included, but
  the service role supplies `logged_by` on insert and nothing pins a book's
  transfer origin against it. The rider types `service_date`; the gap between
  the two is what labels an entry back-filled.
- **Every change to an entry, its items or its parts writes a revision**, from a
  trigger, and one transaction is one revision - so save an entry with its items
  in one call (an RPC) if it should read "unedited". A save that changes nothing
  in the snapshot writes none and leaves `revision` alone. No API role, the service
  role included, can write, change or delete `service_entry_revisions`.
- **Entries are never deleted by a rider.** `delete` is granted to no API role;
  removing one sets `deleted_at` (the server dates it), which writes a `deleted`
  revision and drops the entry's reading. Only a cascade hard-deletes: the
  vehicle's, or the book's, which the service role can still delete.
- **An entry's reading is a `vehicle_readings` row** (`source = 'entry'`),
  written and kept in step by a trigger; a rider writes only `source = 'rider'`.
  A rider's reading is never updated or deleted: a correction is a new reading
  whose `supersedes_id` names one of the same book's rider readings (at most
  once), so the old value stays, and current usage is the latest reading that
  nothing supersedes.
- **Transfer copies, it does not move** (owner, PQ2; TQ1-TQ6, 2026-10-17;
  20261017000600): the buyer gets a new vehicle, book and sessions, copied in
  ONE transaction, `accept_service_book_transfer`, after
  `prepare_service_book_transfer_accept` mints the ids and names the storage
  objects the server copies first (SQL cannot write one); accept is TT409 until
  every object is there and every session and receipt is mapped. A copied entry
  keeps the seller's dates, author and revisions under a `transferred` one,
  because the pins apply to the Data API roles only - keep it that way. **A new
  table that describes the bike goes into the copy or is excluded on purpose**
  (the plan's table: baseline, AI rows and audit trail stay with the seller).
  `copied_from_*` and `transferred_from_book_id` are pointers, never followed to
  the other rider's row. **Every free-cap count skips copies**
  (`copied_from_session_id` / `copied_from_attachment_id` null) **except one the
  rider logged themselves, come back on a bike handed back** (TQ7: a session's
  `original_user_id`, which accept writes, or an attachment's `created_by`), and
  the vehicle count skips sold bikes (`vehiclesTowardPlan`). A sold bike is the seller's
  read-only copy: **every write policy on a service book table reads
  `service_book_writable`**, never `service_book_owned` alone - except
  `service_book_shares`, so a sold bike's share link still works - and the
  write functions answer TT410; a copied entry is remove-only for the buyer
  (TT403). That check reads the bike `for key share`, as the session trigger
  does, so a write racing accept waits and then sees it sold.
  `tests/db/service-book-transfer.spec.ts` proves it as two riders; the hosted
  paste is "Hand a service book to a buyer, by hand". **The seller's screens
  read `vehicle.sold_at` and offer no save on a sold bike**, the demo's rule
  again: `ServiceBookData.vehicle` carries it, the entry, new-entry and settings
  pages redirect or go read-only on it, `getServiceDueBooks` leaves a sold bike
  out (no due chip, no weight control), and the new-session picker lists only
  unsold bikes. The handover screen (`/garage/[id]/book/handover`,
  `lib/actions/service-book-transfers.ts`) counts what goes over off the same
  `getServiceBook` read the book renders, through `countHandover`
  (`lib/service-book/handover.ts`); the three figures that read never loads
  (session photos, outcomes, this owner's removed entries) come from
  `getServiceBookHandoverCounts`. One pending link per book, read by
  `getServiceBookHandover` and shown by `HandoverStatus` on the card, the book
  and the screen; the link is `/transfer/<token>`, token hashed as a share
  link's is.
- **The buyer takes the bike at `/transfer/[token]`**, outside `(app)` so a
  signed-out buyer is offered sign-in and comes back through `/login?next=`
  (the one `next` the login page reads, through `sanitizeNextPath`). The page
  asks `describe_service_book_transfer` with the service role for the viewer
  signed in now, prints what `lib/service-book/handover-view.ts` makes of the
  answer, and shows the bike only to the recipient of a pending link; every
  other link reads the same way. Accept is `takeOverServiceBook`
  (`lib/service-book-transfer-accept.ts`): prepare, copy the objects ten at a
  time with the service role (a destination already there counts as done),
  accept, and again on TT409 up to three times, taking the public-bucket
  copies back when it gives up. A copied entry reads "Logged by a previous
  owner, handed over on <date>" (`describeEntryProvenance`, dated from the
  book's `transferred_at` in its pinned zone) with the seller's edits counted
  below the last `transferred` revision and the buyer's above it; it opens
  read-only with only Remove, since the database refuses every other change
  (TT403). The book's banner (what of the handed-over history is still here)
  and its "N entries removed by an owner" line, across every owner, come from
  `describeReceivedHistory`, which counts the rows' own `copied_from_*`
  pointers. **Nothing follows one of those pointers to the
  other rider's row** - a cap reads one as a null check, a screen as a boolean
  - `tests/unit/transfer-pointers-never-followed.test.ts` shows the screens and
  caps print the same whichever row a pointer names, and
  `tests/db/service-book-transfer.spec.ts` that following one as the buyer
  finds nothing.
  `tests/e2e/service-book-handover-buyer.spec.ts` is the two-rider walk from
  the buyer's side and records the copy's wall time for a 25-receipt bike;
  `tests/e2e/service-book-handover.spec.ts` is the seller's.

`tests/db/service-book.spec.ts` proves each of these against a real database.

**The book's screens run the rules on the rider's device, not on the server.**
`computeDue` needs today's date in the rider's calendar (`todayLocalDate`), so
`useRiderClock` (`components/service-book/rider-clock.ts`) reads the day and
zone off the browser after mount and `buildServiceBookView`
(`lib/service-book/book-data.ts`) runs every rule once over the rows the server
loaded. `describeEntryProvenance` needs the book OWNER's time zone, and every
screen - the owner's, the share link, a PDF - reads it from
`service_books.owner_time_zone` (20261016000500), never the viewer's zone, so
owner and buyer see the same labels; the owner's screens fall back to the
browser's zone only until one is stored (`ownerLabelTimeZone`). The owner's
browser writes it the first time they open the book or make a link. Once set
it never changes (owner, 2026-10-16: a label never moves without an edit), and
a trigger keeps it against every writer, the service role's included. The server actions in
`lib/actions/service-book.ts` read and write rows only; the demo book is
`lib/demo/service-book.ts`, and `tests/unit/service-book-screens.test.ts` holds
the form to opening with nothing pressed and the demo to offering no save.

**An entry is saved through `save_service_entry` (20261013000300), never as
separate inserts.** The history records one revision per committed transaction
and PostgREST writes one table per request, so an entry saved with its items
and parts as three requests read "Edited 2 times" the moment it was saved
(measured on a stack built from the migrations). The function writes the three
in one transaction as the rider (`security invoker`, so RLS and the per-column
grants still apply) and RECONCILES items and parts rather than replacing them,
so an untouched Save keeps every row's id and the pin reads no edit.
`tests/db/save-service-entry.spec.ts` proves one save is one revision and an
unchanged re-save adds none; the hosted paste is "Save a service entry in one
transaction, by hand" in `docs/beta-runbook.md`.

**A share link is a token nobody stores** (20261016000500). Only its SHA-256 is
kept; `/book/[token]` is rendered on the server with the service role after
`open_service_book_share` answers which book an unrevoked link opens (rate
limited on the token's hash, view counted), and it prints
`buildSharedBookView` (`lib/service-book/shared-view.ts`) and never a row - no
rider id, email or session, a removed entry only as a count. Its attachments
open through `/book/[token]/attachments/[id]`, signed per open.
`tests/db/service-book-shares.spec.ts` proves the table's rules and
`tests/e2e/service-book-share.spec.ts` the walk.

**The PDF is the share link's view as a file** (`lib/service-book-pdf.ts`, owner
PQ4). The owner's route (`/api/service-book/vehicles/[vehicleId]/pdf`, RLS read
of the book first) and the share's (`/book/[token]/pdf`, `openShare` first) both
print `buildSharedBookView` through `loadSharedBook`, so neither can carry more
than the shared page. A full file embeds the stored photos (no resize - that
would be another dependency), at most `PDF_IMAGE_CAP` per file, year by year
past it (`lib/service-book/pdf-plan.ts`); a share link also spends one of
`SHARE_FULL_PDF_LIMIT` full files a day, since each reads every photo. **The
response is streamed on purpose**: Vercel refuses a buffered function response
over 4.5 MB, and 150 photos are about 65 MB.

**Attachments live in a private bucket no rider policy opens** (20261014000400).
`service-book` is `public = false` with no `storage.objects` policy naming it, on
purpose: `reserve_service_attachment` counts the allowance (25 per bike free,
`lib/plans.ts`) under a per-book lock and mints the object path, the server signs
an upload URL for it, the browser resizes and uploads, and
`confirm_service_attachment` flips the row to `ready` only once it reads the
object back from `storage.objects`. Thumbnails are signed in one batch as the
entry page renders; a file opens through
`/api/service-book/attachments/[attachmentId]`, which signs a URL on every open
after the rider's own select of the row, so a page left open never holds an
expired one.
`tests/unit/storage-bucket-provisioning.test.ts` accepts that shape only for a
bucket on its `SERVER_ONLY_BUCKETS` list. Load the browser Supabase client
lazily (`await import`) in a client component on a page reached by client
navigation: a static import on the entry page hung most navigations into it
under `next start`. SQL cannot delete a stored object, so files leave the
bucket through the Storage API only: a failed upload is taken back by the
action, a deleted bike's files are removed before the bike (as its session
photos are), and `/api/monitoring/service-attachment-sweep`, which the
monitoring workflow calls, removes any object a day old that no `ready` row
names. `tests/db/service-attachments.spec.ts` proves the cap, both sweeps'
SQL and the private bucket.

The rules that read the book - usage from readings and weighted sessions, due
state and the rider's overrides, the honest-history labels, the field layout,
the reminders - are pure modules in `lib/service-book/` (`usage.ts`, `due.ts`,
`provenance.ts`, `fields.ts`, `reminders.ts`) that the phone app is to share,
so `lib/service-book/imports.test.ts` pins their whole import list.

**The reminders are derived on the rider's device from the same rows, never
stored** (owner, Q8 and PQ1: in-app only until there is a domain). The garage
chip, the dashboard line and the session page's notice all go through
`lib/service-book/reminders.ts` over `getServiceDueBooks`, and the book screen's
chip through the same `computeBookDue`, so no two screens can disagree. "This
day pushed X past due" is due with the sessions up to and including that one
against due with the sessions strictly before it, in date order, so only the
day that crossed the line says so; a session left out is weighted 0 rather than
dropped, so no anchor moves, a day the rider weights 0 pushed nothing and the
notice clears; a snoozed item is never pushed, and a day that only brings an
item due soon raises no notice, since the chips already say so. The weight and the overrides are
the rider's word and nothing else writes them: a weight is one row per book and
session (no upsert - PostgREST would write the fixed columns the grant withholds),
an override is always a new row the server dates, and "Clear" is a snooze ending
today, which is what the rule reads as the schedule's own answer again. A
`session_usage_weights` row with weight 1 and no row are the same day to the
math and different to the screen, which shows nothing pressed until the rider
has said. **A weight the server confirmed is shown from the control's own state
ahead of the next server render** (`useStoredWeight`), because a confirmed save
read back at once is the better screen. It began as a workaround: on a
production build the client router dropped a server action's revalidated
re-render of the session page in roughly half of saves (2026-10-14, no console
error), and the service book's client navigations fetched a page - RSC 200,
chunk loaded - and never committed it. Both were one React defect, a Suspense
ping lost while a transition was mid-render (facebook/react#35821), in the
React that Next 15.5 vendored for the App Router - the router never runs the
app's own `react-dom`, so bumping that changed nothing - and fixed in the React
Next 16.3+ vendors, which is why this project is on Next 16 (owner,
2026-10-22; reproduced on 15.5.12 at CI concurrency, gone on 16.4.2). A
re-render that never lands is a framework bug to pin down, not a pattern to
design around. **"Edited" is counted from
`service_entry_revisions`, never from `updated_at`**: a save that changes nothing
writes no revision but still moves `updated_at`.

