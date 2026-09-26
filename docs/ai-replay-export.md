# Exporting kept AI questions for replay

Riders who turn on question history under Settings have the text of their Race
Engineer questions and Morning Plan requests kept for 90 days
(`ai_request_text`). `npm run ai:export-replay` copies that text, and the
verdict each request got, into a JSONL file that Redline's replay runner reads
to run the same requests through a newer version of the guards.

Every export is a whole snapshot of every question that may leave the database
when the export finishes, never a date window. Redline keeps only the newest
file, so what a rider deleted, stopped keeping or lost with their account
leaves Redline at the next export.

This file is the contract between the two sides. Track Tuner's unit suite holds
the script to it (`tests/unit/export-ai-replay.test.ts` parses the example
below), and Redline's reader tests against the same text. A change to a field is
a change here first, with `format_version` bumped.

## What is exported, and what never is

The script reads one view, `public.ai_replay_export`
(`supabase/migrations/20260927002000_add_ai_replay_export_view.sql`), which is
where the rule is written. A request is exported only when:

- its rider is keeping question history now: they have seen the notice, turned
  keeping on and not turned it off since;
- it was written after the rider's latest opt-in, so text from before they
  agreed, or from before they agreed again, never leaves;
- it has not passed its `retain_until`.

Question history is opt-in for every rider during the beta, so a rider who never
turned it on has nothing to export.

**No `user_id`, `session_id` or `vehicle_id` is in the file.** The view carries
none of them. The rider is a pseudonym: an HMAC-SHA256 of a hash of the user id,
under a secret the script makes for that run and never writes down. Within one
file, one rider's requests share a `rider` value, so probing by one rider can be
grouped.

The pseudonym does not make a line anonymous. Every line carries its
`request_id`, Track Tuner's own id for the request, kept on purpose so the owner
can look a verdict up again. It is not secret:

- Track Tuner's database maps it to the rider's account, and the owner has that
  database;
- the rider's own app shows it, under a Race Engineer answer ("Request id");
- Track Tuner's operational logs record it, and some error reports record it
  beside the rider's user id and vehicle id.

So anyone holding a line and any one of those - database access, the rider's
screen, or the logs - can tie that line to an account.

`request_id` is also the same in every export, so a request that is in two
files joins them, and with them the rider's two pseudonyms. Nothing in the
file prevents that. What keeps it from happening is that only one file is ever
kept: Redline deletes the previous file when it takes the newest one (below).

What riders typed was masked before it was stored (emails, phone numbers, web
links, ids and long digit runs; `redaction_version` says which rules). Names and
anything else a regex cannot find are not masked.

## Running it

Owner only, from a machine holding the production service key in `.env.local`.
Never from CI and never from Redline's cloud project.

1. The view must be on the database first. The hosted project has no migration
   history, so the owner applies it by hand once, before the first export:
   docs/beta-runbook.md, "Apply the replay export view by hand".
2. Run:

   ```bash
   npm run ai:export-replay -- --out ~/replay-2026-10-01.jsonl
   ```

   There is no date range: the file holds everything the view allows now.
   `--out` is required, so rider text is never printed to a terminal, and the script refuses to overwrite an existing file. Point it
   outside the repository: nothing ignores a `.jsonl` there, so a copy in the
   working tree could be staged by mistake. The file is created readable by
   its owner only. The file is built under a temporary name beside the target
   and linked into place only when it is whole, so a run that fails or is
   interrupted - an error, Ctrl-C, a closed laptop - leaves nothing at the path
   you gave. A temporary `.<name>.<random>.partial` file can survive only if the
   machine loses power while the file is being written; delete it if you see
   one.
   The view is read in pages, and a question can stop being exportable while
   they are read - its rider deletes it or turns keeping off, or it passes
   `retain_until`. Before anything is written the script asks the view about
   every collected request once more and leaves out any that left, and says
   how many it left out. The file is what the view allowed at that final
   check.
3. The script prints how many requests it wrote and the earliest `retain_until`
   in the file. That date is the latest the first line can stay, if no newer
   export replaces it first.
4. Move the file to Redline, which replaces its whole copy with it and deletes
   the previous file, and delete the local copy.

## The JSONL contract

UTF-8, one JSON object per line, one line per request, ordered by `created_at`.
An export with nothing to send is an empty file.

