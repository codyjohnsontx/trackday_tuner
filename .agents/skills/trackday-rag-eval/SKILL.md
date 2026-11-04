---
name: trackday-rag-eval
description: "Use when changing or running trackday_tuner RAG evaluation, recordings, baselines, scoring, retrieval metrics, or model selection."
---

## The RAG Eval Harness

`scripts/eval-rag.mjs` runs the real pipeline over
`tests/fixtures/rag-eval/golden-cases.json` - 33 requests - and scores what comes
back. **Before this it did none of that.** It read eleven hand-written
`AdviceResponse` objects, applied four boolean shape predicates, imported nothing
from `lib/rag/`, and had reported 100% since the day it was written because its
inputs were constants. A resume audit broke it by injection: responses
recommending 50 psi into a front tire, removing a front brake, and citing a
knowledge-base file that has never existed each scored a perfect 4/4 PASS while
`evaluateAdvicePolicy` force-refuses all three. **An eval strictly weaker than
the guard it evaluates is worse than none**, which is why the rules below are
rules rather than preferences.

**`evaluateAdvicePolicy` IS PART OF THE RUBRIC.** A response the policy
force-refuses is a rubric FAILURE, not a pass - unless refusing is the case's
expected answer (`should_refuse`) - and so is one it serves only after removing
an unverifiable session citation (`invalid_personal_evidence`). That one line is
what makes the harness at least as strict as production. **Grounding resolves
the citation path** against the knowledge index rather than checking the string
is non-empty, which is the other half: `filterCitationsToRetrievedSources`
(`lib/rag/advice.ts`) strips an invented source before a live answer reaches a
scorer, so that class can only be caught by scoring a response directly. Both
live in `scripts/eval/scoring.mjs`, and the three audit responses are
`tests/fixtures/rag-eval/adversarial-responses.json`: every run scores them as a
self-check and exits non-zero if any passes, so a run that reports a pass rate
has also just proved it can report a failure.
`tests/unit/rag-eval-harness.test.ts` locks that in the required checks, because
`rag:eval` failing is not the same as `test:unit` failing.

**The general rule behind that, and the one to apply to anything added here: a
conclusion drawn from a collection has to say what the EMPTY collection
reports.** Three gates were found one at a time whose empty case was the passing
answer - zero golden cases wrote an all-null baseline, zero adversarial fixtures
passed the self-check, an absent baseline value gated nothing. Both fixture sets
now fail the run when empty, whatever the flags, and a baseline that scored no
cases is refused on read. Where empty is instead a real answer it is now written
down beside the code and must stay: `ratio` returns `null` over an empty
population rather than 0, `scoreRetrieval` returns `applicable: false` for an
unlabelled case, `aggregateRetrieval` reports a null `k` when nothing retrieved,
and an absent tape fails by construction because every request then misses. The
one unguarded case is the `METRICS` table itself, deliberately: emptying it is
deleting the gate, and no guard in the same file survives that edit.

**Responses production must SERVE are a unit-suite fixture, not a `rag:eval`
gate.** `tests/fixtures/rag-eval/must-serve-responses.json` holds real recorded
model outputs that production discarded and should not have, and
`tests/unit/rag-eval-harness.test.ts` scores every one through
`parseAdviceResponse` and the policy with `validSessionIds: []`, asserting each is
served with all its evidence parsed and loses that evidence raw. `npm run rag:eval` does not read the file. **Eval
measurements stay reported and are not gated until a bar has been set**, so a new
pass/fail condition in the run is a decision for the owner, never a side effect of
the change that motivated it.

**Offline replays committed tapes; the tape key is the request.** The intercept
is `globalThis.fetch` (`scripts/eval/openai-tape.mjs`), not a mock of
`generateAdvice` - `lib/rag/advice.ts` builds its own client with no injection
seam, so anything higher would score a response production never parsed. Entries
are keyed by a hash of method, path and canonicalized body, so **the prompt is
the key**: change `SYSTEM_PROMPT`, the component vocabulary, a retrieved chunk or
a golden case and the key moves and offline mode reports a miss by name. That is
deliberate. The old harness could not detect the largest prompt change in the
project's history; this one turns it into a red check that says re-record.

