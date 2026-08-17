'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SagSection, type SagSectionValues } from '@/components/sag/sag-section';
import { SagHistoryList } from '@/components/sag/sag-history-list';
import { createSagEntry, deleteSagEntry } from '@/lib/actions/sag';
import { clearDraft, loadDraft, saveDraft } from '@/lib/drafts';
import { parseMeasurement } from '@/lib/sag';
import { PageHeader } from '@/components/ui/page-header';
import type { SagEntry } from '@/types';

interface SagCalculatorProps {
  initialEntries: SagEntry[];
}

const emptySide: SagSectionValues = {
  l0: '',
  l1: '',
  l2: '',
};

/**
 * Everything loading an entry would overwrite, as one comparable value.
 *
 * The label and the notes belong in here with the measurements: `loadEntry`
 * replaces all four, so leaving the two text fields out meant a rider who had
 * retitled an entry or written a note - and touched nothing else - counted as
 * having no unsaved work, and the next tap discarded it without asking.
 */
function formStateKey(
  front: SagSectionValues,
  rear: SagSectionValues,
  label: string,
  notes: string,
): string {
  return [front.l0, front.l1, front.l2, rear.l0, rear.l1, rear.l2, label, notes]
    .map((value) => value.trim())
    .join('|');
}

const EMPTY_FORM_STATE_KEY = formStateKey(emptySide, emptySide, '', '');

