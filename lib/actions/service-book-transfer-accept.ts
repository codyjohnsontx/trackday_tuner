'use server';

import { revalidatePath } from 'next/cache';
import { getRealUser } from '@/lib/auth';
import { assertNotDemoMode } from '@/lib/demo/mode';
import { reportError } from '@/lib/monitoring/report-error';
import { describeAcceptRefusal, HANDOVER_COPY, isHandoverTokenShape } from '@/lib/service-book/handover-view';
import { takeOverServiceBook, type AcceptedHandover } from '@/lib/service-book-transfer-accept';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import type { ActionResult } from '@/types';

const NOT_AUTHENTICATED = 'Not authenticated.';

/**
 * The buyer accepts a handover (owner, PQ2): prepare, copy and accept, with the
 * bounded retry, through `takeOverServiceBook`. The two functions run as the
 * rider, so the database decides whether this account may take the bike; the
 * service role copies the storage objects, which SQL cannot. What the buyer
 * reads on a refusal is worded from the code the database answered with.
 */
export async function acceptServiceBookTransfer(token: string): Promise<ActionResult<AcceptedHandover>> {
  const demoError = await assertNotDemoMode<AcceptedHandover>();
  if (demoError) return demoError;

  const user = await getRealUser();
  if (!user) return { ok: false, error: NOT_AUTHENTICATED };
  if (!isHandoverTokenShape(token)) return { ok: false, error: HANDOVER_COPY.invalid };

  const rider = await createClient();
  const admin = createAdminClient();
  const outcome = await takeOverServiceBook({
    rider,
    storage: admin.storage,
    token,
    report: (event, error, context) => reportError(event, error, { userId: user.id, ...context }),
  });

  if (!outcome.ok) {
    if (outcome.stage === 'copy') return { ok: false, error: HANDOVER_COPY.copyFailed };
    const refusal = describeAcceptRefusal(outcome.code);
    if (refusal === HANDOVER_COPY.failed) {
      reportError('service-book-handover-accept', new Error(outcome.message), {
        userId: user.id,
        reason: outcome.code,
        stage: outcome.stage,
        attempts: outcome.attempts,
      });
    }
    return { ok: false, error: refusal };
  }

  // The bike is new in the garage, its sessions in the history, and the
  // dashboard reads both.
  revalidatePath('/garage');
  revalidatePath('/dashboard');
  revalidatePath('/sessions');
  return { ok: true, data: outcome.data };
}
