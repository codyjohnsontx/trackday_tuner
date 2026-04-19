import { redirect } from 'next/navigation';
import { AuthForm } from '@/components/auth/auth-form';
import { getAuthenticatedUser } from '@/lib/auth';
import { getOAuthProviders } from '@/lib/auth/providers';

export default async function LoginPage() {
  const user = await getAuthenticatedUser();

  if (user) {
    redirect('/dashboard');
  }

  // Resolve providers server-side so NEXT_PUBLIC_* vars are read consistently
  // (dynamic process.env[key] access doesn't inline on the client bundle)
  const providers = getOAuthProviders();

  return <AuthForm providers={providers} />;
}