export function SagCalculator({ initialEntries }: SagCalculatorProps) {
  const draftKey = 'sag_calculator';
  const [entries, setEntries] = useState<SagEntry[]>(initialEntries);
  const [selectedId, setSelectedIdState] = useState<string | null>(null);
  // What the form held the last time it was saved or loaded. Anything else on
  // screen is work a tap on the history list would destroy.
  const [committedKey, setCommittedKey] = useState(EMPTY_FORM_STATE_KEY);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  // Read across the await in removeEntry. The transition closure captures the
  // selection from the render that made it, so a rider who taps another entry
  // while a delete is in flight would otherwise have that entry deselected and
  // its freshly loaded measurements counted as unsaved work.
  const selectedIdRef = useRef<string | null>(null);

  /** Keeps the ref and the state in step, so neither can answer for the other. */
  function setSelectedId(next: string | null) {
    selectedIdRef.current = next;
    setSelectedIdState(next);
  }
  const [historyError, setHistoryError] = useState('');

  const [front, setFront] = useState<SagSectionValues>(emptySide);
  const [rear, setRear] = useState<SagSectionValues>(emptySide);
  const [label, setLabel] = useState('');
  const [notes, setNotes] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [draftMessage, setDraftMessage] = useState('');
  const [isPending, startTransition] = useTransition();
  // Separate from the save transition so deleting an entry does not relabel the
  // Save button "Saving...".
  const [, startHistoryTransition] = useTransition();

  useEffect(() => {
    const draft = loadDraft<{
      front: SagSectionValues;
      rear: SagSectionValues;
      label: string;
      notes: string;
    }>(draftKey);
    if (!draft) return;

    setFront(draft.front ?? emptySide);
    setRear(draft.rear ?? emptySide);
    setLabel(draft.label ?? '');
    setNotes(draft.notes ?? '');
    setDraftMessage('Draft restored from this device.');
  }, []);

  useEffect(() => {
    saveDraft(draftKey, { front, rear, label, notes });
  }, [front, rear, label, notes]);

  function resetAll() {
    setFront(emptySide);
    setRear(emptySide);
    setLabel('');
    setNotes('');
    setSelectedId(null);
    setCommittedKey(EMPTY_FORM_STATE_KEY);
    setErrorMessage('');
    setSuccessMessage('');
    setDraftMessage('');
    clearDraft(draftKey);
  }

  function loadEntry(entry: SagEntry) {
    const loadedFront = {
      l0: entry.front_l0?.toString() ?? '',
      l1: entry.front_l1?.toString() ?? '',
      l2: entry.front_l2?.toString() ?? '',
    };
    const loadedRear = {
      l0: entry.rear_l0?.toString() ?? '',
      l1: entry.rear_l1?.toString() ?? '',
      l2: entry.rear_l2?.toString() ?? '',
    };

    setSelectedId(entry.id);
    setFront(loadedFront);
    setRear(loadedRear);
    setCommittedKey(formStateKey(loadedFront, loadedRear, entry.label ?? '', entry.notes ?? ''));
    setLabel(entry.label ?? '');
    setNotes(entry.notes ?? '');
    setErrorMessage('');
    setHistoryError('');
    setSuccessMessage('Loaded saved entry.');
  }

  function removeEntry(entry: SagEntry) {
    setHistoryError('');
    setDeletingId(entry.id);
    startHistoryTransition(async () => {
      const result = await deleteSagEntry(entry.id);
      setDeletingId(null);
      if (!result.ok) {
        setHistoryError(result.error);
        return;
      }

      setEntries((previous) => previous.filter((item) => item.id !== entry.id));
      // The measurements stay on screen; only the saved row is gone, so the form
      // is no longer a copy of anything and is now the last of them. Nothing is
      // committed any more, which is what makes loading over them ask first.
      if (selectedIdRef.current === entry.id) {
        setSelectedId(null);
        setCommittedKey(EMPTY_FORM_STATE_KEY);
      }
    });
  }

  function handleSave(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage('');
    setSuccessMessage('');

    startTransition(async () => {
      const result = await createSagEntry({
        label,
        notes,
        front_l0: parseMeasurement(front.l0),
        front_l1: parseMeasurement(front.l1),
        front_l2: parseMeasurement(front.l2),
        rear_l0: parseMeasurement(rear.l0),
        rear_l1: parseMeasurement(rear.l1),
        rear_l2: parseMeasurement(rear.l2),
      });

      if (!result.ok) {
        setErrorMessage(result.error);
        return;
      }

      setEntries((prev) => [result.data, ...prev]);
      setSelectedId(result.data.id);
      setCommittedKey(formStateKey(front, rear, label, notes));
      setSuccessMessage('Sag entry saved.');
    });
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Sag"
        muted="Calculator"
        sub="Enter measurements in millimeters. Results update instantly as you type."
      />

      <SagSection title="Front" values={front} onChange={setFront} />
      <SagSection title="Rear" values={rear} onChange={setRear} />

      <section className="space-y-3 rounded-card bg-surface p-4">
        <h2 className="text-base font-semibold text-ink">Save Entry</h2>

        <form className="space-y-3" onSubmit={handleSave}>
          <Input
            label="Label (optional)"
            type="text"
            placeholder="e.g. Baseline, New Springs"
            value={label}
            onChange={(event) => setLabel(event.target.value)}
          />

          <label className="block space-y-2">
            <span className="text-sm font-medium text-ink">Notes (optional)</span>
            <textarea
              className="w-full rounded-row bg-surface-2 px-4 py-3 text-base text-ink placeholder:text-ink-faint"
              rows={3}
              placeholder="Track temp, tire setup, spring preload notes..."
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
            />
          </label>

          {errorMessage ? <p className="text-sm text-slower">{errorMessage}</p> : null}
          {successMessage ? <p className="text-sm text-faster">{successMessage}</p> : null}
          {draftMessage ? <p className="text-sm text-faster">{draftMessage}</p> : null}

          <div className="grid grid-cols-2 gap-2">
            <Button type="submit" fullWidth disabled={isPending}>
              {isPending ? 'Saving...' : 'Save'}
            </Button>
            <Button type="button" variant="secondary" fullWidth onClick={resetAll}>
              Reset
            </Button>
          </div>
        </form>
      </section>

      <SagHistoryList
        entries={entries}
        selectedId={selectedId}
        hasUnsavedWork={formStateKey(front, rear, label, notes) !== committedKey}
        onSelect={loadEntry}
        onDelete={removeEntry}
        deletingId={deletingId}
        errorMessage={historyError}
      />
    </div>
  );
}
