import { describe, expect, it } from 'vitest';
import { ownedPublicObjectPath } from '@/lib/storage-photo-removal';

describe('ownedPublicObjectPath', () => {
  const owner = { supabaseUrl: 'https://project.supabase.co', ownerId: 'user-1', bucket: 'vehicle-photos' };

  it('reads the object name out of the public URL the form stored', () => {
    expect(
      ownedPublicObjectPath(
        'https://project.supabase.co/storage/v1/object/public/vehicle-photos/user-1/1700.jpg',
        owner,
      ),
    ).toBe('user-1/1700.jpg');
  });

  it('decodes the name the object was uploaded under', () => {
    expect(
      ownedPublicObjectPath(
        'http://127.0.0.1:54321/storage/v1/object/public/vehicle-photos/user-1/1700_my%20bike%20%232.jpg',
        { supabaseUrl: 'http://127.0.0.1:54321', ownerId: 'user-1', bucket: 'vehicle-photos' },
      ),
    ).toBe('user-1/1700_my bike #2.jpg');
  });

  it('reads a project served under its own path prefix', () => {
    expect(
      ownedPublicObjectPath(
        'https://example.com/supabase/storage/v1/object/public/vehicle-photos/user-1/a.jpg',
        { supabaseUrl: 'https://example.com/supabase', ownerId: 'user-1', bucket: 'vehicle-photos' },
      ),
    ).toBe('user-1/a.jpg');
  });

  it("refuses an object outside this rider's own folder", () => {
    expect(
      ownedPublicObjectPath(
        'https://project.supabase.co/storage/v1/object/public/vehicle-photos/user-2/a.jpg',
        owner,
      ),
    ).toBeNull();
    expect(
      ownedPublicObjectPath(
        'https://project.supabase.co/storage/v1/object/public/vehicle-photos/a.jpg',
        owner,
      ),
    ).toBeNull();
  });

  it('refuses another project, another bucket and another endpoint', () => {
    expect(
      ownedPublicObjectPath(
        'https://other-project.supabase.co/storage/v1/object/public/vehicle-photos/user-1/a.jpg',
        owner,
      ),
    ).toBeNull();
    expect(
      ownedPublicObjectPath(
        'https://project.supabase.co/storage/v1/object/public/other-bucket/user-1/a.jpg',
        owner,
      ),
    ).toBeNull();
    expect(
      ownedPublicObjectPath(
        'https://example.com/anything/storage/v1/object/public/vehicle-photos/user-1/a.jpg',
        owner,
      ),
    ).toBeNull();
  });

  it('reads a session photo only out of the session-photos bucket', () => {
    const session = { ...owner, bucket: 'session-photos' };
    expect(
      ownedPublicObjectPath(
        'https://project.supabase.co/storage/v1/object/public/session-photos/user-1/sess-1.jpg',
        session,
      ),
    ).toBe('user-1/sess-1.jpg');
    expect(
      ownedPublicObjectPath(
        'https://project.supabase.co/storage/v1/object/public/vehicle-photos/user-1/1700.jpg',
        session,
      ),
    ).toBeNull();
    expect(
      ownedPublicObjectPath(
        'https://project.supabase.co/storage/v1/object/public/session-photos/user-2/sess-1.jpg',
        session,
      ),
    ).toBeNull();
  });

  it('answers null rather than guessing at anything else', () => {
    expect(ownedPublicObjectPath(null, owner)).toBeNull();
    expect(ownedPublicObjectPath('', owner)).toBeNull();
    expect(ownedPublicObjectPath('not a url', owner)).toBeNull();
    expect(
      ownedPublicObjectPath(
        'https://project.supabase.co/storage/v1/object/public/vehicle-photos/user-1/a%ZZ.jpg',
        owner,
      ),
    ).toBeNull();
  });
});
