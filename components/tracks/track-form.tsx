'use client';

import { FormEvent, useEffect, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { createTrack, updateTrack } from '@/lib/actions/tracks';
import { clearDraft, loadDraft, saveDraft } from '@/lib/drafts';
import type { Track } from '@/types';

interface TrackFormProps {
  initialTrack?: Pick<Track, 'id' | 'name' | 'location'>;
  onSuccessPath?: string;
}

export function TrackForm({ initialTrack, onSuccessPath = '/tracks' }: TrackFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const isEditing = Boolean(initialTrack);
  const draftKey = useMemo(
    () => `track_form_${initialTrack?.id ?? 'new'}`,
    [initialTrack?.id]
  );
  const [name, setName] = useState(initialTrack?.name ?? '');
  const [location, setLocation] = useState(initialTrack?.location ?? '');
  const [errorMessage, setErrorMessage] = useState('');
  const [draftMessage, setDraftMessage] = useState('');

  useEffect(() => {
    const draft = loadDraft<{ name: string; location: string }>(draftKey);
    if (!draft) return;

    setName(draft.name ?? '');
    setLocation(draft.location ?? '');
    setDraftMessage('Draft restored from this device.');
  }, [draftKey]);

  useEffect(() => {
    saveDraft(draftKey, { name, location });
  }, [draftKey, name, location]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage('');

    startTransition(async () => {
      const result = isEditing
        ? await updateTrack(initialTrack!.id, { name, location })
        : await createTrack({ name, location });

      if (!result.ok) {
        setErrorMessage(result.error);
        return;
      }

      if (!isEditing) {
        setName('');
        setLocation('');
      }

      clearDraft(draftKey);
      router.push(onSuccessPath as never);
      router.refresh();
    });
  }

  return (
    <form className="space-y-3" onSubmit={handleSubmit}>
      <Input
        label="Track name"
        type="text"
        placeholder="e.g. Circuit of the Americas"
        value={name}
        onChange={(event) => setName(event.target.value)}
        required
      />
      <Input
        label="Location (optional)"
        type="text"
        placeholder="e.g. Austin, TX"
        value={location}
        onChange={(event) => setLocation(event.target.value)}
      />

      {errorMessage ? <p className="text-sm text-rose-300">{errorMessage}</p> : null}
      {draftMessage ? <p className="text-sm text-emerald-300">{draftMessage}</p> : null}

      <Button type="submit" fullWidth disabled={isPending}>
        {isPending ? 'Saving...' : isEditing ? 'Save Track' : 'Add Track'}
      </Button>
    </form>
  );
}
