'use client';

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { createClient } from '@/lib/supabase/client';

type AuthMode = 'sign-in' | 'sign-up';

export function AuthForm() {
  const router = useRouter();
  const [mode, setMode] = useState<AuthMode>('sign-in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [infoMessage, setInfoMessage] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setErrorMessage('');
    setInfoMessage('');

    const supabase = createClient();

    if (mode === 'sign-in') {
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
      <h1 className="text-xl font-semibold text-zinc-100">Login</h1>
      <p className="text-sm text-zinc-300">Use your email and password to access Track Tuner.</p>

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

        <Button type="submit" fullWidth disabled={loading}>
          {loading ? 'Processing...' : mode === 'sign-in' ? 'Sign In' : 'Create Account'}
        </Button>
      </form>

      {errorMessage ? <p className="text-sm text-rose-300">{errorMessage}</p> : null}
      {infoMessage ? <p className="text-sm text-emerald-300">{infoMessage}</p> : null}
    </section>
  );
}
