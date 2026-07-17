import { NextResponse } from 'next/server';

export async function POST() {
  return NextResponse.json(
    { ok: false, error: 'Recommendation feedback moved to the session outcome flow.' },
    { status: 410 },
  );
}
