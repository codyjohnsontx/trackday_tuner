import { NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';

export async function POST(request: Request) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ ok: false, error: 'Not authenticated.' }, { status: 401 });
  let input: unknown;
  try { input = await request.json(); } catch { return NextResponse.json({ ok: false, error: 'Invalid JSON.' }, { status: 400 }); }
  if (!input || typeof input !== 'object' || Array.isArray(input)) return NextResponse.json({ ok: false, error: 'Invalid feedback.' }, { status: 400 });
  const body = input as Record<string, unknown>;
  const comparison = Number(body.comparison_usefulness);
  const ai = Number(body.ai_guidance_usefulness);
  const disappointment = body.disappointment;
  const biggestProblem = typeof body.biggest_problem === 'string' ? body.biggest_problem.trim() : '';
  if (!Number.isInteger(comparison) || comparison < 1 || comparison > 5 || !Number.isInteger(ai) || ai < 1 || ai > 5) return NextResponse.json({ ok: false, error: 'Usefulness scores must be 1–5.' }, { status: 400 });
  if (!['very', 'somewhat', 'not'].includes(String(disappointment))) return NextResponse.json({ ok: false, error: 'Choose how disappointed you would be.' }, { status: 400 });
  if (biggestProblem.length > 1000) return NextResponse.json({ ok: false, error: 'Response must be at most 1,000 characters.' }, { status: 400 });

  const supabase = await createClient();
  const { error } = await supabase.from('beta_feedback').upsert({
    user_id: user.id,
    comparison_usefulness: comparison,
    ai_guidance_usefulness: ai,
    disappointment: disappointment as 'very' | 'somewhat' | 'not',
    biggest_problem: biggestProblem || null,
    interview_opt_in: body.interview_opt_in === true,
  }, { onConflict: 'user_id' });
  if (error) return NextResponse.json({ ok: false, error: 'Unable to save feedback.' }, { status: 500 });
  return NextResponse.json({ ok: true });
}
