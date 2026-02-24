const DRAFT_NAMESPACE = 'track_tuner:draft:';

function getStorageKey(key: string): string {
  return `${DRAFT_NAMESPACE}${key}`;
}

export function loadDraft<T>(key: string): T | null {
  if (typeof window === 'undefined') return null;

  const raw = window.localStorage.getItem(getStorageKey(key));
  if (!raw) return null;

  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function saveDraft<T>(key: string, value: T): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(getStorageKey(key), JSON.stringify(value));
}

export function clearDraft(key: string): void {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(getStorageKey(key));
}
