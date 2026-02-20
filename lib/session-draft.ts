import { SessionDraft } from '@/lib/modules';

const STORAGE_KEY = 'track_tuner_session_draft_v1';

export function saveSessionDraft(draft: SessionDraft): void {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(draft));
}

export function loadSessionDraft(): SessionDraft | null {
  if (typeof window === 'undefined') {
    return null;
  }

  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as SessionDraft;
  } catch {
    return null;
  }
}

export function clearSessionDraft(): void {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.removeItem(STORAGE_KEY);
}
