/**
 * Diffs the hosted database's schema inventory against a database built from
 * `supabase/migrations/`, so the hosted project falling behind the repository
 * shows up as named lines rather than as a rider's failed save.
 *
 *   npm run db:drift -- <hosted.csv>
 *
 * `<hosted.csv>` is `scripts/sql/schema-inventory.sql` run in the hosted SQL
 * editor and saved with "Download CSV". The same file is run against the local
 * stack through `supabase db query --local`, so that stack has to be one built
 * from this checkout's migrations and nothing else
 * (`npx supabase db reset`); a stack carrying another branch's migrations is a
 * different reference. docs/beta-runbook.md, "Check the hosted schema for
 * drift", is the procedure.
 *
 * Exit 0 when the two agree, 1 when they differ, 2 when either side could not
 * be read. Only what the migrations control counts: lines the Supabase platform
 * owns are printed apart and never make it exit 1. An empty inventory is refused rather than compared: two empty files
 * agree perfectly, and "no drift" over nothing is the answer this exists to
 * stop anyone getting.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const INVENTORY_SQL_PATH = path.join(ROOT, 'scripts/sql/schema-inventory.sql');

// Whether the CLI has ever recorded a migration history. The reference is built
// by the CLI, so it always says true; the hosted project was never pushed to,
// so it says false. Expected, and not a schema difference - printed, not counted.
const INFORMATIONAL = /^MIGRATIONS\s/;

// What the Supabase platform owns rather than the migrations: its own default
// privileges, and the storage service's triggers on storage.objects, which move
// with the storage API version. Hosted and a local stack each carry their own.
const PLATFORM_MANAGED = [
  /^DEFACL schema=(?:<all> |\S+ owner=supabase_admin )/,
  /^TRIGGER storage\.objects .* EXECUTE FUNCTION (?!public\.)[\w"]+\.[\w"]+\(/,
];

// An extension's version follows the project's upgrade history on hosted and the
// image on a local stack. Whether the extension is there at all is a migration's
// doing, so only a line whose extension the other side also has is the platform's.
function extensionKey(line) {
  return line.replace(/^(EXTENSION \S+) version=\S+/, '$1');
}

/**
 * The `line` column of an inventory CSV, as the SQL editor's "Download CSV" and
 * `supabase db query -o csv` both write it: an optional header, RFC 4180 quoting
 * (a field holding a comma or a quote is quoted, an inner quote doubled), and a
 * possible byte-order mark. The inventory collapses every record to one line, so
 * a quoted field never spans two.
 */
export function parseInventoryCsv(text) {
  const rows = text
    .replace(/^﻿/, '')
    .split(/\r?\n/)
    .filter((row) => row.trim() !== '')
    .map((row) => {
      if (!row.startsWith('"')) return row;
      if (!row.endsWith('"') || row.length < 2) {
        throw new Error(`Unterminated quoted field in inventory CSV: ${row}`);
      }
      return row.slice(1, -1).replace(/""/g, '"');
    });

  return rows[0] === 'line' ? rows.slice(1) : rows;
}

/**
 * Why an inventory cannot be compared, or null when it can. Every database this
 * app runs on has public tables, so an inventory with no TABLE line is the wrong
 * file, the wrong database, or a run that failed - not a schema.
 */
export function describeUnusableInventory(label, lines) {
  if (lines.length === 0) return `The ${label} inventory is empty.`;
  if (!lines.some((line) => line.startsWith('TABLE '))) {
    return `The ${label} inventory has no TABLE lines, so it is not the output of scripts/sql/schema-inventory.sql.`;
  }
  return null;
}

/**
 * Lines in the reference and not hosted (the hosted project is missing or
 * differs from what the migrations make), lines hosted and not in the reference
 * (made by hand, or left behind), the platform-managed lines that differ either
 * way, and the informational lines. An object that exists on both sides with a
 * different definition appears once in each list, under the same leading name.
 */