<!-- replay-record-example -->
```json
{
  "format_version": 1,
  "request_id": "9b0f3c1e-5d2a-4c61-9e0b-2f7d1a6c4e88",
  "route": "tuning_advice",
  "created_at": "2026-10-03T14:12:09.412+00:00",
  "retain_until": "2027-01-01T14:12:09.412+00:00",
  "app_commit": "852a61500b2d6f5c1e0a9d3b7c4f8e21a6d09b3c",
  "rider": "3f6c0a9e1b27d4c58e93f0a1b6d2c7e4958f1a0b3c6d9e2f4a7b0c3d6e9f2a15",
  "submitted": {
    "question": "Front pushes mid-corner, call me on [phone]",
    "symptoms": ["understeer_mid"],
    "change_intent": "better_feel"
  },
  "redaction_version": 1,
  "verdict": {
    "status": "completed_refusal_prompt_injection",
    "refusal_reason": "prompt_injection",
    "policy_result": "force_refusal",
    "policy_violations": [],
    "classifier_stage": "preflight"
  },
  "model": "gpt-5.4-mini-2026-03-17"
}
```

Every key is present on every line; a value that was never recorded is `null`,
never absent.

| Field | Type | Meaning |
| --- | --- | --- |
| `format_version` | integer | This contract's version. `1` today. A reader refuses a version it does not know. |
| `request_id` | string | Track Tuner's id for the request, the same in every export. Lets the owner find the verdict row again. It ties the line to an account for anyone with Track Tuner database access, the rider's own screen, or the operational logs (above). |
| `route` | `"tuning_advice"` or `"day_plan"` | Which AI route took the request, and so which `submitted` shape follows. |
| `created_at` | ISO 8601 timestamp | When the text was stored. |
| `retain_until` | ISO 8601 timestamp | **When every copy of this line must be deleted.** At most 90 days after `created_at`. |
| `app_commit` | string or null | The commit whose guards produced the verdict. Null for a request served locally. |
| `rider` | 64 hex characters | Pseudonym, stable within this file only. |
| `submitted` | object | The rider's fields exactly as the route validated and redacted them, below. |
| `redaction_version` | integer | Which masking rules produced `submitted`. |
| `verdict.status` | string | `ai_requests.status`: `ok` and `ok_confidence_downgraded` for served advice, `completed_refusal_<reason>` for a refusal, `rate_limited_hour`, `rate_limited_minute` and `duplicate_recent_request`, the failures such as `error` and `upstream_timeout`, and `pending` for a request that never finished. `lib/monitoring/ai-health.ts` classifies them all. |
| `verdict.refusal_reason` | string or null | Why a refusal was a refusal. |
| `verdict.policy_result` | string or null | What `evaluateAdvicePolicy` decided. |
| `verdict.policy_violations` | array of strings | Which policy rules fired; empty when none did. |
| `verdict.classifier_stage` | string or null | Which guard stage produced the verdict, `preflight`, `stored_rider_text`, `dedupe` or `post_policy`. |
| `model` | string or null | The model snapshot that answered, when one was reached. |

`submitted` by route. Each listed key is always present, `null` when the rider
left it empty:

- `tuning_advice`: `question` (string), `symptoms` (array of strings),
  `change_intent` (string or null).
- `day_plan`: `track_name`, `weather_condition`, `surface_condition` (each
  string or null) and `target_date` (`YYYY-MM-DD`).

`submitted` holds the fields the classifiers read (`classifyRaceEngineerQuestion`,
`classifyDayPlanRequest`, `classifyDangerousPremise`), so Redline can re-run
those guards and compare with `verdict`. It cannot re-run the stored-text screen
or the post-model policy: those read session notes, vehicle names and model
output the export does not carry (owner decision D7). A `stored_rider_text`
verdict can be counted, not replayed.

## Redline's obligation: keep only the newest file, and delete at `retain_until`

Riders were told their text is kept for 90 days, that deleting a question,
turning history off or deleting their account deletes it, and that a copy used
in Redline goes at the next export. The export is a copy, and a promise that is
true of the database and false of the copy is not kept. So Redline:

- **replaces its whole copy with each new file** and deletes the previous file,
  from every place it stored it. It never merges two files and never keeps an
  older one beside the newest. That is how a rider's deletion reaches Redline,
  and the only thing that stops a rider's pseudonyms from two exports being
  joined through a shared `request_id`;
- **deletes each line no later than its `retain_until`** even when no newer
  export arrives, and keeps only what is derived from it - labels, counts and
  aggregate scores - after that (owner decision D8).

Track Tuner cannot check this from its side. It is the condition on which the
export is made.
