'use client';

import { FormEvent, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { createTrack } from '@/lib/actions/tracks';

export function TrackForm() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [name, setName] = useState('');
  const [location, setLocation] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage('');

    startTransition(async () => {
      const result = await createTrack({ name, location });

      if (!result.ok) {
        setErrorMessage(result.error);
        return;
      }

      setName('');
      setLocation('');
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

      <Button type="submit" fullWidth disabled={isPending}>
        {isPending ? 'Saving...' : 'Add Track'}
      </Button>
    </form>
  );
}
