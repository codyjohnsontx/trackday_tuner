'use server';

import { revalidatePath } from 'next/cache';
import { getRealUser } from '@/lib/auth';
import { assertNotDemoMode, isDemoMode } from '@/lib/demo/mode';
import { reportError } from '@/lib/monitoring/report-error';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import {
  RETENTION_DELETE_FAILED_MESSAGE,
  RETENTION_LOAD_FAILED_MESSAGE,
  RETENTION_OPT_OUT_DELETE_FAILED_MESSAGE,
  RETENTION_PROFILE_COLUMNS,
  RETENTION_PROFILE_MISSING_MESSAGE,
  RETENTION_SAVE_FAILED_MESSAGE,
  describeRetainedText,
  planRetentionChange,
  resolveQuestionRetention,
  type QuestionRetentionChoice,
  type RetainedQuestionHistory,
  type RetainedQuestionRoute,
  type RetentionProfile,
} from '@/lib/ai-question-retention';
import type { ActionResult } from '@/types';

// The rider's controls over the text of their AI questions (retention plan,
// PR 2). Two clients, and which one each write uses is the design:
//
// - The consent columns on `profiles` are written through the SERVICE client.
//   `authenticated` holds SELECT only on `profiles` and must keep it that way:
//   RLS picks the row, not the column, so a rider who could write these could
//   backdate a consent (20260924001700). `getRealUser()` is what scopes the
//   write to the rider asking.
// - A text row is deleted through the RIDER's client, under the
//   `ai_request_text: delete own` policy, so the database rather than this file
//   decides whose row it is.
// - The 140-character `ai_requests.prompt_redacted_preview` is question text
//   too (owner decision D5), and `authenticated` holds nothing on
//   `ai_requests` - it is the rate limit, and a rider must never delete those
//   rows. So a preview is nulled through the service client, always filtered
//   on the rider's own id, and the row with its verdict stays.

const HISTORY_LIMIT = 200;

function revalidateRetentionScreens() {
  // The one-time notice sits in the (app) layout and the inline line on both
  // question boxes reads the same columns, so the whole app is stale.
  revalidatePath('/', 'layout');
}

/**
 * The rider's held questions, newest first, read under RLS so the list shows
 * what the database holds rather than what this code believes it holds.
 *
 * A failed read is an error rather than an empty list: "we hold no questions of
 * yours" is a privacy statement, and printing it because a query failed would
 * be a false one.
 */
export async function getRetainedQuestions(): Promise<ActionResult<RetainedQuestionHistory>> {
  if (await isDemoMode()) return { ok: true, data: { questions: [], total: 0 } };

  const user = await getRealUser();
  if (!user) return { ok: false, error: 'Not authenticated.' };

  const supabase = await createClient();
  const { data, error, count } = await supabase
    .from('ai_request_text')
    .select('request_id, route, submitted, created_at, retain_until', { count: 'exact' })
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(HISTORY_LIMIT);

  if (error) {
    reportError('ai-question-retention', new Error(error.message), {
      query: 'ai_request_text.select',
      userId: user.id,
    });
    return { ok: false, error: RETENTION_LOAD_FAILED_MESSAGE };
  }

  const questions = (data ?? []).map((row) => ({
    requestId: row.request_id,
    route: row.route as RetainedQuestionRoute,
    text: describeRetainedText(row.route, row.submitted),
    createdAt: row.created_at,
    retainUntil: row.retain_until,
  }));
  return { ok: true, data: { questions, total: count ?? questions.length } };
}

async function nullPreviews(
  userId: string,
  requestId: string | null,
): Promise<boolean> {
  const admin = createAdminClient();
  let query = admin
    .from('ai_requests')
    .update({ prompt_redacted_preview: null })
    .eq('user_id', userId)
    .not('prompt_redacted_preview', 'is', null);
  if (requestId) query = query.eq('request_id', requestId);

  const { error } = await query;
  if (error) {
    reportError('ai-question-retention', new Error(error.message), {
      query: 'ai_requests.null_preview',
      userId,
      requestId,
    });
    return false;
  }
  return true;
}

/**
 * Set the Settings switch, or answer the one-time notice. "Keep" turns keeping
 * on; "Do not keep" (and the notice's "Not now") turns it off and deletes every
 * held question and preview in the same action (owner decision D3). What each writes is `planRetentionChange`, which works from the
 * profile as stored rather than from what the screen showed.
 */