export function compareInventories(reference, hosted) {
  const hostedSet = new Set(hosted);
  const referenceSet = new Set(reference);
  const informational = (line) => INFORMATIONAL.test(line);
  const platformManaged = (line, otherSide) =>
    PLATFORM_MANAGED.some((pattern) => pattern.test(line)) ||
    (line.startsWith('EXTENSION ') && otherSide.has(extensionKey(line)));
  const hostedExtensions = new Set(hosted.map(extensionKey));
  const referenceExtensions = new Set(reference.map(extensionKey));

  const onlyInReference = reference.filter((line) => !hostedSet.has(line) && !informational(line));
  const onlyInHosted = hosted.filter((line) => !referenceSet.has(line) && !informational(line));
  const sorted = (lines) => [...new Set(lines)].sort();

  return {
    missingFromHosted: sorted(onlyInReference.filter((line) => !platformManaged(line, hostedExtensions))),
    onlyOnHosted: sorted(onlyInHosted.filter((line) => !platformManaged(line, referenceExtensions))),
    platform: {
      missingFromHosted: sorted(onlyInReference.filter((line) => platformManaged(line, hostedExtensions))),
      onlyOnHosted: sorted(onlyInHosted.filter((line) => platformManaged(line, referenceExtensions))),
    },
    notes: sorted([...reference, ...hosted].filter(informational)),
  };
}

export function hasDrift(result) {
  return result.missingFromHosted.length > 0 || result.onlyOnHosted.length > 0;
}

export function formatDriftReport(result) {
  const out = [];
  if (!hasDrift(result)) {
    out.push('No drift: hosted matches the reference in everything the migrations control.');
  } else {
    out.push(
      `Drift: ${result.missingFromHosted.length} line(s) the migrations make that hosted does not have, ` +
        `${result.onlyOnHosted.length} line(s) hosted has that the migrations do not make.`,
    );
    if (result.missingFromHosted.length > 0) {
      out.push('', 'In the migrations, not on hosted (missing, or defined differently there):');
      for (const line of result.missingFromHosted) out.push(`  - ${line}`);
    }
    if (result.onlyOnHosted.length > 0) {
      out.push('', 'On hosted, not in the migrations (made by hand, or defined differently):');
      for (const line of result.onlyOnHosted) out.push(`  + ${line}`);
    }
  }
  if (result.platform.missingFromHosted.length > 0 || result.platform.onlyOnHosted.length > 0) {
    out.push('', 'Platform-managed, informational (owned by Supabase rather than the migrations; not drift):');
    for (const line of result.platform.missingFromHosted) out.push(`  - ${line}`);
    for (const line of result.platform.onlyOnHosted) out.push(`  + ${line}`);
  }
  if (result.notes.length > 0) {
    out.push('', 'Not counted (the CLI history table, which only the reference is expected to have):');
    for (const line of result.notes) out.push(`    ${line}`);
  }
  return out.join('\n');
}

/**
 * The inventory of the local stack, through the Supabase CLI so nothing new is
 * installed to reach Postgres.
 */
export function readLocalInventory() {
  const result = spawnSync(
    'npx',
    ['supabase', 'db', 'query', '--local', '-f', INVENTORY_SQL_PATH, '-o', 'csv'],
    { cwd: ROOT, encoding: 'utf8' },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`supabase db query failed (exit ${result.status}): ${result.stderr.trim()}`);
  }
  return parseInventoryCsv(result.stdout);
}

/**
 * The command, returning its exit code. The reference is read through
 * `readReference`, which is the local stack everywhere but in a test.
 */
export function main(argv, readReference = readLocalInventory) {
  if (argv.length !== 1) {
    console.error('Usage: npm run db:drift -- <hosted.csv>');
    return 2;
  }

  let reference;
  let hosted;
  try {
    hosted = parseInventoryCsv(readFileSync(argv[0], 'utf8'));
    reference = readReference();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    return 2;
  }

  const unusable =
    describeUnusableInventory('hosted', hosted) ?? describeUnusableInventory('reference', reference);
  if (unusable) {
    console.error(unusable);
    return 2;
  }

  const result = compareInventories(reference, hosted);
  console.log(formatDriftReport(result));
  return hasDrift(result) ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main(process.argv.slice(2)));
}
