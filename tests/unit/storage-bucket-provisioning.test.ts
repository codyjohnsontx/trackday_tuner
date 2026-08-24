import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Guards the invariant that a database built from this repository has every
// storage bucket the application uploads to, and that riders can only write
// their own photos into it.
//
// components/garage/vehicle-form.tsx uploads to a bucket called `vehicle-photos`
// and stores the public URL of the object on the vehicle row. Nothing in the
// repository created that bucket: every `[storage.buckets.*]` block in
// supabase/config.toml was commented out, so a fresh `supabase start` applied
// every migration cleanly and then answered the first photo upload with "Bucket
// not found". Like the missing tables and grants that
// tests/unit/migrations-bootstrap.test.ts guards, it was invisible against any
// stack somebody had already fixed by hand in the dashboard, which is why it
// survived.
//
// A bucket is provisioned in two places, because the Supabase CLI splits it in
// two. The bucket itself - its name, whether it is public, what it accepts - is a
// `[storage.buckets.<name>]` block in config.toml, which `supabase start` and
// `supabase db reset` seed locally and `supabase seed buckets --linked` seeds on
// the hosted project. The policies on storage.objects that decide who may write
// into it are SQL, so they live in a migration like every other policy here.
//
// WHAT IT CATCHES, stated exactly:
//   - a bucket the application code uploads to that config.toml does not declare,
//     including a block commented back out, which is the shape of the original bug
//   - a bucket the code reads through `getPublicUrl` that is not `public = true`,
//     which would store a URL the card renders as a broken image
//   - a bucket with no owner-scoped select, insert or update policy on
//     storage.objects. All three are required because the form uploads with
//     `upsert: true`: the storage API performs that as an insert-on-conflict-update
//     that returns the row, and under RLS the returned row has to pass the select
//     policy, so without one even a brand-new path is refused. An upsert onto an
//     existing object is also an update that an insert-only policy refuses.
//     `auth.uid()` is what makes it owner-scoped, matching how every table policy
//     in the migrations reads
//
// WHAT IT DOES NOT CATCH: whether the bucket is actually seeded, which depends on
// the CLI reading the block; whether the predicate is *right* - a policy naming
// the bucket and `auth.uid()` in a comparison that admits everyone still passes
// here; and anything about the hosted project, which is seeded by hand with the
// command the README records. tests/e2e/vehicle-photo-upload.spec.ts is that walk:
// it uploads through the real form against a rebuilt stack, fetches the stored
// URL with no session, and watches an anonymous client, a write into a foreign
// folder, an upsert onto an object somebody else owns and a file that is not an
// image all get refused.

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, '../..');
const configPath = path.join(repoRoot, 'supabase/config.toml');
const migrationsDir = path.join(repoRoot, 'supabase/migrations');
// Where the application code lives. Tests are left out because a spec naming a
// bucket is an assertion about it, not an upload to it.
const sourceRoots = ['app', 'components', 'lib'];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    if (!/\.(ts|tsx)$/.test(entry) || /\.test\.tsx?$/.test(entry)) return [];
    return [full];
  });
}

interface BucketUse {
  name: string;
  /** Read through `getPublicUrl`, so the bucket has to be public for the stored URL to resolve. */
  readPublicly: boolean;
  files: string[];
}

