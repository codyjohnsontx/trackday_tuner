'use client';

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/surface';
import { createClient } from '@/lib/supabase/client';

const MIN_PASSWORD_LENGTH = 8;

const NETWORK_ERROR_MESSAGE =
  'Could not reach the server to save your password. Check your connection and try again.';

export function SetPasswordForm() {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [messageKey, setMessageKey] = useState(0);
  const [loading, setLoading] = useState(false);

  function showError(text: string) {
    setErrorMessage(text);
    setMessageKey((key) => key + 1);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage('');

    // Checked on submit rather than on every keystroke: a mismatch warning that
    // appears while the second field is still being typed is always wrong at first.
    if (password !== confirmation) {
      showError('Those two passwords do not match.');
      return;
    }

    setLoading(true);

    const supabase = createClient();
    try {
      const { error } = await supabase.auth.updateUser({ password });

      if (error) {
        console.error('[set-password-form] password update failed', error);
        // A dropped request comes back as a result rather than a rejection, carrying
        // the browser's own "Failed to fetch", which is not something a rider can act
        // on. It is also the only auth error here that is not about the password, so
        // it is the only one replaced: "New password should be different from the old
        // password" and its kind are exactly what they need to read.
        // `isAuthRetryableFetchError` is this same check, but it is not re-exported by
        // @supabase/supabase-js and @supabase/auth-js is not a dependency of this app.
        showError(error.name === 'AuthRetryableFetchError' ? NETWORK_ERROR_MESSAGE : error.message);
        setLoading(false);
        return;
      }

      router.replace('/dashboard');
      router.refresh();
    } catch {
      showError(NETWORK_ERROR_MESSAGE);
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
          onChange={(event) => {
            setPassword(event.target.value);
            setErrorMessage('');
          }}
          placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
          minLength={MIN_PASSWORD_LENGTH}
          required
        />
        <Input
          label="Confirm new password"
          type="password"
          autoComplete="new-password"
          value={confirmation}
          onChange={(event) => {
            setConfirmation(event.target.value);
            setErrorMessage('');
          }}
          placeholder="Type it again"
          minLength={MIN_PASSWORD_LENGTH}
          required
        />

        <Button type="submit" fullWidth loading={loading}>
          Save New Password
        </Button>

        {errorMessage ? (
          <p key={messageKey} role="alert" className="text-sm text-slower">
            {errorMessage}
          </p>
        ) : null}
      </form>
    </Card>
  );
}