export async function setQuestionRetention(
  choice: QuestionRetentionChoice,
): Promise<ActionResult<{ keeping: boolean }>> {
  const demoError = await assertNotDemoMode<{ keeping: boolean }>();
  if (demoError) return demoError;

  if (choice !== 'keep' && choice !== 'off') return { ok: false, error: RETENTION_SAVE_FAILED_MESSAGE };

  const user = await getRealUser();
  if (!user) return { ok: false, error: 'Not authenticated.' };

  const admin = createAdminClient();
  const { data: profile, error: readError } = await admin
    .from('profiles')
    .select(RETENTION_PROFILE_COLUMNS)
    .eq('id', user.id)
    .maybeSingle();

  if (readError) {
    reportError('ai-question-retention', new Error(readError.message), {
      query: 'profiles.select',
      userId: user.id,
    });
    return { ok: false, error: RETENTION_SAVE_FAILED_MESSAGE };
  }
  if (!profile) return { ok: false, error: RETENTION_PROFILE_MISSING_MESSAGE };

  const plan = planRetentionChange(
    resolveQuestionRetention(profile as RetentionProfile),
    choice,
    new Date().toISOString(),
  );

  // The flag is written before anything is deleted, so no capture can land
  // between the delete and the switch turning off.
  if (plan.profileUpdate) {
    const { data: updated, error: updateError } = await admin
      .from('profiles')
      .update(plan.profileUpdate)
      .eq('id', user.id)
      .select('id');

    if (updateError) {
      reportError('ai-question-retention', new Error(updateError.message), {
        query: 'profiles.update',
        userId: user.id,
      });
      return { ok: false, error: RETENTION_SAVE_FAILED_MESSAGE };
    }
    if (!updated || updated.length === 0) return { ok: false, error: RETENTION_PROFILE_MISSING_MESSAGE };
  }

  if (plan.deleteHeld) {
    const supabase = await createClient();
    const { error: deleteError } = await supabase.from('ai_request_text').delete().eq('user_id', user.id);
    if (deleteError) {
      reportError('ai-question-retention', new Error(deleteError.message), {
        query: 'ai_request_text.delete_all',
        userId: user.id,
      });
    }
    const previewsCleared = await nullPreviews(user.id, null);

    if (deleteError || !previewsCleared) {
      return { ok: false, error: RETENTION_OPT_OUT_DELETE_FAILED_MESSAGE };
    }
    revalidateRetentionScreens();
    return { ok: true, data: { keeping: false } };
  }

  revalidateRetentionScreens();
  return { ok: true, data: { keeping: choice === 'keep' } };
}

/**
 * Delete one held question and the preview of the same request.
 *
 * The preview is cleared FIRST. The text row is what puts the question - and
 * its Delete button - on the rider's list, so if the preview clear fails the
 * row must still be there for them to retry. The other order let a failed
 * clear strand the preview behind a list that said nothing was held.
 */
export async function deleteRetainedQuestion(requestId: string): Promise<ActionResult> {
  const demoError = await assertNotDemoMode();
  if (demoError) return demoError;

  if (typeof requestId !== 'string' || requestId.length === 0 || requestId.length > 200) {
    return { ok: false, error: RETENTION_DELETE_FAILED_MESSAGE };
  }

  const user = await getRealUser();
  if (!user) return { ok: false, error: 'Not authenticated.' };

  if (!(await nullPreviews(user.id, requestId))) {
    return { ok: false, error: RETENTION_DELETE_FAILED_MESSAGE };
  }

  const supabase = await createClient();
  const { error } = await supabase.from('ai_request_text').delete().eq('request_id', requestId);
  revalidatePath('/settings');
  if (error) {
    reportError('ai-question-retention', new Error(error.message), {
      query: 'ai_request_text.delete_one',
      userId: user.id,
      requestId,
    });
    return { ok: false, error: RETENTION_DELETE_FAILED_MESSAGE };
  }
  return { ok: true, data: undefined };
}

/**
 * Delete every held question and every preview, and leave the switch as it is.
 * Previews first, for the same reason as a single delete: a failed clear must
 * leave the list, and "Hold to delete all", in place to retry.
 */
export async function deleteAllRetainedQuestions(): Promise<ActionResult> {
  const demoError = await assertNotDemoMode();
  if (demoError) return demoError;

  const user = await getRealUser();
  if (!user) return { ok: false, error: 'Not authenticated.' };

  if (!(await nullPreviews(user.id, null))) {
    return { ok: false, error: RETENTION_DELETE_FAILED_MESSAGE };
  }

  const supabase = await createClient();
  const { error } = await supabase.from('ai_request_text').delete().eq('user_id', user.id);
  revalidatePath('/settings');
  if (error) {
    reportError('ai-question-retention', new Error(error.message), {
      query: 'ai_request_text.delete_all',
      userId: user.id,
    });
    return { ok: false, error: RETENTION_DELETE_FAILED_MESSAGE };
  }
  return { ok: true, data: undefined };
}
