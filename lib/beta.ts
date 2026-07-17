import 'server-only';
import { createHmac, randomBytes } from 'node:crypto';
import { getBetaInviteSecret } from '@/lib/env.server';

export function normalizeBetaEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function createBetaInviteCode(): string {
  return randomBytes(12).toString('base64url');
}

export function hashBetaInviteCode(code: string): string {
  return createHmac('sha256', getBetaInviteSecret()).update(code.trim()).digest('hex');
}

export function betaAccessWindow(start = new Date()): { startedAt: string; expiresAt: string } {
  const expires = new Date(start);
  expires.setUTCDate(expires.getUTCDate() + 90);
  return { startedAt: start.toISOString(), expiresAt: expires.toISOString() };
}
