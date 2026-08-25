import { randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import {
  createTestAdminClient,
  findUserIdByEmail,
  hasServiceRole,
} from '@/tests/e2e/helpers/supabase';
import type { Database } from '@/types/supabase';

// The walk that tests/unit/migrations-bootstrap.test.ts says it cannot do.
//
// That guard reads the migrations as text: it proves a trigger on auth.users
// exists and that its function inserts into public.profiles, and says outright
// that it cannot prove the insert *succeeds* - `security definer`, the owner's
// privileges and the pinned empty `search_path` all have to be right, and only
// signing up against a real database shows that. This is that check, driven the
// way a rider drives it: the ordinary browser form, then the row.
//
// It ends on the assertion the bug was actually reported through.
// app/api/stripe/checkout/route.ts attaches the Stripe customer with
// `update ... .eq('id', user.id).select('id').maybeSingle()`, and a missing row
// updates nothing while reporting no error - so the returned row is the only
// proof the link landed, and its absence is what returned "Unable to link your
// billing account. Please try again." forever. The update below is that same
// statement through the same service-role client, minus Stripe.
//
// Skipped unless it is pointed at a stack where the ordinary form is the signup
// path. With BETA_INVITE_ONLY on, the form posts to /api/beta/signup, which is
// the writer that always worked and not the one under test here.
const PUBLIC_SIGNUP = (process.env.BETA_INVITE_ONLY ?? 'true') === 'false';

test.describe('signing up outside the invite route', () => {
  // This spec's own explicit waits already total 50s - 10s for the hydration
  // retry, 20s for the /auth/v1/signup response, 20s for the redirect to
  // /dashboard - against the 30s default in playwright.config.ts, so a run that
  // is going perfectly still dies at 30. On top of that sum sit a cold
  // `npm run dev` compiling /login and /dashboard on demand, six device projects
  // sharing that one server, and three Supabase round trips after the redirect.
  // 120s is the 50s plus headroom for all of it. If a wait below grows, grow
  // this number too - the waits are sized for a cold dev server on purpose and
  // must not be shortened to fit a budget.
  test.describe.configure({ timeout: 120_000 });

  test.skip(
    !hasServiceRole(),
    'NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.',
  );
  // Its own skip rather than a wider hasServiceRole(): this is the only spec that
  // builds a rider's own session, and same-day-session-compare.spec.ts would start
  // skipping on a variable it never reads.
  test.skip(
    !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    'NEXT_PUBLIC_SUPABASE_ANON_KEY is required to sign in as the new rider.',
  );
  test.skip(
    !PUBLIC_SIGNUP,
    'Requires BETA_INVITE_ONLY=false, so the form signs up through GoTrue rather than /api/beta/signup.',
  );

  // Held out here rather than in the test body so the hook below can still see
  // them once the body is gone.
  let signupEmail: string | null = null;
  let signupUserId: string | null = null;

  // The account is thrown away here rather than in a `finally` inside the test.
  // Playwright abandons the test body when the test times out, so a `finally`
  // there never runs and the throwaway auth user - and the profiles row this
  // test exists to create - is left behind in a shared database, where the next
  // run reads it as "the trigger did not fire". A hook runs on its own timeout
  // after an aborted body, so it survives exactly the failure that leaks.
  test.afterEach(async () => {
    const email = signupEmail;
    const captured = signupUserId;
    signupEmail = null;
    signupUserId = null;
    if (!email) return;

    // Everything here is swallowed on purpose. A failure to tidy up must not
    // throw over the assertion error underneath it, because that diagnostic is
    // the reason this test exists.
    try {
      const admin = createTestAdminClient();
      const userId = captured ?? (await findUserIdByEmail(admin, email));
      // The profiles row goes with the auth user through the FK cascade.
      if (userId) await admin.auth.admin.deleteUser(userId);
    } catch {
      // Deliberately ignored - see above.
    }
  });

  test('creates the profiles row the checkout route has to link to', async ({ page }, testInfo) => {
    // One account per project, thrown away at the end: several device projects
    // share one database, and a signup that reused an address would fail as
    // "User already registered" rather than proving anything.
    const email = `signup-profile-${testInfo.project.name}-${randomUUID()}@example.com`;
    const password = `pw-${randomUUID()}`;
    // Published before the first navigation, so the fallback lookup in the hook
    // has an address to search on however early this fails.
    signupEmail = email;
    const admin = createTestAdminClient();

    await page.goto('/login');
    await page.getByRole('button', { name: /^Sign Up$/ }).click();

    const form = page.locator('form');
    const emailField = form.getByLabel('Email');
    const passwordField = form.getByLabel('Password');

    // Controlled inputs, so anything typed before React hydrates is discarded.
    // Same retry as helpers/auth.ts signIn().
    await expect(async () => {
      await emailField.fill(email);
      await passwordField.fill(password);
      await expect(emailField).toHaveValue(email);
      await expect(passwordField).toHaveValue(password);
    }).toPass({ timeout: 10_000 });

    // The rider exists from the moment GoTrue answers this, which is before the
    // redirect below and long before the sign-in further down. Taking the id
    // here is what lets the cleanup run no matter where the test fails after
    // it. Registered before the click so the response cannot be missed, and
    // settled to null rather than thrown so it can never be the failure.
    const signupResponseUserId = page
      .waitForResponse(
        (response) =>
          response.url().includes('/auth/v1/signup') && response.request().method() === 'POST',
        { timeout: 20_000 },
      )
      .then(async (response) => {
        if (!response.ok()) return null;
        // A session when confirmations are off, the bare user when they are on.
        const body = (await response.json()) as { id?: string; user?: { id?: string } | null };
        return body.user?.id ?? body.id ?? null;
      })
      .catch(() => null);

    await form.getByRole('button', { name: 'Create Account' }).click();
    signupUserId = await signupResponseUserId;

    await expect(page).toHaveURL(/\/dashboard/, { timeout: 20_000 });

    // The point of this test is that no route handler saw the signup at all.
    // Signing in with the anon key is the rider's own session, which is also
    // the only client that can read their profile under RLS.
    const anon = createClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    const { data: session, error: signInError } = await anon.auth.signInWithPassword({
      email,
      password,
    });
    expect(signInError).toBeNull();
    const sessionUserId = session.user?.id ?? null;
    expect(sessionUserId).not.toBeNull();
    signupUserId = sessionUserId;

    const { data: profile, error: profileError } = await anon
      .from('profiles')
      .select('id, tier')
      .eq('id', sessionUserId!)
      .maybeSingle();

    expect(profileError).toBeNull();
    // The whole defect in one assertion: this was null for every rider who
    // arrived any way other than an invite.
    expect(profile).not.toBeNull();
    expect(profile?.tier).toBe('free');

    const { data: linkedProfile, error: linkError } = await admin
      .from('profiles')
      .update({ stripe_customer_id: `cus_e2e_${randomUUID().slice(0, 8)}` })
      .eq('id', sessionUserId!)
      .select('id')
      .maybeSingle();

    expect(linkError).toBeNull();
    expect(linkedProfile?.id).toBe(sessionUserId);
  });
});