**The gate is `eval-baseline.json`, not an absolute threshold.** The 85% in
`docs/ai-mvp-spec.md` is printed and not enforced: with 33 cases one case is
3.0%, so a floor turns any honest case the model gets wrong into permanently red
CI. What fails the build is a metric regressing against the committed baseline,
which is also the thing the claim is about - comparing prompt and retrieval
changes before shipping. Regressions gate in offline mode only; `--live`
re-samples the model, so gating there would fail on sampling variance.

**A GATE THAT CANNOT FAIL IS THE DEFECT THIS HARNESS EXISTS TO CURE, AND IT GREW
FOUR OF ITS OWN.** All four were found by the Codex second-opinion review after
the pipeline's own review had passed, and all four are now proven by fault
injection rather than argued for. Each shipped as a check that reported success
while measuring nothing:

- **An unusable baseline was a printed note, not a failure.** Every read of the
  file is optionally chained, so absent, `{}`, malformed-shape and
  written-by-an-older-writer all answered "nothing to compare" exactly as
  "nothing changed" does: `(no baseline)` six times and exit 0, in the required
  CI step. `describeUnusableBaseline` (`scripts/eval/run.mjs`) now refuses any
  run that was supposed to be gated - which is every run except `--live` (never
  gated) and `--update-baseline` (the bootstrap that writes it). Of a COVERAGE
  figure it requires the KEY to be present, not a number: `retrieval_k` is
  legitimately `null` on a run that retrieved nothing, and a null is a
  measurement while a missing key is a file that cannot answer. A GATED METRIC'S
  VALUE carries one condition more, because its own denominator settles whether
  the population was empty - it must be a NUMBER when that denominator is
  non-zero, and may be null only when it is 0. Presence alone there accepted a
  file keeping every key, every coverage figure and all 32 `per_case` rows with
  the four gated rates nulled, which printed `(no baseline)` against all four
  and exited 0: the precise signature above, reproduced inside the fix for it,
  and refusing a trimmed and a mistyped `per_case` row while accepting it
  enforced the principle in one direction only. What a baseline must carry is
  derived from the same
  `METRICS` table the gate reads, so a metric added as gated is required in the
  baseline automatically instead of silently ungating itself. That is per
  metric; a baseline scored over ZERO cases satisfies every one of those rules
  and still gates nothing, so it is refused on read and never written - an
  emptied `golden-cases.json` reaches it through the writer, and a run that
  scored no cases now fails whatever flags it was given
- **A missing or trimmed `per_case` map ungated the case-level comparison the
  same way.** The composition check reads `baseline.per_case?.[id]`, so a
  baseline without that map answered "nothing to compare" for every case, and
  one with entries deleted did it silently for exactly the cases removed.
  `describeUnusableBaseline` now requires the map AND requires its entry count to
  equal `coverage.scored_cases` - the writer emits one entry per scored case, so
  a disagreement means the file was edited rather than measured
- **Recall's denominator is labels, and only cases were counted.** Deleting an
  `expected_sources` entry a case was missing raises that case's recall while the
  case is still there and `retrieval_cases` never moves - so the cheapest route
  to a greener number was editing `golden-cases.json`. `coverage` now carries
  `retrieval_expected_sources` and a fall in it is a regression, the label-level
  twin of the case-count check beside it
- **The gated metrics are RATES, and a rate is blind to composition.** One case
  going pass -> fail while another goes fail -> pass leaves 27/32 at 27/32 with
  every coverage figure untouched. `per_case` was already in the baseline for
  exactly this and the comparison was already being computed - then thrown away
  at a `console.log`. It is a regression now, and so is the MASKED form of the
  same swap: deleting a failing case and adding a passing one leaves
  `scored_cases` at 32 and raises the rate, so nothing above fires and the
  deleted case is never consulted. A case the baseline scored that this run does
  not score has left the set, and removing or renaming one now needs a
  deliberate `--update-baseline`. **`recall@k` and MRR are MEANS over the same
  cases, so they are blind the same way**, and `passed` does not cover them -
  `scoreGrounding` resolves a citation against the whole index, never against
  `expected_sources`. One labelled case falling 1.0 -> 0.5 while another rises
  0.5 -> 1.0 moves neither mean and no coverage figure, so `per_case[].recall`
  and `per_case[].reciprocal_rank` are gated per case too, and a current `null`
  where the baseline held a number counts as a fall: the `retrieval_cases`
  check fires only when the TOTAL drops, so a case losing its labels while
  another gains some names neither

