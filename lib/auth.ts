import { createClient } from '@/lib/supabase/server';

export async function getAuthenticatedUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return user;
}

export async function isAuthenticated(): Promise<boolean> {
  const user = await getAuthenticatedUser();
  return Boolean(user);
}