// `supabase.storage.from('name')`, with the chain allowed to wrap across lines the
// way the form writes it. `\s*` covers the newline between `.from(...)` and the
// next call, which is what lets `getPublicUrl` be read off the same chain.
const STORAGE_FROM = /\bstorage\s*\.\s*from\(\s*(['"`])([^'"`]+)\1\s*\)(\s*\.\s*getPublicUrl\b)?/g;

export function bucketsUsedBy(files: { file: string; source: string }[]): BucketUse[] {
  const uses = new Map<string, BucketUse>();

  for (const { file, source } of files) {
    for (const match of source.matchAll(STORAGE_FROM)) {
      const [, , name, publicRead] = match;
      const use = uses.get(name) ?? { name, readPublicly: false, files: [] };
      use.readPublicly ||= publicRead !== undefined;
      if (!use.files.includes(file)) use.files.push(file);
      uses.set(name, use);
    }
  }

  return [...uses.values()].sort((a, b) => a.name.localeCompare(b.name));
}

interface DeclaredBucket {
  name: string;
  public: boolean;
}

// One `[storage.buckets.<name>]` header per bucket, read only at the start of a
// line so a header the CLI's template leaves commented out (`# [storage.buckets.images]`)
// is not read as a declaration - that commented-out template is exactly what the
// repository shipped with. A block runs to the next header. TOML lets a key
// appear once per table, so the first `public =` in the block is the value.
const BUCKET_HEADER = /^\[storage\.buckets\.([A-Za-z0-9_-]+)\]\s*$/gm;
const NEXT_HEADER = /^\[/m;

export function bucketsDeclaredIn(configToml: string): DeclaredBucket[] {
  const declared: DeclaredBucket[] = [];

  for (const match of configToml.matchAll(BUCKET_HEADER)) {
    const bodyStart = match.index + match[0].length;
    const rest = configToml.slice(bodyStart);
    const next = NEXT_HEADER.exec(rest);
    const body = next === null ? rest : rest.slice(0, next.index);
    const isPublic = /^public\s*=\s*true\s*(?:#.*)?$/m.test(body);
    declared.push({ name: match[1], public: isPublic });
  }

  return declared;
}

function stripComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ');
}

interface StoragePolicy {
  file: string;
  bucket: string;
  command: string;
  ownerScoped: boolean;
}

// Every `create policy ... on storage.objects for <command> ... ;`. The bucket is
// read off a `bucket_id = '<name>'` comparison in the policy body, and the scope
// off `auth.uid()`, which is how every own-row policy in supabase/migrations/ is
// written. `[^;]*` keeps each match inside one statement.
const STORAGE_OBJECTS_POLICY =
  /create\s+policy\s+"[^"]*"\s+on\s+storage\.objects\s+for\s+(select|insert|update|delete|all)\b([^;]*);/gi;
const BUCKET_ID = /bucket_id\s*=\s*'([^']+)'/i;

export function storagePoliciesIn(migrations: { file: string; sql: string }[]): StoragePolicy[] {
  const policies: StoragePolicy[] = [];

  for (const { file, sql } of migrations) {
    for (const match of stripComments(sql).matchAll(STORAGE_OBJECTS_POLICY)) {
      const [, command, body] = match;
      const bucket = BUCKET_ID.exec(body)?.[1];
      if (bucket === undefined) continue;
      policies.push({
        file,
        bucket,
        command: command.toLowerCase(),
        ownerScoped: /auth\.uid\(\)/i.test(body),
      });
    }
  }

  return policies;
}

// The whole invariant as one list of violations, so the checks against
// deliberately wrong input below and the run against the repository share an
// entry point.
export function provisioningViolations(
  uses: BucketUse[],
  declared: DeclaredBucket[],
  policies: StoragePolicy[],
): string[] {
  const violations: string[] = [];

  for (const use of uses) {
    const bucket = declared.find((candidate) => candidate.name === use.name);
    if (bucket === undefined) {
      violations.push(
        `${use.files.join(', ')} uploads to bucket ${use.name}, which supabase/config.toml never declares`,
      );
      continue;
    }
    if (use.readPublicly && !bucket.public) {
      violations.push(
        `${use.files.join(', ')} stores getPublicUrl for bucket ${use.name}, which is not public = true`,
      );
    }

    // `for all` covers every verb; otherwise each of the three the upsert needs
    // has to be written, and each has to be scoped to the owner.
    for (const verb of ['select', 'insert', 'update']) {
      const covering = policies.filter(
        (policy) => policy.bucket === use.name && (policy.command === verb || policy.command === 'all'),
      );
      if (covering.length === 0) {
        violations.push(`no migration writes a ${verb} policy on storage.objects for bucket ${use.name}`);
        continue;
      }
      if (!covering.some((policy) => policy.ownerScoped)) {
        violations.push(
          `${covering.map((policy) => policy.file).join(', ')}: the ${verb} policy on storage.objects for bucket ${use.name} is not scoped to auth.uid()`,
        );
      }
    }
  }

  return violations;
}

const uses = bucketsUsedBy(
  sourceRoots
    .flatMap((root) => sourceFiles(path.join(repoRoot, root)))
    .map((file) => ({ file: path.relative(repoRoot, file), source: readFileSync(file, 'utf8') })),
);
const declared = bucketsDeclaredIn(readFileSync(configPath, 'utf8'));
const policies = storagePoliciesIn(
  readdirSync(migrationsDir)
    .filter((file) => file.endsWith('.sql'))
    .sort()
    .map((file) => ({ file, sql: readFileSync(path.join(migrationsDir, file), 'utf8') })),
);

describe('every storage bucket the application uploads to is provisioned by the repository', () => {
  it('reads the vehicle photo upload off the vehicle form', () => {
    // Without this the check below could pass by seeing no uploads at all. The
    // scan is asserted rather than assumed: a chain written differently enough
    // to escape STORAGE_FROM would silently take the whole invariant with it.
    expect(uses).toEqual([
      {
        name: 'vehicle-photos',
        readPublicly: true,
        files: ['components/garage/vehicle-form.tsx'],
      },
    ]);
  });

  it('declares each one in supabase/config.toml and gives its owners select and write policies', () => {
    expect(provisioningViolations(uses, declared, policies)).toEqual([]);
  });
});

// The check above passes against a repository that got it right, and would pass
// just as happily against a deleted check. These feed it the shapes that got it
// wrong, so what it catches is observed rather than assumed.
describe('the bucket check, against provisioning written wrongly on purpose', () => {
  const form = {
    file: 'components/garage/vehicle-form.tsx',
    source: `
      const { error } = await supabase.storage
        .from('vehicle-photos')
        .upload(path, photoFile, { upsert: true });
      const { data } = supabase.storage
        .from('vehicle-photos')
        .getPublicUrl(path);
    `,
  };
  const formUses = bucketsUsedBy([form]);

  const declaredPublic = bucketsDeclaredIn(`
[storage]
enabled = true

[storage.buckets.vehicle-photos]
public = true
allowed_mime_types = ["image/*"]

[storage.s3_protocol]
enabled = true
`);

  const ownerPolicies = storagePoliciesIn([
    {
      file: 'policies.sql',
      sql: `
        create policy "vehicle-photos: select own"
          on storage.objects for select to authenticated
          using (bucket_id = 'vehicle-photos' and (storage.foldername(name))[1] = auth.uid()::text);
        create policy "vehicle-photos: insert own"
          on storage.objects for insert to authenticated
          with check (bucket_id = 'vehicle-photos' and (storage.foldername(name))[1] = auth.uid()::text);
        create policy "vehicle-photos: update own"
          on storage.objects for update to authenticated
          using (bucket_id = 'vehicle-photos' and (storage.foldername(name))[1] = auth.uid()::text)
          with check (bucket_id = 'vehicle-photos' and (storage.foldername(name))[1] = auth.uid()::text);
      `,
    },
  ]);

  it('accepts the shape the repository uses', () => {
    // The control, so the failures below are about the thing each one changes.
    expect(provisioningViolations(formUses, declaredPublic, ownerPolicies)).toEqual([]);
  });

  it('catches the template the repository shipped with, every bucket commented out', () => {
    const shipped = bucketsDeclaredIn(`
[storage]
enabled = true
file_size_limit = "50MiB"

# Uncomment to configure local storage buckets
# [storage.buckets.images]
# public = false
# file_size_limit = "50MiB"
# allowed_mime_types = ["image/png", "image/jpeg"]
# objects_path = "./images"

[storage.s3_protocol]
enabled = true
`);
    expect(shipped).toEqual([]);
    expect(provisioningViolations(formUses, shipped, ownerPolicies)).toEqual([
      'components/garage/vehicle-form.tsx uploads to bucket vehicle-photos, which supabase/config.toml never declares',
    ]);
  });

  it('catches a bucket declared under a different name', () => {
    const renamed = bucketsDeclaredIn(`
[storage.buckets.vehicle_photos]
public = true
`);
    expect(provisioningViolations(formUses, renamed, ownerPolicies)).toEqual([
      'components/garage/vehicle-form.tsx uploads to bucket vehicle-photos, which supabase/config.toml never declares',
    ]);
  });

  it('catches a private bucket whose URL the form stores as public', () => {
    const declaredPrivate = bucketsDeclaredIn(`
[storage.buckets.vehicle-photos]
public = false
`);
    expect(provisioningViolations(formUses, declaredPrivate, ownerPolicies)).toEqual([
      'components/garage/vehicle-form.tsx stores getPublicUrl for bucket vehicle-photos, which is not public = true',
    ]);
  });

  it('reads public off the bucket block and not off a neighbour', () => {
    // `public = true` under the *next* table must not count for this one.
    const neighbour = bucketsDeclaredIn(`
[storage.buckets.vehicle-photos]
file_size_limit = "10MiB"

[storage.buckets.avatars]
public = true
`);
    expect(neighbour).toEqual([
      { name: 'vehicle-photos', public: false },
      { name: 'avatars', public: true },
    ]);
  });

  it('catches a bucket with an insert policy and no select or update policy', () => {
    // The form uploads with `upsert: true`. The storage API returns the row it
    // wrote, which RLS checks against the select policy, so an insert-only policy
    // refuses even a brand-new path; and re-uploading onto an existing object is
    // an update. Both refusals read like the bucket is fine.
    const insertOnly = storagePoliciesIn([
      {
        file: 'policies.sql',
        sql: `
          create policy "vehicle-photos: insert own"
            on storage.objects for insert to authenticated
            with check (bucket_id = 'vehicle-photos' and (storage.foldername(name))[1] = auth.uid()::text);
        `,
      },
    ]);
    expect(provisioningViolations(formUses, declaredPublic, insertOnly)).toEqual([
      'no migration writes a select policy on storage.objects for bucket vehicle-photos',
      'no migration writes a update policy on storage.objects for bucket vehicle-photos',
    ]);
  });

  it('catches policies that name a different bucket', () => {
    const otherBucket = storagePoliciesIn([
      {
        file: 'policies.sql',
        sql: `
          create policy "avatars: write own"
            on storage.objects for all to authenticated
            using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
        `,
      },
    ]);
    expect(provisioningViolations(formUses, declaredPublic, otherBucket)).toEqual([
      'no migration writes a select policy on storage.objects for bucket vehicle-photos',
      'no migration writes a insert policy on storage.objects for bucket vehicle-photos',
      'no migration writes a update policy on storage.objects for bucket vehicle-photos',
    ]);
  });

  it('catches a write policy that is not scoped to the rider', () => {
    // Anyone signed in could overwrite anyone's photo. The bucket is named, the
    // verbs are there, and the policy is still wrong.
    const unscoped = storagePoliciesIn([
      {
        file: 'policies.sql',
        sql: `
          create policy "vehicle-photos: any authenticated write"
            on storage.objects for all to authenticated
            using (bucket_id = 'vehicle-photos')
            with check (bucket_id = 'vehicle-photos');
        `,
      },
    ]);
    expect(provisioningViolations(formUses, declaredPublic, unscoped)).toEqual([
      'policies.sql: the select policy on storage.objects for bucket vehicle-photos is not scoped to auth.uid()',
      'policies.sql: the insert policy on storage.objects for bucket vehicle-photos is not scoped to auth.uid()',
      'policies.sql: the update policy on storage.objects for bucket vehicle-photos is not scoped to auth.uid()',
    ]);
  });

  it('accepts a single `for all` policy that covers every verb', () => {
    const forAll = storagePoliciesIn([
      {
        file: 'policies.sql',
        sql: `
          create policy "vehicle-photos: own folder"
            on storage.objects for all to authenticated
            using (bucket_id = 'vehicle-photos' and (storage.foldername(name))[1] = auth.uid()::text)
            with check (bucket_id = 'vehicle-photos' and (storage.foldername(name))[1] = auth.uid()::text);
        `,
      },
    ]);
    expect(provisioningViolations(formUses, declaredPublic, forAll)).toEqual([]);
  });

  it('ignores a bucket named only inside a comment', () => {
    // Prose in a migration explaining the bucket must not read as a policy on it.
    const commented = storagePoliciesIn([
      {
        file: 'notes.sql',
        sql: `
          -- create policy "vehicle-photos: insert own" on storage.objects for insert
          --   with check (bucket_id = 'vehicle-photos' and auth.uid() is not null);
          /* create policy "x" on storage.objects for update using (bucket_id = 'vehicle-photos' and auth.uid() is not null); */
          select 1;
        `,
      },
    ]);
    expect(commented).toEqual([]);
  });

  it('does not read a spec that names the bucket as an upload to it', () => {
    // A test asserting on the bucket is not application code writing to it, so
    // `bucketsUsedBy` is only ever handed non-test files - asserted here on the
    // file list the real run builds.
    expect(uses.flatMap((use) => use.files).some((file) => /\.test\.tsx?$/.test(file))).toBe(false);
  });
});
