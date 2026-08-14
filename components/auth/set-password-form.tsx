'use client';

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/surface';
import { createClient } from '@/lib/supabase/client';

const MIN_PASSWORD_LENGTH = 8;

export function SetPasswordForm() {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [loading, setLoading] = useState(false);

  // Checked on submit rather than on every keystroke: a mismatch warning that
  // appears while the second field is still being typed is always wrong at first.
  const mismatch = confirmation.length > 0 && password !== confirmation;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage('');

    if (password !== confirmation) {
      setErrorMessage('Those two passwords do not match.');
      return;
    }

    setLoading(true);

    const supabase = createClient();
    try {
      const { error } = await supabase.auth.updateUser({ password });

      if (error) {
        setErrorMessage(error.message);
        return;
      }

      router.replace('/dashboard');
      router.refresh();
    } catch {
      setErrorMessage('Could not reach the server to save your password. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card className="p-4">
      <form className="space-y-3" onSubmit={handleSubmit}>
        <Input
          label="New password"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
          minLength={MIN_PASSWORD_LENGTH}
          required
        />
        <Input
          label="Confirm new password"
          type="password"
          autoComplete="new-password"
          value={confirmation}
          onChange={(event) => setConfirmation(event.target.value)}
          placeholder="Type it again"
          minLength={MIN_PASSWORD_LENGTH}
          error={mismatch ? 'Those two passwords do not match.' : undefined}
          required
        />

        <Button type="submit" fullWidth loading={loading}>
          Save New Password
        </Button>

        {errorMessage ? <p className="text-sm text-slower">{errorMessage}</p> : null}
      </form>
    </Card>
  );
}
