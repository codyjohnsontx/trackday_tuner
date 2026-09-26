export interface DeclaredBucket {
  name: string;
  public: boolean;
  allowedMimeTypes: string[] | null;
}

// One `[storage.buckets.<name>]` header per bucket, read only at the start of a
// line so a header the CLI's template leaves commented out (`# [storage.buckets.images]`)
// is not read as a declaration - that commented-out template is exactly what the
// repository shipped with. A block runs to the next header. TOML lets a key
// appear once per table, so the first line assigning a key in the block is its
// value, and a key read off a line that starts with `#` is never a value.
const BUCKET_HEADER = /^\[storage\.buckets\.([A-Za-z0-9_-]+)\]\s*$/gm;
const NEXT_HEADER = /^\[/m;
const PUBLIC_KEY = /^public\s*=\s*(true|false)\s*(?:#.*)?$/m;
const MIME_TYPES_KEY = /^allowed_mime_types\s*=\s*\[([^\]]*)\]\s*(?:#.*)?$/m;
const TOML_BASIC_STRING = /"((?:[^"\\]|\\.)*)"/g;

export function bucketsDeclaredIn(configToml: string): DeclaredBucket[] {
  const declared: DeclaredBucket[] = [];

  for (const match of configToml.matchAll(BUCKET_HEADER)) {
    const bodyStart = match.index + match[0].length;
    const rest = configToml.slice(bodyStart);
    const next = NEXT_HEADER.exec(rest);
    const body = next === null ? rest : rest.slice(0, next.index);
    const mimeTypes = MIME_TYPES_KEY.exec(body)?.[1];
    declared.push({
      name: match[1],
      public: PUBLIC_KEY.exec(body)?.[1] === 'true',
      allowedMimeTypes:
        mimeTypes === undefined
          ? null
          : [...mimeTypes.matchAll(TOML_BASIC_STRING)].map((entry) => JSON.parse(`"${entry[1]}"`) as string),
    });
  }

  return declared;
}
