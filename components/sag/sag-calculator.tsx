'use client';

import { useEffect, useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SagSection, type SagSectionValues } from '@/components/sag/sag-section';
import { SagHistoryList } from '@/components/sag/sag-history-list';
import { createSagEntry } from '@/lib/actions/sag';
import { clearDraft, loadDraft, saveDraft } from '@/lib/drafts';
import { parseMeasurement } from '@/lib/sag';
import type { SagEntry } from '@/types';

interface SagCalculatorProps {
  initialEntries: SagEntry[];
}

const emptySide: SagSectionValues = {
  l0: '',
  l1: '',
  l2: '',
};

export function SagCalculator({ initialEntries }: SagCalculatorProps) {
  const draftKey = 'sag_calculator';
  const [entries, setEntries] = useState<SagEntry[]>(initialEntries);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [front, setFront] = useState<SagSectionValues>(emptySide);
  const [rear, setRear] = useState<SagSectionValues>(emptySide);
  const [label, setLabel] = useState('');
  const [notes, setNotes] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [draftMessage, setDraftMessage] = useState('');
  const [isPending, startTransition] = useTransition();

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
    setErrorMessage('');
    setSuccessMessage('');
    setDraftMessage('');
    clearDraft(draftKey);
  }

  function loadEntry(entry: SagEntry) {
    setSelectedId(entry.id);
    setFront({
      l0: entry.front_l0?.toString() ?? '',
      l1: entry.front_l1?.toString() ?? '',
      l2: entry.front_l2?.toString() ?? '',
    });
    setRear({
      l0: entry.rear_l0?.toString() ?? '',
      l1: entry.rear_l1?.toString() ?? '',
      l2: entry.rear_l2?.toString() ?? '',
    });
    setLabel(entry.label ?? '');
    setNotes(entry.notes ?? '');
    setErrorMessage('');
    setSuccessMessage('Loaded saved entry.');
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
      setSuccessMessage('Sag entry saved.');
    });
  }

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
        <h1 className="text-2xl font-bold text-zinc-100">Sag Calculator</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Enter measurements in millimeters. Results update instantly as you type.
        </p>
      </section>

      <SagSection title="Front" values={front} onChange={setFront} />
      <SagSection title="Rear" values={rear} onChange={setRear} />

      <section className="space-y-3 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
        <h2 className="text-base font-semibold text-zinc-100">Save Entry</h2>

        <form className="space-y-3" onSubmit={handleSave}>
          <Input
            label="Label (optional)"
            type="text"
            placeholder="e.g. Baseline, New Springs"
            value={label}
            onChange={(event) => setLabel(event.target.value)}
          />

          <label className="block space-y-2">
            <span className="text-sm font-medium text-zinc-200">Notes (optional)</span>
            <textarea
              className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-3 text-base text-zinc-100 placeholder:text-zinc-500"
              rows={3}
              placeholder="Track temp, tire setup, spring preload notes..."
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
            />
          </label>

          {errorMessage ? <p className="text-sm text-rose-300">{errorMessage}</p> : null}
          {successMessage ? <p className="text-sm text-emerald-300">{successMessage}</p> : null}
          {draftMessage ? <p className="text-sm text-emerald-300">{draftMessage}</p> : null}

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

      <SagHistoryList entries={entries} selectedId={selectedId} onSelect={loadEntry} />
    </div>
  );
}