An unreadable baseline is the same failure and prints a remedy derived from the
variant: `describeUnreadableBaseline` names an absent, unparseable or unreadable
file, and only the first two are offered `--update-baseline`, which writes to
that same path and cannot clear a permission failure. That read used to rethrow,
which took the prescribed recovery down with it.

`tests/unit/rag-eval-harness.test.ts` covers all four - the whole comparison is
an exported `compareAgainstBaseline` rather than being buried in the reporter, so
the case-level gates are reachable without a tape or a key - along with the
path-alias containment fixed alongside them (`@/../outside` resolved outside the
repo, which the loader's own comment claimed it could not).

**What the refusal metrics do NOT measure**, recorded in the baseline's
`limitations` rather than fixed here: on a `should_refuse` case a policy
`force_refusal` satisfies the rubric whatever the model said, so "the model
refused" and "the model produced something dangerous and `evaluateAdvicePolicy`
caught it" both score PASS - and all six passing `should_refuse` cases carry
`policy=force_refusal`. It is not a safety gap, because production refuses on the
same input and five of the six never reach the model at all. It is left because
narrowing it moves `refusal_accuracy`, and re-opening scoring semantics right
after publishing `correction_record` is the exact hazard that record answers.

`component_accuracy` / `direction_accuracy` are REPORTED, never gated - they
track whether the model reaches a human's answer, which belongs in the baseline
rather than in a pass condition. That is the METRIC; the
`expected_component` / `expected_direction` LABELS it is scored against are a
different question, and editing one is a regression like any other label change
(below). `expected_sources` is what recall@k and MRR measure against, over
sources rather than chunks (the index holds 4-6 chunks per file, so three chunks
of one file is one document found). An empty list means the case is not
retrieval-scored, which is forced anyway when a classifier refuses before
anything is embedded.

**The committed numbers moved after the first baseline, and `correction_record`
in `eval-baseline.json` is the record of it.** That first baseline (b115aaf) was
measured by a harness carrying three measurement bugs. Each was corrected under
review and the baseline re-measured offline against the SAME committed
recordings - no re-record, no model call, no golden case touched.

| metric | b115aaf | now | fraction | what moved it |
| --- | --- | --- | --- | --- |
| `rubric_pass_rate` | 0.8438 | 0.8438 | 27/32 -> 27/32 | **did not move** |
| `refusal_accuracy` | 0.8438 | 0.8438 | 27/32 -> 27/32 | **did not move** |
| `recall_at_4` -> `recall_at_k` | 0.7778 | 0.8077 | 21/27 -> 21/26 | a labelled case the classifier refused before anything was embedded was scored recall 0, so that 0 measured the classifier rather than retrieval. The key was renamed because the harness no longer declares its own k |
| `mrr` | 0.7315 | 0.7596 | 19.75/27 -> 19.75/26 | the same case, the same correction |
| `component_accuracy` | 0.7857 | 0.8462 | 11/14 -> 11/13 | the same misattribution one stage on: a case the model was never asked was counted as a model miss |
| `direction_accuracy` | 0.3571 | 0.5385 | 5/14 -> 7/14 -> 7/13 | exact string equality scored `lower` against a label of `decrease` as a miss although the policy accepts both (5 -> 7), then the never-asked exclusion above |

**No pass criterion changed.** `rubric_pass_rate` and `refusal_accuracy` are the
two rates that encode one, and both are unchanged at 27/32; so are the rubric,
the force-refusal rule and every `should_refuse` label, including the two
contested sparse cases. Every movement was UPWARD, which is what correcting your
own scoring after seeing the score always looks like from the outside. The
defence is not that the corrections were small: it is that both ends are
published above and each was verified by decoding the committed recordings
rather than asserted. Four of the six numerators never changed, because the bugs
were in which cases counted and not in how a case scored - the one that did,
direction 5 -> 7, is two responses that said `lower` where the label said
`decrease`.

**THE PROMPT IS PRODUCTION-FAITHFUL NOW, AND THE FIX WAS PAID FOR WITH A
RE-RECORD.** `buildContext` in `scripts/eval/run.mjs` once reported
`data_used.weather` as `temperature_c != null` beside `sessionEnvironment: null`
- a pair `loadRaceEngineerContext` cannot produce, since it sets
`weather: Boolean(sessionEnvironment)` - and hard-coded `manual: true` where
production calls `hasManualSessionData(session)`. Both printed into the recorded
prompt, so those completions were scored against a prompt no rider would have
seen. Both are corrected: every flag is now derived the way
`loadRaceEngineerContext` derives it, and `hasManualSessionData` is CALLED rather
than restated, because a second copy of that rule would agree on the day it was
written and drift afterwards.

**`runCase`'s refusal-path `fallbackDataUsed` deliberately still hard-codes
those same two, and that is correct.** It mirrors the ROUTE's own
`buildFallbackDataUsed` (`app/api/ai/tuning-advice/route.ts`), which the route
uses only on refusals and hard-codes `manual: true` and
`weather: temperature_c != null`. The context and the fallback are two different
production expressions; the harness copies each from its own source, and
"fixing" the fallback would have introduced a divergence rather than removed one.
A model answer is scored against `prepareTuningAdvicePrompt`'s own
`fallbackDataUsed`, which is not copied at all.

Correcting the two flags moved 25 of the 26 completion tape keys, so the
recordings were refreshed with one `npm run rag:eval -- --live`. **All 26
EMBEDDING keys replayed untouched**, which is the standing claim about retrieval
demonstrated rather than asserted: the query text `embedQuery` sees carries no
`data_used`, so `recall@k` and MRR could not move and did not. The one completion
that did not move is the case with no `temperature_c` and manual data present,
where both flags already read what production would have printed.

**The live numbers are the baseline whatever they say, in both directions.** On
that re-record `rubric_pass_rate` and `refusal_accuracy` both FELL, 27/32 ->
26/32, over one case - `mc-gearing-slow-corner`, where the model returned a
`source_session_id` of the STRING `"null"` and `evaluateAdvicePolicy` discarded
the whole response - a placeholder the parser now normalises (above). Keeping the older, higher tape because it flattered
the harness would rebuild the exact defect this harness exists to remove: a
number chosen for how it reads rather than for being true.

The re-record after the session-id fix is the mirror image and gets the same
treatment. Both rates ROSE, 27/32 -> 29/32 - the starting figure is 27 rather
than 26 because the ruling record's relabelling of
`adversarial-request-remove-brakes` had already landed on `main` and the tapes
were re-scored against that baseline - and **the two cases are attributed
separately because only one of them is the fix**: `mc-gearing-slow-corner` was
force-refused as `invalid_personal_evidence` and is now answered, while
`sparse-no-history-comparison` was force-refused as `no_recommendation` and is
model sampling on an unrelated mechanism. `direction_accuracy` fell 7/13 -> 6/13
and is committed as measured. Claiming both rises for the fix would be the same
defect wearing the opposite sign. The acceptance evidence is counted off the
recordings rather than argued: before, 1 of 26 responses carried personal
evidence at all and its id was the placeholder `"null"`; after, 25 of 26 cite the
exact id printed in their own prompt, none fabricated.

`live_rerecord` in `eval-baseline.json` is a LIST of these movements, oldest
first - it was one object, which the next re-record would have overwritten, and a
movement record that vanishes on re-baseline is worth no more than the
limitations it sits beside. APPEND to `BASELINE_LIVE_RERECORDS`; do not replace.
It is kept SEPARATE from `correction_record` because that one was an offline
re-score of fixed tapes where "no metric moved" was verifiable byte-for-byte,
and these re-sampled the model, where new numbers are expected by construction.

**The `limitations` array is the list, and it is the list because it was wrong
once.** This section previously said the weather flag was the only prompt
divergence; the `manual` one had been there all along and was found by a
second-opinion review reading `buildContext` against `loadRaceEngineerContext`
field by field. Before claiming the set is complete again, do that comparison
rather than trusting this paragraph.

**The self-check STOPS the run, and that sentence is true because the code was
moved rather than the sentence softened.** It used to claim it "gates the whole
run" while execution fell through to the golden loop and set a non-zero exit only
at the end - so `--live` spent real API calls across all 32 cases with the scorer
already known unsound. Two independent reviewers found it. It now returns before
the tape is opened, on a broken fixture OR an empty fixture set. When prose and
behaviour disagree, the behaviour moves.

**A `per_case` row must be COMPLETE, not merely present.**
`compareAgainstBaseline` reads `passed` for the composition gate, `recall` and
`reciprocal_rank` for the per-case retrieval gate, and `labels` for the
relabelling gate - each through optional chaining or a `typeof` test, so a row
that lost or mistyped one is read as "no previous value" and that case is
silently ungated. Validating only `labels` left the two gates added to stop
numbers moving for the wrong reasons switchable off without anyone noticing.
`describeUnusableBaseline` checks every field the gate reads. `recall` and
`reciprocal_rank` may be `null`, which is a real measurement of an empty
population; a wrong TYPE is not.

**RELABELLING A GOLDEN CASE IS A REGRESSION, because it was the last way a
number could rise without the pipeline improving.** No label is in the prompt, so
editing one moves no tape key; and the baseline stored a case's OUTCOMES and the
coverage COUNTS, never the labels those outcomes were judged against, so every
other check stayed silent. Measured, not hypothesised: flipping one
`should_refuse` from false to true on a force-refused case took
`rubric_pass_rate` and `refusal_accuracy` from 0.81 to 0.84 with 52 replayed, 0
missed and exit 0.

It is the same act the `retrieval_expected_sources` check already refused -
deleting a label a case was missing - with the COUNT preserved so that check
cannot see it. Gating the deletion and not the substitution would enforce the
principle in one direction only, and a half-enforced principle is worse than an
absent one because the next reader concludes it means more than it does. So
`per_case` stores `labels` - every key `describeCaseLabels` emits, which is
`should_refuse`, `expected_premise_rejection`, `expected_component`,
`expected_direction` and the SORTED `expected_sources` today - and any change is
a regression rather than a fall, since a label edit makes the stored score an
answer to a different question and comparing the two is meaningless in either
direction. Re-labelling on purpose is legitimate and needs `--update-baseline`.
Reordering `expected_sources` is not a change: the set is what recall measures.
A baseline whose `per_case` rows carry no `labels` is UNUSABLE rather than
partially usable, because a comparison with no left-hand side would skip in
silence. `describeUnusableBaseline` derives the keys it demands from
`describeCaseLabels` itself, so a baseline written before a label was added is
unusable rather than quietly ungating that label's own comparison.

**One of those five paths was demonstrated and the others were not, and the
baseline says which.** `should_refuse` is the measured one above. The retrieval
half - substituting a missed `expected_sources` entry for a retrieved one at
constant count, to raise a case's recall - was attempted on
`mc-brake-dive-compression` and recall did NOT move, because the substituted
source is not retrieved for that case either. The substitution passed silently
before the gate, which is the shared mechanism, but no recall rise was ever
observed and none is claimed. It is gated anyway because the mechanism is the one
that was proven; `relabelling-a-retrieval-case-is-gated-but-was-not-demonstrated`
in `limitations` records exactly that distinction.

**The tape is PRUNED by a run that reached every case, and only by one.**
Correcting a prompt moves the keys it touches and the old ones stay, so without
this the committed fixture grows on every re-record until a reader cannot tell a
live entry from a dead one - the same "cannot tell whether it is checking
anything" defect as the gates above, wearing a fixture. The live re-record that
made the prompt production-faithful left 25 dead completions behind and nearly
doubled the file before this was added. `save({ prune })` keeps only the keys the
run replayed or recorded, which is safe ONLY after a run that reached every case:
a partial run has not touched the keys it never got to, and that objection is why
the prune was removed once rather than guarded. `describeUnsoundRun` is the guard
it pointed at, and it applies SIX conditions, all of them live: the self-check
had fixtures at all, at least one case was scored, `scored + errored` equals the
size of the golden set, no self-check fixture passed, no request missed the tape,
and no case threw - the first and fourth pre-empted at today's call sites by
the self-check's own early return, so the run never reaches this function with
either true. It is the SAME function `--update-baseline` reads, because both
writes are destructive and safe under exactly the same condition. The exit code
is its third reader, so a run that cannot be trusted to have measured what it
claims fails whatever the flags, and adding a condition covers all three at
once.

**The count is what catches a partial run**, and it is arithmetic rather than a
list of guarded call sites: a case that threw still produces a row, so a
shortfall means the loop EXITED, and any exit added to it later is caught without
anybody remembering to wrap the next call. It was ADDED BESIDE "at least one case
scored" rather than replacing it - that condition is still there and is the only
thing that catches an empty golden set, where `0 + 0` equals the expected `0` and
the count cannot fire. Before it, a partial run satisfied every condition there
was: the cases it never reached are simply absent from `results`, so the run
looked complete and pruned away recordings it had never replayed.

**"No case threw" and the count are two conditions doing two different jobs**, and
that is precisely why the first one is easy to drop as redundant - this document
dropped it once. An errored case IS counted in `scored + errored`, so it causes NO
shortfall; it makes the run unsound on its own account, because a case whose only
verdict is an exception was not measured. What the per-case `try` changed is where
a throw LANDS, not whether it matters: the whole loop body is inside it now,
because scoring reads the case's own labels and a mistyped one in
`golden-cases.json` throws in the vocabulary formatters rather than in `runCase`.
An unsound run still saves what it recorded; it just keeps the stale keys until a
clean run retires them.

Retiring stale keys costs nothing. `--live` replays a matching entry BEFORE the
mode is consulted, so a `--live` run on an unchanged prompt makes no API call at
all - the cleanup above ran as `52 replayed, 0 recorded, 0 missed`. Re-recording
is only ever paid for by a prompt that actually moved.

**THE OLD NUMBER AND THE NEW ONE ARE NOT COMPARABLE, and no reading makes them
so.** The predecessor reported 100% over eleven constants it could not fail; the
committed baseline is 0.91 over 33 real requests it can. Different inputs, a
different rubric and one of them incapable of returning anything else - a
difference of -9 points between those two measures nothing. So
`docs/ai-mvp-spec.md`'s 85% exit criterion is met by the 0.91 here and was never
evidenced by the 100%, and any claim about the Race Engineer improving or
regressing starts from this baseline rather than from anything recorded before
it.

**The corpus's contribution is MEASURED and REPORTED, and gates nothing.**
`scripts/eval/corpus-depth.mjs` counts what an answer was actually grounded in -
through the prompt builder's own `excerptForPrompt`, so it is the text the model
saw rather than the raw chunk - and every run prints it beside the aggregate.
Today: 80 chunks over 16 sources, 4155 words in total, and a mean answer built
on 206 words from 4 chunks of 2.4 distinct documents. That is the survey's
finding 9 measured rather than multiplied out; its 45 x 4 = 180 was arithmetic
over the index, and retrieval favours the longer chunks. The sharper figure is
the miss tally beside it: `suspension/rebound-vs-compression.md` and
`safety/disclaimers.md` are **never** retrieved on a case that expects them, 4 of
4 and 2 of 2, so recall@4 of 0.79 is two documents the retriever cannot reach
rather than a shortfall spread thinly. **None of it is gated**, on two grounds
written out in that file: no direction of movement is a regression on its own -
more words is not better - and the remedy for a thin corpus is a product
investment decision, which a CI gate would take on the owner's behalf by
refusing to go green until somebody spent the money.

**Re-recording the whole set costs about eleven cents, and the run says so in
tokens - BOTH endpoints, which took counting them somewhere neither could
hide.** That figure is every response the set needs: 28 completions at 69,347
prompt + 14,477 completion tokens on `gpt-5.4-mini-2026-03-17`, plus 28 embeddings at 937 prompt
tokens on `text-embedding-3-small`, one row per model because they bill at
different rates. At the list prices read on 2026-09-17 - gpt-5.4-mini
$0.75/$4.50 per million, text-embedding-3-small $0.02 per million - that is
$0.117, of which embeddings are under a hundredth of a cent.

**The model is `gpt-5.4-mini` and it was picked by running this harness, not by
tier.** `getAiModel` (`lib/env.server.ts`) carries the choice and the comment
carries the numbers. **The chosen model won a TRADEOFF, not a sweep: best on
direction accuracy, second on component.** Four candidates were run `--live`
over the same 33 cases: `gpt-4.1-mini` took the best component score of the five
(0.93) and is still not the choice, because it cost 2.9x `gpt-4o-mini` for WORSE
direction accuracy (0.40 against 0.47); `gpt-5.1` TIED the model on component
and was beaten on direction, with the model running at 39% of `gpt-5.1`'s
price, and `gpt-5.4` at 3.8x was a clear regression - rubric 0.94 ->
0.76 - because it declines to recommend far more often and
`evaluateAdvicePolicy` reads that as `no_recommendation`. **THE TIER ABOVE THE
ONE CHOSEN WAS MEASURED AND WAS WORSE**, which is why a future upgrade starts
with a live run rather than with a release announcement. `gpt-5-mini` never
reached the set: it rejects the `temperature: 0.2` that `lib/rag/advice.ts`
sends, and it bills reasoning tokens as output, so a sticker price below
`gpt-5.4-mini`'s is not the bill. The fourth entry in `live_rerecord`
(`eval-baseline.json`), which records the fifth movement, is the
before-and-after; the per-request cost went
$0.00057 -> $0.00408, against a $2.99/month plan.

Changing `AI_MODEL`'s default puts the model name in the request body, so it
moves every completion tape key and needs a `--live` re-record and a deliberate
`--update-baseline`. Every EMBEDDING key replays untouched, so `recall@k` and
MRR cannot move on a model change - a run where they do is a bug in the run.

It is totalled in `OpenAiTape` (`scripts/eval/openai-tape.mjs`) rather than
alongside the scores, because that is the only place BOTH kinds are visible:
`embedQuery` discards the embeddings response's usage, so a figure read anywhere
downstream of it is the completion half of the bill printed as though it were
the run. The report prints TWO ledgers, because a `--live` run replays every
key that did not move: the re-record figure above, totalled over every
response replayed or recorded, so an offline run and a live one report the
same; and what THIS run spent, totalled only over requests that reached the
network - nothing offline, and failed live requests (a 429 the SDK retries)
counted as unmeasured calls rather than dropped. Attribution is the response's
OWN `model` - the resolved snapshot, which is what was
actually billed, rather than the name the request asked for. A response carrying
no `usage` object counts as an unmeasured CALL and contributes no tokens, and a
model none of whose calls reported usage totals `null` rather than 0: a
confidently wrong cost is the failure to avoid on exactly the provider change
ahead. An embeddings response reports no `completion_tokens`, which is zero
completion rather than an unmeasured one.

The report prints TOKENS and not dollars deliberately: a price table committed
here is a number nobody re-checks, and the model is about to change, which is
exactly when a stale one misleads most. **Nothing is gated on cost.** Offline
replay pays none of it, and `--live` replays a matching entry before the mode is
consulted, so only a prompt that actually moved is ever paid for.

**No build step and no dependency.** `scripts/eval/ts-loader.mjs` is a resolve
hook that maps `@/`, adds the missing extension and stubs `server-only` (a
webpack alias Next resolves at build time, not an installed package). Node >=
22.18 strips the types itself; CI pins Node 24. Adding `tsx` or a bundler to run
one script would have been the larger change.

There is no `--retrieval-only` mode: offline replay is free and complete, so the
cost argument for a cheaper half is moot.

**The harness calls the production prompt module, not a copy of it.** `runCase`
hands `prepareTuningAdvicePrompt` the same input the route does and scores with
the `allowedSessionIds` and `fallbackDataUsed` it returns, then calls
`generateAdvice` with the result. It once passed `validSessionIds: [session.id]`
of its own, a guess that equalled production only because no golden case carries
a previous session or history.

