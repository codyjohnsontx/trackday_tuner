'use client';

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { type OAuthProvider, type OAuthProviderConfig } from '@/lib/auth/providers';
import { createClient } from '@/lib/supabase/client';

type AuthMode = 'sign-in' | 'sign-up' | 'reset';

interface AuthFormProps {
  providers: OAuthProviderConfig[];
  inviteOnly?: boolean;
  /** Message from a redirect that landed here, e.g. an expired email link. */
  initialError?: string;
}

export function AuthForm({ providers: oauthProviders, inviteOnly = false, initialError = '' }: AuthFormProps) {
  const router = useRouter();
  const [mode, setMode] = useState<AuthMode>('sign-in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [errorMessage, setErrorMessage] = useState(initialError);
  const [infoMessage, setInfoMessage] = useState('');
  const [loading, setLoading] = useState(false);

  function switchMode(next: AuthMode) {
    setMode(next);
    setErrorMessage('');
    setInfoMessage('');
  }

  async function handleOAuthSignIn(provider: OAuthProvider) {
    setLoading(true);
    setErrorMessage('');
    setInfoMessage('');

    const supabase = createClient();
    const redirectTo = `${window.location.origin}/auth/callback?next=/dashboard`;
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo },
    });

    if (error) {
      setErrorMessage(error.message);
      setLoading(false);
      return;
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setErrorMessage('');
    setInfoMessage('');

    if (mode === 'reset') {
      const supabase = createClient();
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/auth/callback?next=/reset-password`,
      });

      // Deliberately the same answer whether or not that address has an account:
      // the reply to this form must not be a way to find out who has one.
      if (error) {
        setErrorMessage(error.message);
      } else {
        setInfoMessage(`If ${email} has an account, a reset link is on its way. It expires in an hour.`);
      }

      setLoading(false);
      return;
    }

    if (mode === 'sign-in') {
      const supabase = createClient();
      const { error } = await supabase.auth.signInWithPassword({ email, password });

      if (error) {
        setErrorMessage(error.message);
        setLoading(false);
        return;
      }

      router.replace('/dashboard');
      router.refresh();
      return;
    }

    if (inviteOnly) {
      try {
        const response = await fetch('/api/beta/signup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password, invite_code: inviteCode }),
        });
        const result = await response.json() as { ok: boolean; error?: string };
        if (!response.ok || !result.ok) {
          setErrorMessage(result.error ?? 'Unable to create your account.');
          return;
        }

        const supabase = createClient();
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) {
          setInfoMessage('Account created. Sign in with your email and password.');
          setMode('sign-in');
          return;
        }
        router.replace('/dashboard');
        router.refresh();
      } catch {
        setErrorMessage('Unable to create your account right now. Please try again.');
      } finally {
        setLoading(false);
      }
      return;
    }

    const supabase = createClient();

    const { data, error } = await supabase.auth.signUp({ email, password });

    if (error) {
      setErrorMessage(error.message);
      setLoading(false);
      return;
    }

    if (data.session) {
      router.replace('/dashboard');
      router.refresh();
      return;
    }

    setInfoMessage('Account created. Check your email for confirmation, then sign in.');
    setLoading(false);
  }

  const isReset = mode === 'reset';

  return (
    <section className="space-y-4 rounded-card bg-surface p-4">
      {isReset ? (
        <div className="space-y-1">
          <h2 className="text-lg font-semibold text-ink">Reset your password</h2>
          <p className="text-sm text-ink-dim">
            Enter the email you signed up with and we will send you a link to set a new password.
          </p>
        </div>
      ) : null}

      {!inviteOnly && !isReset ? <div className="space-y-2">
        {oauthProviders.map((provider) => (
          <div key={provider.id} className="space-y-1">
            <Button
              type="button"
              variant="secondary"
              className="min-h-12 w-full"
              onClick={() => handleOAuthSignIn(provider.id)}
              disabled={!provider.enabled || loading}
              aria-disabled={!provider.enabled || loading}
            >
              {`Continue with ${provider.label}`}
            </Button>
            {!provider.enabled ? (
              <p className="text-xs text-ink-dim">{provider.label} sign-in is not configured in this environment.</p>
            ) : null}
          </div>
        ))}
      </div> : null}

      {!inviteOnly && !isReset ? <div className="flex items-center gap-2">
        <span className="h-px flex-1 bg-surface-3" />
        <span className="text-xs uppercase tracking-wide text-ink-dim">or</span>
        <span className="h-px flex-1 bg-surface-3" />
      </div> : null}

      {!isReset ? (
        <div className="grid grid-cols-2 gap-2 rounded-row bg-surface-2 p-1">
          <Button
            variant={mode === 'sign-in' ? 'primary' : 'secondary'}
            className="min-h-11"
            onClick={() => switchMode('sign-in')}
          >
            Sign In
          </Button>
          <Button
            variant={mode === 'sign-up' ? 'primary' : 'secondary'}
            className="min-h-11"
            onClick={() => switchMode('sign-up')}
          >
            Sign Up
          </Button>
        </div>
      ) : null}

      <form className="space-y-3" onSubmit={handleSubmit}>
        <Input
          label="Email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="you@tracktuner.app"
          required
        />
        {mode === 'sign-up' && inviteOnly ? (
          <Input
            label="Invitation code"
            value={inviteCode}
            onChange={(event) => setInviteCode(event.target.value)}
            autoComplete="one-time-code"
            placeholder="Your beta invitation code"
            required
          />
        ) : null}
        {!isReset ? (
          <Input
            label="Password"
            type="password"
            autoComplete={mode === 'sign-in' ? 'current-password' : 'new-password'}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="At least 8 characters"
            minLength={8}
            required
          />
        ) : null}

        <Button type="submit" fullWidth loading={loading}>
          {isReset ? 'Send Reset Link' : mode === 'sign-in' ? 'Sign In' : 'Create Account'}
        </Button>
      </form>

      {mode === 'sign-in' ? (
        <Button variant="ghost" size="sm" fullWidth onClick={() => switchMode('reset')}>
          Forgot your password?
        </Button>
      ) : null}

      {isReset ? (
        <Button variant="ghost" size="sm" fullWidth onClick={() => switchMode('sign-in')}>
          Back to sign in
        </Button>
      ) : null}

      {errorMessage ? <p className="text-sm text-slower">{errorMessage}</p> : null}
      {infoMessage ? <p className="text-sm text-faster">{infoMessage}</p> : null}
      {inviteOnly && mode === 'sign-up' ? (
        <p className="text-xs text-ink-faint">No invitation yet? Join the waitlist from the home page.</p>
      ) : null}
    </section>
  );
}
