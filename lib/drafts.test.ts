import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearDraft, loadDraft, saveDraft } from '@/lib/drafts';

const store = new Map<string, string>();

const localStorageMock = {
  getItem: vi.fn((key: string) => store.get(key) ?? null),
  setItem: vi.fn((key: string, value: string) => {
    store.set(key, value);
  }),
  removeItem: vi.fn((key: string) => {
    store.delete(key);
  }),
};

describe('draft helpers', () => {
  beforeEach(() => {
    store.clear();
    vi.clearAllMocks();
    vi.stubGlobal('window', { localStorage: localStorageMock });
  });

  it('saves and loads a draft value', () => {
    saveDraft('session_new', { note: 'baseline' });
    const value = loadDraft<{ note: string }>('session_new');

    expect(value).toEqual({ note: 'baseline' });
  });

  it('returns null for invalid JSON', () => {
    store.set('track_tuner:draft:session_new', 'not-json');
    expect(loadDraft('session_new')).toBeNull();
  });

  it('clears a draft key', () => {
    saveDraft('sag', { label: 'A' });
    clearDraft('sag');
    expect(loadDraft('sag')).toBeNull();
  });
});
