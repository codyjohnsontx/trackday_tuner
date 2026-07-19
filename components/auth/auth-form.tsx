'use client';

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { type OAuthProvider, type OAuthProviderConfig } from '@/lib/auth/providers';
import { createClient } from '@/lib/supabase/client';

type AuthMode = 'sign-in' | 'sign-up';

interface AuthFormProps {
  providers: OAuthProviderConfig[];
  inviteOnly?: boolean;
}

export function AuthForm({ providers: oauthProviders, inviteOnly = false }: AuthFormProps) {
  const router = useRouter();
  const [mode, setMode] = useState<AuthMode>('sign-in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [infoMessage, setInfoMessage] = useState('');
  const [loading, setLoading] = useState(false);

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

  return (
    <section className="space-y-4 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
      <h1 className="text-2xl font-bold text-zinc-100">Get on track</h1>
      <p className="text-sm text-zinc-400">
        {inviteOnly ? 'Founding Beta access for invited riders.' : 'Log setups, compare sessions, dial in your ride.'}
      </p>

      {!inviteOnly ? <div className="space-y-2">
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
              <p className="text-xs text-zinc-400">{provider.label} sign-in is not configured in this environment.</p>
            ) : null}
          </div>
        ))}
      </div> : null}

      {!inviteOnly ? <div className="flex items-center gap-2">
        <span className="h-px flex-1 bg-zinc-800" />
        <span className="text-xs uppercase tracking-wide text-zinc-400">or</span>
        <span className="h-px flex-1 bg-zinc-800" />
      </div> : null}

      <div className="grid grid-cols-2 gap-2 rounded-xl bg-zinc-950 p-1">
        <Button
          variant={mode === 'sign-in' ? 'primary' : 'secondary'}
          className="min-h-10"
          onClick={() => setMode('sign-in')}
        >
          Sign In
        </Button>
        <Button
          variant={mode === 'sign-up' ? 'primary' : 'secondary'}
          className="min-h-10"
          onClick={() => setMode('sign-up')}
        >
          Sign Up
        </Button>
      </div>

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

        <Button type="submit" fullWidth loading={loading}>
          {mode === 'sign-in' ? 'Sign In' : 'Create Account'}
        </Button>
      </form>

      {errorMessage ? <p className="text-sm text-rose-300">{errorMessage}</p> : null}
      {infoMessage ? <p className="text-sm text-emerald-300">{infoMessage}</p> : null}
      {inviteOnly && mode === 'sign-up' ? (
        <p className="text-xs text-zinc-500">No invitation yet? Join the waitlist from the home page.</p>
      ) : null}
    </section>
  );
}
